"""Live feed: a simulated sensor stream that advances hour by hour.

Modes
  live    background Miri weather stepped through the hydrology model
  replay  a historical event played back from sensor_history.csv

The clock is simulated: one sensor hour passes every `tick_seconds` of real
time while playing. Each hour the engine forecasts every hotspot, fuses any
CCTV reading, logs level changes and asks the alert store for drafts when a
hotspot reaches Warning or Danger.
"""
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from . import cctv
from .config import DATA_DIR, FEATURES, HORIZONS, HOTSPOT_BY_ID, HOTSPOTS, LEVEL_RANK, level_for, public_hotspot
from .features import feature_matrix
from .physics import (
    EPOCH, RIVER_BASE, RIVER_STORE_GAIN, RIVER_TAU_H, RIVER_TIDE_GAIN, TIDE_MEAN,
    background_rain, hours_since_epoch, step, tide_at, tide_extremes,
)

SPEEDS = {"realtime": 3600, "normal": 20, "fast": 8, "demo": 3}
HISTORY_HOURS = 72
WARM_EVAL_HOURS = 36   # forecasts kept for the charts when the clock jumps (reset, drill, replay)
CCTV_TTL_SECONDS = 30 * 60


def myt_now() -> pd.Timestamp:
    """Current time in Malaysia (UTC+8), timezone-naive."""
    return pd.Timestamp(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=8))


def iso(ts) -> str:
    return pd.Timestamp(ts).isoformat()


