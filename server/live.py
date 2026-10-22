"""Live feed: a simulated sensor stream that advances hour by hour.

Modes
  live    background Miri weather stepped through the hydrology model. At
          "realtime" speed the sensor clock follows the Malaysia wall clock; the
          faster speeds are accelerated simulation. A storm drill is an exercise
          run inside live mode.
  replay  a historical event played back from sensor_history.csv

Each hour the engine forecasts every hotspot, fuses any CCTV reading, keeps an
incident record per hotspot, logs level changes and asks the alert store for
drafts when a hotspot reaches Warning or Danger. Operators can deploy mobile
pumps, close roads and open relief centres; pumps add drain capacity in the
hydraulic model, so the digital twin and the next readings show their effect.
"""
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from . import cctv
from .config import (
    DATA_DIR, FEATURES, FLOOD_DEPTH_CM, HIGH_TIDE_M, HORIZONS, HOTSPOT_BY_ID, HOTSPOTS, LEVEL_RANK,
    PUMP_MMHR, PUMP_UNITS, RIVER_ALERT_M, level_for, public_hotspot,
)
from .features import feature_matrix
from .model import MECH_PRIORITY
from .physics import (
    EPOCH, RIVER_BASE, RIVER_STORE_GAIN, RIVER_TAU_H, RIVER_TIDE_GAIN, TIDE_MEAN,
    background_rain, hours_since_epoch, hydraulics, step, tide_at, tide_extremes,
)

SPEEDS = {"realtime": 3600, "normal": 20, "fast": 8, "demo": 3}
HISTORY_HOURS = 72
WARM_EVAL_HOURS = 36   # forecasts kept for the charts when the clock jumps (reset, drill, replay)
CCTV_TTL_SECONDS = 30 * 60
PROJECTION_HOURS = 6
INCIDENT_QUIET_HOURS = 2   # hours at Normal with a dry road before an incident is closed
DRILL_SEED = 20250112      # sensor-noise seed for storm drills


def myt_now() -> pd.Timestamp:
    """Current time in Malaysia (UTC+8), timezone-naive."""
    return pd.Timestamp(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=8))


def myt_stamp() -> str:
    """Wall-clock time in Malaysia with its offset, for created_at fields."""
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def iso(ts) -> str:
    return pd.Timestamp(ts).isoformat()


def pct(p) -> str:
    """Probability as a whole percent, rounded down so it never shows a higher level than it is."""
    return f"{int(p * 100 + 1e-9)}%"


class ResponseError(ValueError):
    pass


class LiveEngine:
    def __init__(self, model, alerts):
        self.model = model
        self.alerts = alerts
        self.lock = threading.RLock()
        self.speed = "realtime"
        self.playing = True
        self._hist = None
        self._live_ops = None
        events = pd.read_csv(DATA_DIR / "flood_events.csv")
        self.history_floods = {h["id"]: int(events["hotspots"].str.split(";").apply(lambda v, i=h["id"]: i in v).sum())
                               for h in HOTSPOTS}
        self.mode, self.drill = "live", None
        self.reset(initial=True)

    # ─── Setup ────────────────────────────────────────────────────────────
    def reset(self, initial=False):
        with self.lock:
            # Pumps, closures and relief centres are physical: they survive a feed restart,
            # and the live ones set aside during a drill or replay come back.
            keep = None if initial else (self._live_ops if self.source != "live" else self._ops())
            self._live_ops = None
            self.rng = np.random.default_rng()
            self.mode = "live"
            self.replay = None
            self.drill = None
            self.events = deque(maxlen=300)
            self.rows = deque(maxlen=HISTORY_HOURS)
            self.cctv = {}
            self.weather, self.surge = {}, {}
            self.exact_forecast_until = None
            self.state = {h["id"]: {"S": 0.0, "D": 0.0, "prev": 0.0} for h in HOTSPOTS}
            self.river_store = 0.0
            self.levels = {h["id"]: "Normal" for h in HOTSPOTS}
            self.current = {}
            self._reset_operations()
            if keep:
                self.pumps, self.roads_closed, self.relief_open = keep
            now = myt_now().floor("h")
            self.t = now - pd.Timedelta(hours=HISTORY_HOURS + 24)
            self._highs = None
            self._ensure_weather(now + pd.Timedelta(hours=36))
            while self.t < now:
                self._advance(quiet=True, evaluate=now - self.t <= pd.Timedelta(hours=WARM_EVAL_HOURS))
            for hp in HOTSPOTS:
                self._assess(hp["id"], silent=True)
            self.last_tick = time.monotonic()
            # Drafts from a drill or replay belong to an exercise that has now ended.
            self.alerts.expire_open(("drill", "replay"), "Exercise ended")
            self.alerts.expire_stale("live", self.t, self.levels)
            self._log("info", "Live feed started" if initial else "Back to live",
                      "Simulated sensor feed for the six hotspots, synced to Malaysia time.")

    def _ops(self):
        return dict(self.pumps), dict(self.roads_closed), dict(self.relief_open)

    def _set_aside_live_ops(self):
        """Keep the live response state for later; an exercise starts with every pump at the depot."""
        if self.source == "live":
            self._live_ops = self._ops()
        self.pumps = {u: None for u in PUMP_UNITS}
        self.roads_closed, self.relief_open = {}, {}

    def _reset_operations(self):
        self.incidents = {}
        self.closed_incidents = deque(maxlen=40)
        self.pumps = {u: None for u in PUMP_UNITS}
        self.roads_closed = {}
        self.relief_open = {}
        self._hour_done = {}

    def _ensure_weather(self, until):
        last = max(self.weather) if self.weather else self.t
        while last < until:
            idx = pd.date_range(last + pd.Timedelta(hours=1), periods=72, freq="h")
            for ts, r in zip(idx, background_rain(idx, self.rng)):
                self.weather.setdefault(ts, float(r))
            last = idx[-1]

    def _tide_highs(self):
        t = self.t
        if self._highs is None or self._highs[2] < t + pd.Timedelta(days=2) or self._highs[4] > t - pd.Timedelta(hours=13):
            ext = tide_extremes(t - pd.Timedelta(days=1), t + pd.Timedelta(days=12))
            highs = [(ts, z) for kind, ts, z in ext if kind == "high"]
            self._high_ts = [ts for ts, _ in highs]
            self._highs = (
                np.array([(ts - EPOCH) / pd.Timedelta(hours=1) for ts, _ in highs]),
                np.array([z for _, z in highs]),
                highs[-1][0],
                ext,
                ext[0][1],
            )
        return self._highs

    def _surge_at(self, ts):
        return self.surge.get(pd.Timestamp(ts).floor("h"), 0.0) if self.mode == "live" else 0.0

    def _next_tides(self):
        """Next high and low tide after the sensor clock, with any forecast surge."""
        ext = self._tide_highs()[3]
        future = [(k, ts, z) for k, ts, z in ext if ts > self.t]
        nh = next(((ts, z) for k, ts, z in future if k == "high"), None)
        nl = next(((ts, z) for k, ts, z in future if k == "low"), None)
        if nh:
            nh = (nh[0], round(nh[1] + self._surge_at(nh[0]), 2), round(self._surge_at(nh[0]), 2))
        return nh, nl

    @property
    def source(self):
        return "replay" if self.mode == "replay" else "drill" if self.drill else "live"

    # ─── Stepping ─────────────────────────────────────────────────────────
    def _historical(self):
        if self._hist is None:
            self._hist = pd.read_csv(DATA_DIR / "sensor_history.csv", parse_dates=["time"]).set_index(["time", "hotspot_id"]).sort_index()
        return self._hist

    def _pump_mmhr(self, hid):
        return PUMP_MMHR * sum(1 for v in self.pumps.values() if v and v["hotspot_id"] == hid)

    def _advance(self, quiet=False, evaluate=True):
        """Move the clock forward one hour and record sensor readings."""
        self.t = self.t + pd.Timedelta(hours=1)
        t = self.t
        if self.mode == "replay":
            hist = self._historical()
            rec = {"time": t, "hs": {}}
            for hp in HOTSPOTS:
                r = hist.loc[(t, hp["id"])]
                rec["hs"][hp["id"]] = {"rain": float(r["rain_mm"]), "f3": float(r["rain_fcst_3h"]), "f6": float(r["rain_fcst_6h"]),
                                       "drain": float(r["drain_pct"]), "depth": float(r["depth_cm"])}
            first = hist.loc[(t, HOTSPOTS[0]["id"])]
            rec["tide"], rec["tide_astro"], rec["river"] = float(first["tide_m"]), float(first["tide_astro_m"]), float(first["river_m"])
            rec["rain_city"] = float(np.mean([v["rain"] / HOTSPOT_BY_ID[k]["rain_mult"] for k, v in rec["hs"].items()]))
        else:
            self._ensure_weather(t + pd.Timedelta(hours=12))
            rain_city = self.weather.pop(t, 0.0)
            astro = float(tide_at([hours_since_epoch(t)])[0])
            tide = astro + self.surge.get(t, 0.0) + float(self.rng.normal(0, 0.015))
            self.river_store = self.river_store * np.exp(-1 / RIVER_TAU_H) + rain_city
            river_true = RIVER_BASE + RIVER_TIDE_GAIN * (tide - TIDE_MEAN) + RIVER_STORE_GAIN * self.river_store
            rec = {"time": t, "rain_city": rain_city, "tide": tide, "tide_astro": astro,
                   "river": river_true + float(self.rng.normal(0, 0.015)), "river_true": river_true, "hs": {}}
            for hp in HOTSPOTS:
                st = self.state[hp["id"]]
                local = rain_city * hp["rain_mult"] * (float(np.exp(self.rng.normal(0, 0.12))) if rain_city > 0 else 1.0)
                st["S"], st["D"], drain = step(hp, st["S"], st["D"], local, st["prev"], tide, river_true,
                                               pump=self._pump_mmhr(hp["id"]))
                st["prev"] = local
                rec["hs"][hp["id"]] = {"rain": round(local, 1), "drain": float(np.clip(drain + self.rng.normal(0, 0.8), 0, 100)),
                                       "depth": round(st["D"], 1), "pump_mmhr": self._pump_mmhr(hp["id"])}
        self.rows.append(rec)
        if evaluate:
            self._evaluate(quiet=quiet)

    def _forecast(self, hp, t):
        """Hourly rain forecast for the next 6 h at this hotspot (mm per hour).

        Live: the coming weather with a forecast error (exact during a drill).
        Replay: the archive only holds 3 h and 6 h totals, spread evenly.
        """
        if self.mode == "replay":
            v = self.rows[-1]["hs"][hp["id"]]
            return [v["f3"] / 3] * 3 + [max(0.0, v["f6"] - v["f3"]) / 3] * 3
        nxt = [self.weather.get(t + pd.Timedelta(hours=k), 0.0) * hp["rain_mult"] for k in range(1, 7)]
        if self.exact_forecast_until is None or t > self.exact_forecast_until:
            err = float(np.exp(self.rng.normal(0, 0.25)))
            nxt = [v * err for v in nxt]
        return nxt

    def _features(self, hp):
        rows = list(self.rows)[-7:]
        hid = hp["id"]
        rain = np.array([r["hs"][hid]["rain"] for r in rows])
        drain = np.array([r["hs"][hid]["drain"] for r in rows])
        depth = np.array([r["hs"][hid]["depth"] for r in rows])
        hours = np.array([(r["time"] - EPOCH) / pd.Timedelta(hours=1) for r in rows])
        hourly = self._forecast(hp, self.t)
        rows[-1]["hs"][hid]["fc_hourly"] = [round(v, 1) for v in hourly]
        f3, f6 = sum(hourly[:3]), sum(hourly)
        highs_h, highs_z, _, _, _ = self._tide_highs()
        if self.surge and self.mode == "live":   # the tide forecast includes any forecast storm surge
            highs_z = highs_z + np.array([self.surge.get(ts.floor("h"), 0.0) for ts in self._high_ts])
        n = len(rows)
        X = feature_matrix(hp, hours, rain, np.full(n, f3), np.full(n, f6),
                           np.array([r["tide"] for r in rows]), highs_h, highs_z,
                           np.array([r["river"] for r in rows]), drain, depth)
        return dict(zip(FEATURES, X[-1]))

    def _cctv_in_force(self, hid):
        reading = self.cctv.get(hid)
        if reading and (reading["expires"] < time.time() or pd.Timestamp(reading["sim_time"]) < self.t):
            self.cctv.pop(hid)
            return None
        return reading

    def _evaluate(self, quiet=False):
        """Forecast every hotspot at the current hour."""
        rec = self.rows[-1]
        xs = {hp["id"]: self._features(hp) for hp in HOTSPOTS}
        P = self.model.predict(pd.DataFrame([xs[h["id"]] for h in HOTSPOTS]))
        for i, hp in enumerate(HOTSPOTS):
            hid = hp["id"]
            probs = {f"{h}h": float(P[i, j]) for j, h in enumerate(HORIZONS)}
            reading = self._cctv_in_force(hid)
            fused = cctv.fuse(probs, reading) if reading else probs
            rec["hs"][hid]["p"] = {k: round(v, 3) for k, v in fused.items()}
            rec["hs"][hid]["p_model"] = {k: round(v, 3) for k, v in probs.items()}
            rec["hs"][hid]["x"] = xs[hid]
        if quiet:
            return
        for hp in HOTSPOTS:
            self._assess(hp["id"])
        self.alerts.expire_stale(self.source, self.t, self.levels, open_incidents=set(self.incidents))

    def _context(self, hid):
        rec = self.rows[-1]
        prev = self.rows[-2] if len(self.rows) > 1 else None
        nh, _ = self._next_tides()
        inc = self.incidents.get(hid)
        return {
            "next_high_clock": f"{nh[0]:%H:%M}" if nh else None,
            "depth_change": rec["hs"][hid]["depth"] - prev["hs"][hid]["depth"] if prev else None,
            "river_change": rec["river"] - prev["river"] if prev else None,
            "incident_mechanism": inc["mechanism"] if inc else None,
            "cctv": self.cctv.get(hid),
        }

    def _assess(self, hid, silent=False):
        rec = self.rows[-1]
        h = rec["hs"][hid]
        hp = HOTSPOT_BY_ID[hid]
        a = self.model.assess(hid, h["x"], probs=[h["p"][f"{k}h"] for k in HORIZONS], context=self._context(hid))
        self.current[hid] = a
        if silent:
            self.levels[hid] = a["level"]
            return
        old, new = self.levels[hid], a["level"]
        if new != old:
            self.levels[hid] = new
            up = LEVEL_RANK[new] > LEVEL_RANK[old]
            tone = {"Danger": "danger", "Warning": "warning", "Watch": "info", "Normal": "success"}[new]
            self._log(tone if up or new == "Normal" else "info",
                      f"{hp['name']} {'raised' if up else 'lowered'} to {new.upper()}",
                      a["headline"], hid)
        if self._hour_done.get(hid) != self.t:
            self._hour_done[hid] = self.t
            self._new_hour(hid, a)
        if LEVEL_RANK[new] >= LEVEL_RANK["Warning"]:
            if self.alerts.should_draft(hid, new, self.source, self.t):
                alert = self.alerts.create(self.alert_context(hid))
                self._log("info", f"Alert drafted for {hp['name']}",
                          f"{new} {'exercise ' if self.source != 'live' else ''}draft {alert['id']} waiting for operator approval.",
                          hid, alert_id=alert["id"])

    def _new_hour(self, hid, a):
        """Once per sensor hour: field reports and the hotspot's incident record."""
        hp = HOTSPOT_BY_ID[hid]
        depth = self.rows[-1]["hs"][hid]["depth"]
        prev = self.rows[-2]["hs"][hid]["depth"] if len(self.rows) > 1 else 0.0
        if depth >= FLOOD_DEPTH_CM > prev:
            self._log("danger", f"Flooding reported at {hp['name']}",
                      f"About {int(depth)} cm of water on {hp['roads'][0]} (Smart Drain {hp['drain_id']} above-rim gauge).", hid)
        elif prev >= FLOOD_DEPTH_CM > depth:
            self._log("success", f"Flooding cleared at {hp['name']}",
                      f"Water on the road is down to {int(depth)} cm, below the {FLOOD_DEPTH_CM:.0f} cm flood depth.", hid)

        inc = self.incidents.get(hid)
        active = LEVEL_RANK[a["level"]] >= LEVEL_RANK["Warning"] or depth >= FLOOD_DEPTH_CM
        if inc is None:
            if active:
                inc = {
                    "id": "INC-" + uuid.uuid4().hex[:5].upper(), "hotspot_id": hid, "hotspot_name": hp["name"],
                    "source": self.source, "opened": iso(self.t), "closed": None, "status": "open",
                    "mechanism": a["mechanism"] or "Rainfall Overload", "level": a["level"], "peak_level": a["level"],
                    "peak_depth_cm": int(depth), "flooded_hours": int(depth >= FLOOD_DEPTH_CM),
                    "first_flooding": iso(self.t) if depth >= FLOOD_DEPTH_CM else None,
                    "max_prob_6h": a["probs"]["6h"], "quiet_hours": 0,
                }
                self.incidents[hid] = inc
                self._log("warning", f"Incident {inc['id']} opened: {hp['name']}",
                          f"{a['level']} ({inc['mechanism']}). Track actions in the Alert Centre and Digital Twin.", hid)
            return
        inc["level"] = a["level"]
        if LEVEL_RANK[a["level"]] > LEVEL_RANK[inc["peak_level"]]:
            inc["peak_level"] = a["level"]
        if a["mechanism"] and MECH_PRIORITY.get(a["mechanism"], 0) > MECH_PRIORITY.get(inc["mechanism"], 0):
            inc["mechanism"] = a["mechanism"]
        inc["peak_depth_cm"] = int(max(inc["peak_depth_cm"], depth))
        inc["max_prob_6h"] = max(inc["max_prob_6h"], a["probs"]["6h"])
        if depth >= FLOOD_DEPTH_CM:
            inc["flooded_hours"] += 1
            inc["first_flooding"] = inc["first_flooding"] or iso(self.t)
        quiet = a["level"] == "Normal" and depth < 2
        inc["quiet_hours"] = inc["quiet_hours"] + 1 if quiet else 0
        if inc["quiet_hours"] >= INCIDENT_QUIET_HOURS:
            inc.update(status="closed", closed=iso(self.t))
            self.closed_incidents.appendleft(self.incidents.pop(hid))
            flooded = (f"flooded for {inc['flooded_hours']} h, peak {inc['peak_depth_cm']:.0f} cm"
                       if inc["flooded_hours"] else "no flooding reached the road")
            self._log("success", f"Incident {inc['id']} closed: {hp['name']}",
                      f"Back to Normal. Peak level {inc['peak_level']}; {flooded}.", hid)
            if self.alerts.sent_since(hid, self.source, inc["opened"]):
                alert = self.alerts.create(self.alert_context(hid, kind="all_clear", incident=inc))
                self._log("info", f"All-clear drafted for {hp['name']}",
                          f"Draft {alert['id']} lets residents know the flood risk has eased.", hid, alert_id=alert["id"])

    def _log(self, tone, title, message, hotspot_id=None, alert_id=None):
        self.events.appendleft({
            "id": uuid.uuid4().hex[:8], "tone": tone, "title": title, "message": message,
            "hotspot_id": hotspot_id, "alert_id": alert_id, "sim_time": iso(self.t), "created_at": myt_stamp(),
        })

    def log(self, tone, title, message, hotspot_id=None, alert_id=None):
        """Operator actions recorded from the API (approvals, CCTV checks…)."""
        with self.lock:
            self._log(tone, title, message, hotspot_id, alert_id)

    # ─── Clock ────────────────────────────────────────────────────────────
    @property
    def synced(self):
        """True when the feed is live, real-time and on the wall-clock hour."""
        return self.mode == "live" and self.drill is None and self.speed == "realtime"

    def tick(self):
        with self.lock:
            if not self.playing:
                self.last_tick = time.monotonic()
                return
            if self.synced:
                behind = int((myt_now().floor("h") - self.t) / pd.Timedelta(hours=1))
                if behind > 6:   # the server slept: catch up quietly, then evaluate the last hours
                    for _ in range(behind - 6):
                        self._advance(quiet=True, evaluate=False)
                    behind = 6
                for _ in range(max(0, behind)):
                    self._advance()
                self.last_tick = time.monotonic()
                return
            period = SPEEDS[self.speed]
            due = int((time.monotonic() - self.last_tick) // period)
            for _ in range(min(due, 6)):
                if self.mode == "replay" and self.t >= self.replay["end"]:
                    self.playing = False
                    self._log("info", "Replay finished", f"Event {self.replay['event_id']} replay complete.")
                    break
                self._advance()
            if due:
                self.last_tick += due * period

    # ─── Controls ─────────────────────────────────────────────────────────
    def control(self, action, **kw):
        with self.lock:
            if action == "play":
                self.playing = True
                self.last_tick = time.monotonic()
            elif action == "pause":
                self.playing = False
            elif action == "speed":
                if kw.get("speed") not in SPEEDS:
                    raise ValueError(f"Unknown speed {kw.get('speed')}")
                self.speed = kw["speed"]
                self.last_tick = time.monotonic()
            elif action == "step":
                if not (self.mode == "replay" and self.t >= self.replay["end"]):
                    self._advance()
                self.last_tick = time.monotonic()
            elif action == "reset":
                self.speed = "realtime"
                self.playing = True
                self.reset()
            elif action == "drill":
                self.start_drill(**{k: v for k, v in kw.items() if k in ("rate", "duration")})
            elif action == "replay":
                self.start_replay(kw.get("event_id"))
            else:
                raise ValueError(f"Unknown action {action}")

    def start_drill(self, rate=40.0, duration=3, peak_tide=2.45):
        """Send a storm in with the next big high tide (an exercise).

        Takes the higher of the next two high tides and adds a forecast storm
        surge so the water level peaks at about `peak_tide`. The clock jumps to
        two hours before high tide, when the storm is about to arrive.
        """
        if self.mode != "live" or self.drill:
            self.reset()
        # Fixed sensor noise, so the same drill started at the same hour plays out the same way.
        self.rng = np.random.default_rng(DRILL_SEED)
        self.alerts.expire_open(("drill",), "Superseded by a new drill")
        self._set_aside_live_ops()
        self.incidents, self.closed_incidents = {}, deque(maxlen=40)
        ext = tide_extremes(self.t + pd.Timedelta(hours=3), self.t + pd.Timedelta(hours=30))
        ht, z = max(((ts, z) for kind, ts, z in ext if kind == "high"), key=lambda v: v[1])
        surge = max(0.1, peak_tide - z)
        start = ht.floor("h") - pd.Timedelta(hours=2)
        self._ensure_weather(start + pd.Timedelta(hours=duration + 12))
        for k in range(-12, duration + 8):   # a dry spell before the drill keeps it clean
            self.weather[start + pd.Timedelta(hours=k)] = 0.0
        while self.t < start:
            self._advance(quiet=True, evaluate=start - self.t <= pd.Timedelta(hours=WARM_EVAL_HOURS))
        for k in range(1, duration + 1):
            self.weather[start + pd.Timedelta(hours=k)] = float(rate)
        for k in range(-5, 6):   # storm surge on top of the astronomical tide
            self.surge[ht.floor("h") + pd.Timedelta(hours=k)] = surge * float(np.exp(-(k ** 2) / 8))
        self.exact_forecast_until = start + pd.Timedelta(hours=duration + 6)
        peak = round(z + surge, 2)
        self.drill = {"rate": rate, "duration": duration, "high_tide": iso(ht), "high_tide_m": peak,
                      "surge_m": round(surge, 2), "start": iso(start)}
        self._log("warning", "Storm drill started (exercise)",
                  f"{rate:.0f} mm/hr storm for {duration} h arriving with a {peak:.2f} m high tide "
                  f"({surge:.2f} m storm surge) at {ht:%H:%M}. Alerts drafted now are exercises.")
        self._evaluate()
        self.playing = True
        self.speed = "normal" if self.speed == "realtime" else self.speed
        self.last_tick = time.monotonic()

    def start_replay(self, event_id=None):
        events = pd.read_csv(DATA_DIR / "flood_events.csv", parse_dates=["start", "end"])
        if event_id is None:
            ev = events.sort_values("severity", ascending=False).iloc[0]
        else:
            match = events[events["event_id"] == event_id]
            if match.empty:
                raise ValueError(f"Unknown event {event_id}")
            ev = match.iloc[0]
        self.alerts.expire_open(("drill", "replay"), "Exercise ended")
        self._set_aside_live_ops()
        start = ev["start"] - pd.Timedelta(hours=10)
        end = min(ev["end"] + pd.Timedelta(hours=6), ev["start"] + pd.Timedelta(hours=72))
        self.mode = "replay"
        self.drill = None
        self.cctv = {}
        self.surge = {}
        self.exact_forecast_until = None
        ops = (self.pumps, self.roads_closed, self.relief_open)
        self._reset_operations()
        self.pumps, self.roads_closed, self.relief_open = ops
        self.rows = deque(maxlen=HISTORY_HOURS)
        self.levels = {h["id"]: "Normal" for h in HOTSPOTS}
        self.t = start - pd.Timedelta(hours=48)
        self._highs = None
        while self.t < start:
            self._advance(quiet=True, evaluate=start - self.t <= pd.Timedelta(hours=WARM_EVAL_HOURS))
        for hp in HOTSPOTS:
            self._assess(hp["id"], silent=True)
        self.replay = {"event_id": ev["event_id"], "start": start, "end": end, "event_start": ev["start"],
                       "event_end": ev["end"], "mechanism": ev["mechanism"], "hotspots": ev["hotspots"].split(";"),
                       "peak_depth_cm": float(ev["peak_depth_cm"]), "truncated": bool(end < ev["end"])}
        self._log("info", f"Replaying {ev['event_id']} (exercise)",
                  f"{ev['mechanism']} event of {ev['start']:%d %b %Y}: {ev['n_hotspots']} hotspots, peak {ev['peak_depth_cm']:.0f} cm.")
        self.playing = True
        if self.speed == "realtime":
            self.speed = "normal"
        self.last_tick = time.monotonic()

    # ─── CCTV ─────────────────────────────────────────────────────────────
    def set_cctv(self, hid, reading):
        with self.lock:
            self.cctv[hid] = {**reading, "at": myt_stamp(), "sim_time": iso(self.t),
                              "expires": time.time() + CCTV_TTL_SECONDS}
            before = dict(self.current.get(hid, {}).get("probs", {}))
            self._evaluate()
            after = self.current[hid]["probs"]
            hp = HOTSPOT_BY_ID[hid]
            tone = "danger" if reading["status"] in ("Overflowing", "Road Flooded") else "info"
            self._log(tone, f"CCTV check at {hp['name']}: {reading['status']}",
                      f"{hp['cctv']}: {reading.get('observations', '')} +1 h risk {pct(before.get('1h', 0))} → {pct(after['1h'])}.", hid)
            return before, after

    def clear_cctv(self, hid):
        with self.lock:
            if self.cctv.pop(hid, None):
                self._evaluate()
                self._log("info", f"CCTV reading cleared at {HOTSPOT_BY_ID[hid]['name']}",
                          "The forecast is back to the model alone.", hid)

    # ─── Response actions ─────────────────────────────────────────────────
    def respond(self, action, hid, unit=None, operator="MSCCC duty officer"):
        """Deploy or recall a mobile pump, close or reopen roads, open or stand down a relief centre."""
        with self.lock:
            if self.mode == "replay":
                raise ResponseError("Response actions are not recorded during an event replay.")
            hp = HOTSPOT_BY_ID[hid]
            exercise = " (exercise)" if self.drill else ""
            if action == "deploy_pump":
                free = [u for u, v in self.pumps.items() if v is None]
                if unit is None:
                    if not free:
                        raise ResponseError("All mobile pumps are deployed. Recall one first.")
                    unit = free[0]
                elif unit not in self.pumps:
                    raise ResponseError(f"Unknown pump {unit}")
                elif self.pumps[unit] is not None:
                    raise ResponseError(f"{unit} is already deployed at {HOTSPOT_BY_ID[self.pumps[unit]['hotspot_id']]['name']}.")
                self.pumps[unit] = {"hotspot_id": hid, "since": iso(self.t), "by": operator}
                self._log("info", f"{unit} deployed to {hp['name']}{exercise}",
                          f"Mobile pump at {hp['pump_point']} adds about {PUMP_MMHR:.0f} mm/h of drain capacity. By {operator}.", hid)
            elif action == "recall_pump":
                units = [u for u, v in self.pumps.items() if v and v["hotspot_id"] == hid and (unit is None or u == unit)]
                if not units:
                    raise ResponseError(f"No pump is deployed at {hp['name']}.")
                self.pumps[units[0]] = None
                self._log("info", f"{units[0]} recalled from {hp['name']}{exercise}", f"Back at the depot. By {operator}.", hid)
            elif action == "close_roads":
                if hid in self.roads_closed:
                    raise ResponseError(f"Roads at {hp['name']} are already closed.")
                self.roads_closed[hid] = {"since": iso(self.t), "roads": hp["roads"], "by": operator}
                self._log("warning", f"Roads closed at {hp['name']}{exercise}",
                          f"{', '.join(hp['roads'])} closed and diverted (Polis Trafik Miri). By {operator}.", hid)
            elif action == "reopen_roads":
                if self.roads_closed.pop(hid, None) is None:
                    raise ResponseError(f"No roads are closed at {hp['name']}.")
                self._log("success", f"Roads reopened at {hp['name']}{exercise}", f"{', '.join(hp['roads'])} open. By {operator}.", hid)
            elif action == "open_relief":
                if hid in self.relief_open:
                    raise ResponseError(f"{hp['relief_centre']} is already open.")
                self.relief_open[hid] = {"since": iso(self.t), "by": operator}
                self._log("warning", f"Relief centre opened for {hp['name']}{exercise}",
                          f"{hp['relief_centre']} open (APM Miri). By {operator}.", hid)
            elif action == "close_relief":
                if self.relief_open.pop(hid, None) is None:
                    raise ResponseError(f"{hp['relief_centre']} is not open.")
                self._log("success", f"Relief centre stood down for {hp['name']}{exercise}", f"{hp['relief_centre']}. By {operator}.", hid)
            else:
                raise ResponseError(f"Unknown action {action}")
            return self.response_state()

    def response_state(self):
        return {
            "pumps": [{"unit": u, **(v or {"hotspot_id": None})} for u, v in self.pumps.items()],
            "pump_mmhr": PUMP_MMHR,
            "roads_closed": self.roads_closed,
            "relief_open": self.relief_open,
            "available": self.mode != "replay",
        }

    def _hotspot_response(self, hid):
        return {
            "pumps": [u for u, v in self.pumps.items() if v and v["hotspot_id"] == hid],
            "pump_mmhr": self._pump_mmhr(hid),
            "roads_closed": hid in self.roads_closed,
            "relief_open": hid in self.relief_open,
        }

    # ─── Read models ──────────────────────────────────────────────────────
    def alert_context(self, hid, kind=None, incident=None):
        hp = HOTSPOT_BY_ID[hid]
        a = self.current[hid]
        x = self.rows[-1]["hs"][hid]["x"]
        source = self.source
        if kind is None:
            kind = "warning" if LEVEL_RANK[a["level"]] >= LEVEL_RANK["Warning"] else "watch"
        first = next((h for h in HORIZONS if a["probs"][f"{h}h"] >= 0.5), int(a["alert_horizon"][:-1]))
        nh, _ = self._next_tides()
        reading = self.cctv.get(hid)
        inc = incident or self.incidents.get(hid)
        expected = self.t + pd.Timedelta(hours=first)
        return {
            "kind": kind,
            "hotspot_id": hid, "hotspot": hp["name"], "area": hp["area"], "roads": hp["roads"],
            "relief_centre": hp["relief_centre"], "pump_point": hp["pump_point"], "drain": hp["drain"],
            "drain_id": hp["drain_id"], "cctv_camera": hp["cctv"],
            "source": source, "exercise": source != "live",
            "sim_time": iso(self.t), "local_time_now": f"{self.t:%A %d %B %Y, %H:%M}",
            "level": "Normal" if kind == "all_clear" else a["level"],
            "probs": a["probs"], "alert_horizon": a["alert_horizon"],
            "flooding_now": a["flooding_now"], "water_depth_cm": a["water_depth_cm"],
            "expected_by": iso(self.t if a["flooding_now"] else expected),
            "expected_by_local": f"{self.t:%H:%M}" if a["flooding_now"] else f"{expected:%H:%M}",
            "mechanism": a["mechanism"] or (inc or {}).get("mechanism"), "headline": a["headline"],
            "drivers": [d["text"] for d in a["drivers"]],
            "sensors": {"rain_now_mmhr": round(x["rain_1h"], 1), "rain_forecast_3h_mm": round(x["rain_fcst_3h"], 0),
                        "drain_pct": round(x["drain_pct"], 0), "water_on_road_cm": int(x["water_depth_cm"]),
                        "river_m": round(x["river_m"], 2), "tide_m": round(x["tide_m"], 2)},
            "next_high_tide": {"time": f"{nh[0]:%H:%M}", "height_m": nh[1], "surge_m": nh[2]} if nh else None,
            "cctv_confirmation": {"status": reading["status"], "depth_cm": reading.get("depth_cm")} if reading else None,
            "incident": {k: inc[k] for k in ("id", "opened", "peak_level", "peak_depth_cm", "flooded_hours", "mechanism")} if inc else None,
            "response": self._hotspot_response(hid),
        }

    def _projection(self, hp, rec, pumps):
        """Run the hydraulic model forward PROJECTION_HOURS with the rain forecast the model sees."""
        hid = hp["id"]
        h = rec["hs"][hid]
        x = h["x"]
        rates = h.get("fc_hourly") or ([x["rain_fcst_3h"] / 3] * 3 + [max(0.0, x["rain_fcst_6h"] - x["rain_fcst_3h"]) / 3] * 3)
        if self.mode == "live":
            S, D, prev = self.state[hid]["S"], self.state[hid]["D"], self.state[hid]["prev"]
            store = self.river_store
        else:   # replay: back out the drain store and river store from the readings
            hyd = hydraulics(hp, rec["tide"], rec["river"])
            S = max(0.0, (h["drain"] - hyd["backwater_pct"]) / max(1e-6, 100 - hyd["backwater_pct"])) * hyd["storage_mm"]
            D, prev = h["depth"], h["rain"]
            store = max(0.0, (rec["river"] - RIVER_BASE - RIVER_TIDE_GAIN * (rec["tide"] - TIDE_MEAN)) / RIVER_STORE_GAIN)
        out = {"time": [], "rain": [], "tide": [], "river": [], "drain": [], "depth": []}
        for k in range(1, PROJECTION_HOURS + 1):
            ts = self.t + pd.Timedelta(hours=k)
            tide = float(tide_at([hours_since_epoch(ts)])[0]) + self._surge_at(ts)
            rain = rates[k - 1]
            store = store * np.exp(-1 / RIVER_TAU_H) + rain / hp["rain_mult"]
            river = RIVER_BASE + RIVER_TIDE_GAIN * (tide - TIDE_MEAN) + RIVER_STORE_GAIN * store
            S, D, drain = step(hp, S, D, rain, prev, tide, river, pump=pumps * PUMP_MMHR)
            prev = rain
            for key, v in (("time", iso(ts)), ("rain", round(rain, 1)), ("tide", round(tide, 2)),
                           ("river", round(river, 2)), ("drain", round(drain, 1)), ("depth", round(D, 1))):
                out[key].append(v)
        depth = np.array(out["depth"])
        flooded = np.where(depth >= FLOOD_DEPTH_CM)[0]
        out["peak_depth_cm"] = int(depth.max())
        out["peak_time"] = out["time"][int(depth.argmax())]
        out["first_flood_time"] = out["time"][int(flooded[0])] if len(flooded) else None
        return out

    def twin(self):
        """Digital twin: the hydraulic state of every hotspot now, and projected 6 h ahead."""
        self.tick()
        with self.lock:
            rec = self.rows[-1]
            prev = self.rows[-2] if len(self.rows) > 1 else rec
            nh, nl = self._next_tides()
            free_pumps = sum(1 for v in self.pumps.values() if v is None)
            river_for_drains = rec.get("river_true", rec["river"])
            sites = []
            for hp in HOTSPOTS:
                hid = hp["id"]
                h = rec["hs"][hid]
                a = self.current[hid]
                n_pumps = len(self._hotspot_response(hid)["pumps"])
                hyd = hydraulics(hp, rec["tide"], river_for_drains, pump=n_pumps * PUMP_MMHR)
                inflow = hp["runoff"] * h["rain"] + hp["lag"] * prev["hs"][hid]["rain"]
                proj = self._projection(hp, rec, n_pumps)
                options = {}
                if n_pumps:
                    options["without_pumps"] = {k: v for k, v in self._projection(hp, rec, 0).items()
                                                if k in ("peak_depth_cm", "first_flood_time", "depth")}
                if free_pumps and (proj["peak_depth_cm"] >= 2 or LEVEL_RANK[a["level"]] >= LEVEL_RANK["Warning"]):
                    options["one_more_pump"] = {k: v for k, v in self._projection(hp, rec, n_pumps + 1).items()
                                                if k in ("peak_depth_cm", "first_flood_time", "depth")}
                if hyd["tide_block_pct"] >= 70:
                    outfall = "Tide-locked"
                elif hyd["tide_block_pct"] >= 10:
                    outfall = "Partly tide-locked"
                elif hyd["river_block_pct"] >= 10:
                    outfall = "River backwater"
                else:
                    outfall = "Free-flowing"
                sites.append({
                    **public_hotspot(hp),
                    "level": a["level"], "probs": a["probs"], "mechanism": a["mechanism"], "headline": a["headline"],
                    "flooding_now": a["flooding_now"],
                    "state": {
                        "rain_mmhr": round(h["rain"], 1), "inflow_mmhr": round(inflow, 1),
                        "drain_pct": round(h["drain"], 1), "depth_cm": round(h["depth"], 1),
                        "depth_change": round(h["depth"] - prev["hs"][hid]["depth"], 1),
                        "drain_change": round(h["drain"] - prev["hs"][hid]["drain"], 1),
                        "rain_fcst_3h": round(h["x"]["rain_fcst_3h"], 1), "rain_fcst_6h": round(h["x"]["rain_fcst_6h"], 1),
                        "outfall_state": outfall, **hyd,
                        "overloaded": inflow > hyd["capacity_mmhr"],
                    },
                    "projection": proj, "options": options,
                    "response": self._hotspot_response(hid),
                    "cctv_reading": {k: v for k, v in self.cctv[hid].items() if k != "expires"} if hid in self.cctv else None,
                    "incident": self.incidents.get(hid),
                })
            ahead = [self.t + pd.Timedelta(hours=k) for k in range(0, 13)]
            return {
                "sim_time": iso(self.t), "mode": self.mode, "source": self.source, "drill": self.drill,
                "sea": {
                    "tide_m": round(rec["tide"], 2), "trend": "rising" if rec["tide"] >= prev["tide"] else "falling",
                    "high_tide_m": HIGH_TIDE_M,
                    "next_high": {"time": iso(nh[0]), "height_m": nh[1], "surge_m": nh[2]} if nh else None,
                    "next_low": {"time": iso(nl[0]), "height_m": nl[1]} if nl else None,
                    "ahead": {"time": [iso(t) for t in ahead],
                              "tide": [round(float(tide_at([hours_since_epoch(t)])[0]) + self._surge_at(t), 2) for t in ahead]},
                },
                "river": {"level_m": round(rec["river"], 2), "change_m": round(rec["river"] - prev["river"], 2),
                          "alert_m": RIVER_ALERT_M},
                "sites": sites,
                "response": self.response_state(),
            }

    def snapshot(self):
        self.tick()
        with self.lock:
            rec = self.rows[-1]
            nh, nl = self._next_tides()
            prev = self.rows[-2] if len(self.rows) > 1 else rec
            hotspots = []
            for hp in HOTSPOTS:
                hid = hp["id"]
                h = rec["hs"][hid]
                x = h["x"]
                reading = self.cctv.get(hid)
                hotspots.append({
                    **public_hotspot(hp),
                    "history_floods": self.history_floods[hid],
                    "sensors": {
                        "rain_mmhr": round(x["rain_1h"], 1), "rain_3h": round(x["rain_3h"], 1),
                        "rain_fcst_3h": round(x["rain_fcst_3h"], 1), "rain_fcst_6h": round(x["rain_fcst_6h"], 1),
                        "drain_pct": round(x["drain_pct"], 1), "drain_rate": round(x["drain_rate"], 1),
                        "river_m": round(x["river_m"], 2), "tide_m": round(x["tide_m"], 2),
                        "hours_to_high_tide": round(x["hours_to_high_tide"], 2), "next_high_m": round(x["tide_next_high_m"], 2),
                        "flooding_observed": h["depth"] >= FLOOD_DEPTH_CM, "water_depth_cm": int(h["depth"]),
                        "depth_change": round(h["depth"] - prev["hs"][hid]["depth"], 1),
                    },
                    "assessment": self.current.get(hid),
                    "cctv_reading": {k: v for k, v in reading.items() if k != "expires"} if reading else None,
                    "incident": self.incidents.get(hid),
                    "response": self._hotspot_response(hid),
                })
            next_tick = None
            now = myt_now()
            if self.playing:
                if self.synced:
                    next_tick = max(0.0, ((now.floor("h") + pd.Timedelta(hours=1)) - now).total_seconds())
                else:
                    next_tick = max(0.0, SPEEDS[self.speed] - (time.monotonic() - self.last_tick))
            offset_h = round((self.t - now.floor("h")) / pd.Timedelta(hours=1), 1)
            rains = [v["rain"] for v in rec["hs"].values()]
            fc3 = [h["sensors"]["rain_fcst_3h"] for h in hotspots]
            return {
                "mode": self.mode, "source": self.source, "sim_time": iso(self.t), "playing": self.playing, "speed": self.speed,
                "tick_seconds": SPEEDS[self.speed], "next_tick_in": next_tick,
                "clock": {"real_time": iso(now.floor("s")), "offset_h": offset_h,
                          "synced": self.synced and abs(offset_h) < 1},
                "drill": self.drill,
                "replay": ({**self.replay, "start": iso(self.replay["start"]), "end": iso(self.replay["end"]),
                            "event_start": iso(self.replay["event_start"]), "event_end": iso(self.replay["event_end"]),
                            "progress": round(float((self.t - self.replay["start"]) / (self.replay["end"] - self.replay["start"])), 3)}
                           if self.replay else None),
                "city": {
                    "rain_mmhr": round(float(np.mean(rains)), 1), "rain_max_mmhr": round(float(max(rains)), 1),
                    "rain_fcst_3h_mean": round(float(np.mean(fc3)), 0), "rain_fcst_3h_max": round(float(max(fc3)), 0),
                    "tide_m": round(rec["tide"], 2), "tide_trend": "rising" if rec["tide"] >= prev["tide"] else "falling",
                    "river_m": round(rec["river"], 2), "river_trend": round(rec["river"] - prev["river"], 2),
                    "river_alert_m": RIVER_ALERT_M,
                    "max_drain_pct": round(max(v["drain"] for v in rec["hs"].values()), 0),
                    "max_drain_hotspot": max(rec["hs"], key=lambda k: rec["hs"][k]["drain"]),
                    "flooding_now": sum(1 for v in rec["hs"].values() if v["depth"] >= FLOOD_DEPTH_CM),
                    "next_high": {"time": iso(nh[0]), "height_m": nh[1], "surge_m": nh[2],
                                  "in_h": round((nh[0] - self.t) / pd.Timedelta(hours=1), 2)} if nh else None,
                    "next_low": {"time": iso(nl[0]), "height_m": nl[1],
                                 "in_h": round((nl[0] - self.t) / pd.Timedelta(hours=1), 2)} if nl else None,
                },
                "hotspots": hotspots,
                "incidents": {"open": list(self.incidents.values()), "closed": list(self.closed_incidents)},
                "response": self.response_state(),
                "events": list(self.events)[:60],
            }

    def twin_history(self, hours=24):
        """Recorded state of every site, hour by hour, for the twin's time scrubber."""
        with self.lock:
            rows = list(self.rows)[-(hours + 1):]
            sites = {}
            for hp in HOTSPOTS:
                hid = hp["id"]
                lv = []
                for r in rows:
                    v = r["hs"][hid]
                    p = v.get("p")
                    lv.append("Danger" if v["depth"] >= FLOOD_DEPTH_CM else level_for(max(p.values())) if p else None)
                sites[hid] = {
                    "rain": [round(r["hs"][hid]["rain"], 1) for r in rows],
                    "drain": [round(r["hs"][hid]["drain"], 1) for r in rows],
                    "depth": [round(r["hs"][hid]["depth"], 1) for r in rows],
                    "pump_mmhr": [r["hs"][hid].get("pump_mmhr", 0.0) for r in rows],
                    "p3": [r["hs"][hid].get("p", {}).get("3h") for r in rows],
                    "level": lv,
                }
            return {"time": [iso(r["time"]) for r in rows], "tide": [round(r["tide"], 2) for r in rows],
                    "river": [round(r["river"], 2) for r in rows], "sites": sites}

    def history(self, hid, hours=48):
        with self.lock:
            rows = list(self.rows)[-hours:]
            out = {
                "time": [iso(r["time"]) for r in rows],
                "rain": [round(r["hs"][hid]["rain"], 1) for r in rows],
                "drain": [round(r["hs"][hid]["drain"], 1) for r in rows],
                "depth": [round(r["hs"][hid]["depth"], 1) for r in rows],
                "tide": [round(r["tide"], 2) for r in rows],
                "river": [round(r["river"], 2) for r in rows],
                "p1": [r["hs"][hid].get("p", {}).get("1h") for r in rows],
                "p3": [r["hs"][hid].get("p", {}).get("3h") for r in rows],
                "p6": [r["hs"][hid].get("p", {}).get("6h") for r in rows],
            }
            # Predicted tide (with any forecast surge) for the next 12 h, for context on the charts.
            ahead = [self.t + pd.Timedelta(hours=k) for k in range(1, 13)]
            out["tide_ahead"] = {"time": [iso(t) for t in ahead],
                                 "tide": [round(float(tide_at([hours_since_epoch(t)])[0]) + self._surge_at(t), 2) for t in ahead]}
            return out

    def tide_table(self, days=3):
        with self.lock:
            ext = self._tide_highs()[3]
            if self._highs[2] < self.t + pd.Timedelta(days=days):
                ext = tide_extremes(self.t - pd.Timedelta(hours=12), self.t + pd.Timedelta(days=days))
            end = self.t + pd.Timedelta(days=days)
            out = []
            for k, ts, z in ext:
                if self.t - pd.Timedelta(hours=12) <= ts <= end:
                    s = self._surge_at(ts) if k == "high" else 0.0
                    out.append({"type": k, "time": iso(ts), "height_m": round(z + s, 2), "surge_m": round(s, 2),
                                "past": bool(ts <= self.t), "above_high_tide": bool(k == "high" and z + s >= HIGH_TIDE_M)})
            return out