class LiveEngine:
    def __init__(self, model, alerts):
        self.model = model
        self.alerts = alerts
        self.lock = threading.RLock()
        self.speed = "normal"
        self.playing = True
        self._hist = None
        self.reset()

    # ─── Setup ────────────────────────────────────────────────────────────
    def reset(self):
        with self.lock:
            self.rng = np.random.default_rng()
            self.mode = "live"
            self.replay = None
            self.drill = None
            self.events = deque(maxlen=200)
            self.rows = deque(maxlen=HISTORY_HOURS)
            self.cctv = {}
            self.weather, self.surge = {}, {}
            self.exact_forecast_until = None
            self.state = {h["id"]: {"S": 0.0, "D": 0.0, "prev": 0.0} for h in HOTSPOTS}
            self.river_store = 0.0
            self.levels = {h["id"]: "Normal" for h in HOTSPOTS}
            self.current = {}
            now = myt_now().floor("h")
            self.t = now - pd.Timedelta(hours=HISTORY_HOURS + 24)
            self._highs = None
            self._ensure_weather(now + pd.Timedelta(hours=36))
            while self.t < now:
                self._advance(quiet=True, evaluate=now - self.t <= pd.Timedelta(hours=WARM_EVAL_HOURS))
            for hp in HOTSPOTS:
                self._assess(hp["id"], silent=True)
            self.last_tick = time.monotonic()
            self._log("info", "Live feed started", "Simulated sensor feed for the six hotspots.")

    def _ensure_weather(self, until):
        last = max(self.weather) if self.weather else self.t
        while last < until:
            idx = pd.date_range(last + pd.Timedelta(hours=1), periods=72, freq="h")
            for ts, r in zip(idx, background_rain(idx, self.rng)):
                self.weather.setdefault(ts, float(r))
            last = idx[-1]

    def _tide_highs(self):
        t = self.t
        if self._highs is None or self._highs[2] < t + pd.Timedelta(days=2):
            ext = tide_extremes(t - pd.Timedelta(days=1), t + pd.Timedelta(days=12))
            highs = [(ts, z) for kind, ts, z in ext if kind == "high"]
            self._high_ts = [ts for ts, _ in highs]
            self._highs = (
                np.array([(ts - EPOCH) / pd.Timedelta(hours=1) for ts, _ in highs]),
                np.array([z for _, z in highs]),
                highs[-1][0],
                ext,
            )
        return self._highs

    # ─── Stepping ─────────────────────────────────────────────────────────
    def _historical(self):
        if self._hist is None:
            self._hist = pd.read_csv(DATA_DIR / "sensor_history.csv", parse_dates=["time"]).set_index(["time", "hotspot_id"]).sort_index()
        return self._hist

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
                   "river": river_true + float(self.rng.normal(0, 0.015)), "hs": {}}
            for hp in HOTSPOTS:
                st = self.state[hp["id"]]
                local = rain_city * hp["rain_mult"] * (float(np.exp(self.rng.normal(0, 0.12))) if rain_city > 0 else 1.0)
                st["S"], st["D"], drain = step(hp, st["S"], st["D"], local, st["prev"], tide, river_true)
                st["prev"] = local
                rec["hs"][hp["id"]] = {"rain": round(local, 1), "drain": float(np.clip(drain + self.rng.normal(0, 0.8), 0, 100)),
                                       "depth": st["D"]}
        self.rows.append(rec)
        if evaluate:
            self._evaluate(quiet=quiet)

    def _forecast(self, hp, t):
        """Rain forecast for the next 3 h and 6 h at this hotspot."""
        if self.mode == "replay":
            v = self.rows[-1]["hs"][hp["id"]]
            return v["f3"], v["f6"]
        nxt = [self.weather.get(t + pd.Timedelta(hours=k), 0.0) * hp["rain_mult"] for k in range(1, 7)]
        f3, f6 = sum(nxt[:3]), sum(nxt)
        if self.exact_forecast_until is None or t > self.exact_forecast_until:
            err = float(np.exp(self.rng.normal(0, 0.25)))
            f3, f6 = f3 * err, f6 * err
        return f3, f6

    def _features(self, hp):
        rows = list(self.rows)[-7:]
        hid = hp["id"]
        rain = np.array([r["hs"][hid]["rain"] for r in rows])
        drain = np.array([r["hs"][hid]["drain"] for r in rows])
        hours = np.array([(r["time"] - EPOCH) / pd.Timedelta(hours=1) for r in rows])
        f3, f6 = self._forecast(hp, self.t)
        highs_h, highs_z, _, _ = self._tide_highs()
        if self.surge:   # the tide forecast includes any forecast storm surge
            highs_z = highs_z + np.array([self.surge.get(ts.floor("h"), 0.0) for ts in self._high_ts])
        n = len(rows)
        X = feature_matrix(hp, hours, rain, np.full(n, f3), np.full(n, f6),
                           np.array([r["tide"] for r in rows]), highs_h, highs_z,
                           np.array([r["river"] for r in rows]), drain)
        return dict(zip(FEATURES, X[-1]))

    def _evaluate(self, quiet=False):
        """Forecast every hotspot at the current hour."""
        rec = self.rows[-1]
        xs = {hp["id"]: self._features(hp) for hp in HOTSPOTS}
        P = self.model.predict(pd.DataFrame([xs[h["id"]] for h in HOTSPOTS]))
        now_real = time.time()
        for i, hp in enumerate(HOTSPOTS):
            hid = hp["id"]
            probs = {f"{h}h": float(P[i, j]) for j, h in enumerate(HORIZONS)}
            reading = self.cctv.get(hid)
            if reading and reading["expires"] < now_real:
                self.cctv.pop(hid)
                reading = None
            fused = cctv.fuse(probs, reading) if reading else probs
            rec["hs"][hid]["p"] = {k: round(v, 3) for k, v in fused.items()}
            rec["hs"][hid]["p_model"] = {k: round(v, 3) for k, v in probs.items()}
            rec["hs"][hid]["x"] = xs[hid]
        if quiet:
            return
        for hp in HOTSPOTS:
            self._assess(hp["id"])

    def _assess(self, hid, silent=False):
        rec = self.rows[-1]
        h = rec["hs"][hid]
        hp = HOTSPOT_BY_ID[hid]
        a = self.model.assess(hid, h["x"], probs=[h["p"][f"{k}h"] for k in HORIZONS])
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
        if h["depth"] >= 10 and (len(self.rows) < 2 or self.rows[-2]["hs"][hid]["depth"] < 10):
            self._log("danger", f"Flooding reported at {hp['name']}",
                      f"Road water about {h['depth']:.0f} cm deep (field report).", hid)
        if LEVEL_RANK[new] >= LEVEL_RANK["Warning"]:
            source = "replay" if self.mode == "replay" else "live"
            if self.alerts.should_draft(hid, new, source, self.t):
                self.alerts.create(self.alert_context(hid, source))
                self._log("info", f"Alert drafted for {hp['name']}", f"{new} draft waiting for operator approval.", hid)

    def _log(self, tone, title, message, hotspot_id=None):
        self.events.appendleft({
            "id": uuid.uuid4().hex[:8], "tone": tone, "title": title, "message": message,
            "hotspot_id": hotspot_id, "sim_time": iso(self.t), "created_at": datetime.now().isoformat(timespec="seconds"),
        })

    # ─── Clock ────────────────────────────────────────────────────────────
    def tick(self):
        with self.lock:
            if not self.playing:
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
                if kw.get("speed") in SPEEDS:
                    self.speed = kw["speed"]
                    self.last_tick = time.monotonic()
            elif action == "step":
                if not (self.mode == "replay" and self.t >= self.replay["end"]):
                    self._advance()
                self.last_tick = time.monotonic()
            elif action == "reset":
                self.reset()
            elif action == "drill":
                self.start_drill(**{k: v for k, v in kw.items() if k in ("rate", "duration")})
            elif action == "replay":
                self.start_replay(kw.get("event_id"))
            else:
                raise ValueError(f"Unknown action {action}")

    def start_drill(self, rate=40.0, duration=3, peak_tide=2.45):
        """Send a storm in with the next big high tide.

        Takes the higher of the next two high tides and adds a forecast storm
        surge so the water level peaks at about `peak_tide`. The clock jumps to
        two hours before high tide, when the storm is about to arrive.
        """
        if self.mode != "live":
            self.reset()
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
        self.drill = {"rate": rate, "duration": duration, "high_tide": iso(ht), "high_tide_m": round(z + surge, 2),
                      "surge_m": round(surge, 2), "start": iso(start)}
        self._evaluate()
        self._log("warning", "Storm drill started",
                  f"{rate:.0f} mm/hr storm for {duration} h arriving with a {z + surge:.1f} m high tide "
                  f"({surge:.1f} m storm surge) at {ht:%H:%M}.")
        self.playing = True
        self.speed = "normal" if self.speed == "realtime" else self.speed
        self.last_tick = time.monotonic()

    def start_replay(self, event_id=None):
        events = pd.read_csv(DATA_DIR / "flood_events.csv", parse_dates=["start", "end"])
        if event_id is None:
            ev = events.sort_values("severity", ascending=False).iloc[0]
        else:
            ev = events[events["event_id"] == event_id].iloc[0]
        start = ev["start"] - pd.Timedelta(hours=10)
        end = min(ev["end"] + pd.Timedelta(hours=6), ev["start"] + pd.Timedelta(hours=72))
        self.mode = "replay"
        self.drill = None
        self.cctv = {}
        self.rows = deque(maxlen=HISTORY_HOURS)
        self.levels = {h["id"]: "Normal" for h in HOTSPOTS}
        self.t = start - pd.Timedelta(hours=48)
        self._highs = None
        while self.t < start:
            self._advance(quiet=True, evaluate=start - self.t <= pd.Timedelta(hours=WARM_EVAL_HOURS))
        for hp in HOTSPOTS:
            self._assess(hp["id"], silent=True)
        self.replay = {"event_id": ev["event_id"], "start": start, "end": end, "event_start": ev["start"],
                       "mechanism": ev["mechanism"], "hotspots": ev["hotspots"].split(";")}
        self._log("info", f"Replaying {ev['event_id']}",
                  f"{ev['mechanism']} event of {ev['start']:%d %b %Y}: {ev['n_hotspots']} hotspots, peak {ev['peak_depth_cm']:.0f} cm.")
        self.playing = True
        self.last_tick = time.monotonic()

    def set_cctv(self, hid, reading):
        with self.lock:
            self.cctv[hid] = {**reading, "at": datetime.now().isoformat(timespec="seconds"),
                              "expires": time.time() + CCTV_TTL_SECONDS}
            before = dict(self.current.get(hid, {}).get("probs", {}))
            self._evaluate()
            after = self.current[hid]["probs"]
            hp = HOTSPOT_BY_ID[hid]
            tone = "danger" if reading["status"] in ("Overflowing", "Road Flooded") else "info"
            self._log(tone, f"CCTV check at {hp['name']}: {reading['status']}",
                      f"{reading.get('observations', '')} +1h risk {before.get('1h', 0):.0%} → {after['1h']:.0%}.", hid)
            return before, after

    def clear_cctv(self, hid):
        with self.lock:
            self.cctv.pop(hid, None)
            self._evaluate()

    # ─── Read models ──────────────────────────────────────────────────────
    def alert_context(self, hid, source):
        hp = HOTSPOT_BY_ID[hid]
        a = self.current[hid]
        x = self.rows[-1]["hs"][hid]["x"]
        first = next((h for h in HORIZONS if a["probs"][f"{h}h"] >= 0.5), int(a["alert_horizon"][:-1]))
        _, _, _, ext = self._tide_highs()
        nh = next(((ts, z) for kind, ts, z in ext if kind == "high" and ts > self.t), None)
        reading = self.cctv.get(hid)
        return {
            "hotspot_id": hid, "hotspot": hp["name"], "area": hp["area"], "roads": hp["roads"],
            "relief_centre": hp["relief_centre"], "pump_point": hp["pump_point"], "drain": hp["drain"], "cctv_camera": hp["cctv"],
            "source": source, "exercise": source != "live",
            "sim_time": iso(self.t), "local_time_now": f"{self.t:%A %d %B %Y, %H:%M}",
            "level": a["level"], "probs": a["probs"], "alert_horizon": a["alert_horizon"],
            "expected_by": iso(self.t + pd.Timedelta(hours=first)),
            "expected_by_local": f"{self.t + pd.Timedelta(hours=first):%H:%M}",
            "mechanism": a["mechanism"], "headline": a["headline"],
            "drivers": [d["text"] for d in a["drivers"]],
            "sensors": {"rain_now_mmhr": round(x["rain_1h"], 1), "rain_forecast_3h_mm": round(x["rain_fcst_3h"], 0),
                        "drain_pct": round(x["drain_pct"], 0), "river_m": round(x["river_m"], 2), "tide_m": round(x["tide_m"], 2)},
            "next_high_tide": {"time": f"{nh[0]:%H:%M}", "height_m": nh[1]} if nh else None,
            "cctv_confirmation": {"status": reading["status"], "depth_cm": reading.get("depth_cm")} if reading else None,
        }

    def snapshot(self):
        self.tick()
        with self.lock:
            rec = self.rows[-1]
            _, _, _, ext = self._tide_highs()
            future = [(k, ts, z) for k, ts, z in ext if ts > self.t]
            nh = next(((ts, z) for k, ts, z in future if k == "high"), None)
            nl = next(((ts, z) for k, ts, z in future if k == "low"), None)
            prev = self.rows[-2] if len(self.rows) > 1 else rec
            hotspots = []
            for hp in HOTSPOTS:
                hid = hp["id"]
                h = rec["hs"][hid]
                x = h["x"]
                reading = self.cctv.get(hid)
                hotspots.append({
                    **public_hotspot(hp),
                    "sensors": {
                        "rain_mmhr": round(x["rain_1h"], 1), "rain_3h": round(x["rain_3h"], 1),
                        "rain_fcst_3h": round(x["rain_fcst_3h"], 1), "rain_fcst_6h": round(x["rain_fcst_6h"], 1),
                        "drain_pct": round(x["drain_pct"], 1), "drain_rate": round(x["drain_rate"], 1),
                        "river_m": round(x["river_m"], 2), "tide_m": round(x["tide_m"], 2),
                        "hours_to_high_tide": round(x["hours_to_high_tide"], 2), "next_high_m": round(x["tide_next_high_m"], 2),
                        "flooding_observed": h["depth"] >= 10, "water_depth_cm": round(h["depth"], 0),
                    },
                    "assessment": self.current.get(hid),
                    "cctv_reading": {k: v for k, v in reading.items() if k != "expires"} if reading else None,
                })
            next_tick = None
            if self.playing:
                next_tick = max(0.0, SPEEDS[self.speed] - (time.monotonic() - self.last_tick))
            return {
                "mode": self.mode, "sim_time": iso(self.t), "playing": self.playing, "speed": self.speed,
                "tick_seconds": SPEEDS[self.speed], "next_tick_in": next_tick,
                "drill": self.drill,
                "replay": ({**self.replay, "start": iso(self.replay["start"]), "end": iso(self.replay["end"]),
                            "event_start": iso(self.replay["event_start"]),
                            "progress": round(float((self.t - self.replay["start"]) / (self.replay["end"] - self.replay["start"])), 3)}
                           if self.replay else None),
                "city": {
                    "rain_mmhr": round(float(np.mean([v["rain"] for v in rec["hs"].values()])), 1),
                    "tide_m": round(rec["tide"], 2), "tide_trend": "rising" if rec["tide"] >= prev["tide"] else "falling",
                    "river_m": round(rec["river"], 2), "river_trend": round(rec["river"] - prev["river"], 2),
                    "max_drain_pct": round(max(v["drain"] for v in rec["hs"].values()), 0),
                    "next_high": {"time": iso(nh[0]), "height_m": round(nh[1] + self.surge.get(nh[0].floor("h"), 0.0), 2),
                                  "surge_m": round(self.surge.get(nh[0].floor("h"), 0.0), 2),
                                  "in_h": round((nh[0] - self.t) / pd.Timedelta(hours=1), 2)} if nh else None,
                    "next_low": {"time": iso(nl[0]), "height_m": nl[1]} if nl else None,
                },
                "hotspots": hotspots,
                "events": list(self.events)[:40],
            }

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
            # Predicted tide for the next 12 h, for context on the charts.
            ahead = [self.t + pd.Timedelta(hours=k) for k in range(1, 13)]
            out["tide_ahead"] = {"time": [iso(t) for t in ahead],
                                 "tide": [round(float(z), 2) for z in tide_at([hours_since_epoch(t) for t in ahead])]}
            return out

    def tide_table(self, days=3):
        with self.lock:
            _, _, _, ext = self._tide_highs()
            end = self.t + pd.Timedelta(days=days)
            return [{"type": k, "time": iso(ts), "height_m": z} for k, ts, z in ext if self.t - pd.Timedelta(hours=12) <= ts <= end]
