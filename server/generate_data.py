"""Generate the synthetic Miri dataset.

Outputs in server/data/:
  sensor_history.csv  hourly readings for the 6 hotspots over 2 years
  tide_table.csv      predicted high/low tides
  flood_events.csv    flood events found in the history
  hotspots.json       hotspot metadata

Usage: python -m server.generate_data
"""
import json

import numpy as np
import pandas as pd

from .config import DATA_DIR, HISTORY_END, HISTORY_START, HOTSPOTS, SEED, public_hotspot
from .physics import (
    EPOCH, background_rain, hours_since_epoch, make_forecasts, river_series,
    simulate_hotspot, storm_profile, tide_at, tide_extremes, flooded,
)

# Planted storms. Background weather adds ordinary showers around these.
#   tidal    storm timed to a spring high tide
#   burst    short cloudburst at low tide
#   monsoon  multi-day rain that swells the Miri River
#   combined heavy rain at high tide after a wet spell
#   major    the 2025 event: four days of monsoon rain, cloudbursts, king tide and surge
PLANTED = [
    ("2024-11-08", "tidal",    dict(rate=37, dur=3)),
    ("2024-12-03", "burst",    dict(rate=88, dur=2)),
    ("2024-12-20", "monsoon",  dict(rate=8.5, dur=62)),
    ("2025-01-14", "tidal",    dict(rate=36, dur=3)),
    ("2025-01-29", "major",    dict()),
    ("2025-03-11", "burst",    dict(rate=92, dur=2)),
    ("2025-05-20", "burst",    dict(rate=85, dur=2)),
    ("2025-08-09", "tidal",    dict(rate=35, dur=3)),
    ("2025-10-27", "burst",    dict(rate=90, dur=2)),
    ("2025-11-18", "tidal",    dict(rate=38, dur=3)),
    ("2025-12-09", "combined", dict(rate=52, dur=3)),
    ("2026-01-06", "monsoon",  dict(rate=9.0, dur=60)),
    ("2026-01-25", "tidal",    dict(rate=36, dur=3)),
    ("2026-02-17", "burst",    dict(rate=95, dur=2)),
    ("2026-04-30", "burst",    dict(rate=86, dur=2)),
    ("2026-09-03", "tidal",    dict(rate=37, dur=3)),
]


def _find_high_tide(highs, target, min_height, window_days=6):
    """Highest-enough high tide near `target`, preferring afternoon and evening."""
    t = pd.Timestamp(target)
    best = None
    for ts, z in highs:
        if abs((ts - t).total_seconds()) > window_days * 86400 or z < min_height:
            continue
        score = abs((ts - t).total_seconds()) / 3600 - (8 if 12 <= ts.hour <= 21 else 0) - 10 * (z - min_height)
        if best is None or score < best[0]:
            best = (score, ts, z)
    if best is None:
        raise ValueError(f"No high tide >= {min_height} m near {target}")
    return best[1], best[2]


def _hour_index(index, ts):
    return int(np.searchsorted(index.values, np.datetime64(pd.Timestamp(ts).floor("h"))))


def plant_events(index, rain, surge, tide_astro, highs, rng):
    planted = []
    for date, kind, p in PLANTED:
        if kind in ("tidal", "combined"):
            ht, z = _find_high_tide(highs, date, 2.15)
            start = _hour_index(index, ht - pd.Timedelta(hours=1.5))
            if kind == "combined":
                pre = slice(start - 40, start - 4)
                rain[pre] += rng.uniform(2.0, 4.5, size=pre.stop - pre.start)
            rain[start:start + p["dur"]] += p["rate"] * storm_profile(p["dur"]) / storm_profile(p["dur"]).mean()
        elif kind == "burst":
            t = pd.Timestamp(date) + pd.Timedelta(hours=15)
            for shift in range(0, 96):
                i = _hour_index(index, t + pd.Timedelta(hours=shift))
                if tide_astro[i] < 1.2 and 13 <= index[i].hour <= 20:
                    break
            start = i
            rain[start:start + p["dur"]] += p["rate"] * np.array([1.0, 0.75][: p["dur"]])
        elif kind == "monsoon":
            start = _hour_index(index, pd.Timestamp(date) + pd.Timedelta(hours=6))
            n = p["dur"]
            rain[start:start + n] += p["rate"] * rng.uniform(0.55, 1.45, size=n)
            burst = start + n - 20
            rain[burst:burst + 2] += 30
        elif kind == "major":
            ht, z = _find_high_tide(highs, date, 2.3, window_days=4)
            peak = _hour_index(index, ht)
            start = peak - 70
            n = 96
            rain[start:start + n] += 7.0 * rng.uniform(0.5, 1.5, size=n)
            for off, rate in ((-30, 55), (-2, 68), (20, 48)):
                rain[peak + off:peak + off + 2] += rate
            surge[peak - 36:peak + 30] += 0.35 * np.exp(-((np.arange(-36, 30)) ** 2) / 400.0)
        else:
            raise ValueError(kind)
        planted.append({"date": date, "kind": kind, "start": str(index[start])})
    return planted


def onset_mechanism(hp, df_h, t):
    """Physical cause of a flood onset at row t of one hotspot's history."""
    w = df_h.iloc[max(0, t - 3):t + 1]
    river_over = w["river_m"].max() >= hp["bank"] - 0.15
    tide_block = hp["tide_sens"] >= 0.5 and w["tide_m"].max() >= hp["outfall"] + 0.4
    intense = w["rain_mm"].max() >= 70 or df_h["rain_mm"].iloc[max(0, t - 2):t + 1].sum() >= 150
    if river_over and (tide_block or intense):
        return "Combined"
    if river_over:
        return "River Overflow"
    if tide_block and intense:
        return "Combined"
    if tide_block:
        return "Tidal Backflow"
    return "Rainfall Overload"


def detect_events(hist: pd.DataFrame) -> pd.DataFrame:
    """Group flooded hours across hotspots into city-wide events (gap <= 12 h)."""
    fl = hist[hist["flooded"] == 1]
    if fl.empty:
        return pd.DataFrame()
    times = np.sort(fl["time"].unique())
    groups, cur = [], [times[0]]
    for t in times[1:]:
        if (t - cur[-1]) / np.timedelta64(1, "h") <= 12:
            cur.append(t)
        else:
            groups.append(cur)
            cur = [t]
    groups.append(cur)

    by_hotspot = {h["id"]: hist[hist["hotspot_id"] == h["id"]].reset_index(drop=True) for h in HOTSPOTS}
    rows = []
    for i, g in enumerate(groups, 1):
        start, end = pd.Timestamp(g[0]), pd.Timestamp(g[-1])
        win = hist[(hist["time"] >= start - pd.Timedelta(hours=12)) & (hist["time"] <= end)]
        ev = fl[(fl["time"] >= start) & (fl["time"] <= end)]
        affected, mechs, weight = [], {}, {}
        for h in HOTSPOTS:
            e = ev[ev["hotspot_id"] == h["id"]]
            if e.empty:
                continue
            affected.append(h["id"])
            dfh = by_hotspot[h["id"]]
            t = int(np.searchsorted(dfh["time"].values, e["time"].values[0]))
            mechs[h["id"]] = onset_mechanism(h, dfh, t)
            weight[mechs[h["id"]]] = weight.get(mechs[h["id"]], 0) + len(e)
        # The event's mechanism is the one behind most flooded hotspot-hours.
        mechanism = max(weight, key=weight.get)
        rows.append({
            "event_id": f"EV-{i:02d}",
            "start": start, "end": end + pd.Timedelta(hours=1),
            "duration_h": int((end - start) / pd.Timedelta(hours=1)) + 1,
            "hotspots": ";".join(affected),
            "n_hotspots": len(affected),
            "flooded_hours": int(len(ev)),
            "peak_depth_cm": round(float(ev["depth_cm"].max()), 1),
            "peak_rain_mmhr": round(float(win["rain_mm"].max()), 1),
            "event_rain_mm": round(float(win.groupby("time")["rain_mm"].mean().sum()), 0),
            "max_tide_m": round(float(win["tide_m"].max()), 2),
            "max_river_m": round(float(win["river_m"].max()), 2),
            "mechanism": mechanism,
            "mechanism_by_hotspot": ";".join(f"{k}:{v}" for k, v in mechs.items()),
        })
    out = pd.DataFrame(rows)
    # Severity score for picking out the major event.
    out["severity"] = (out["flooded_hours"] * out["peak_depth_cm"]).round(0)
    return out


def generate(seed: int = SEED, verbose: bool = True):
    rng = np.random.default_rng(seed)
    index = pd.date_range(HISTORY_START, HISTORY_END, freq="h")
    n = len(index)
    hours = (index - EPOCH) / pd.Timedelta(hours=1)
    tide_astro = tide_at(hours.values)

    ext = tide_extremes(index[0] - pd.Timedelta(days=1), index[-1] + pd.Timedelta(days=60))
    highs = [(ts, z) for kind, ts, z in ext if kind == "high"]

    rain_city = background_rain(index, rng)
    surge = np.zeros(n)
    planted = plant_events(index, rain_city, surge, tide_astro, highs, rng)
    tide_obs = tide_astro + surge + rng.normal(0, 0.015, n)
    river, _ = river_series(rain_city, tide_obs)
    river_obs = river + rng.normal(0, 0.015, n)

    frames = []
    for hp in HOTSPOTS:
        local = rain_city * hp["rain_mult"] * np.exp(rng.normal(0, 0.12, n))
        local = np.round(local, 1)
        drain, depth, _ = simulate_hotspot(hp, local, tide_obs, river)
        drain_obs = np.clip(drain + rng.normal(0, 1.0, n), 0, 100)
        f3, f6 = make_forecasts(local, rng)
        frames.append(pd.DataFrame({
            "time": index,
            "hotspot_id": hp["id"],
            "rain_mm": local,
            "rain_fcst_3h": np.round(f3, 1),
            "rain_fcst_6h": np.round(f6, 1),
            "tide_m": np.round(tide_obs, 3),
            "tide_astro_m": np.round(tide_astro, 3),
            "river_m": np.round(river_obs, 3),
            "drain_pct": np.round(drain_obs, 1),
            "depth_cm": np.round(depth, 1),
            "flooded": flooded(depth).astype(int),
        }))
    hist = pd.concat(frames, ignore_index=True)
    events = detect_events(hist)

    tide_rows = [{"time": ts, "type": kind, "height_m": z} for kind, ts, z in ext]
    tide_table = pd.DataFrame(tide_rows)

    hist.to_csv(DATA_DIR / "sensor_history.csv", index=False)
    tide_table.to_csv(DATA_DIR / "tide_table.csv", index=False)
    events.to_csv(DATA_DIR / "flood_events.csv", index=False)
    (DATA_DIR / "hotspots.json").write_text(json.dumps([public_hotspot(h) for h in HOTSPOTS], indent=2))

    if verbose:
        yearly = pd.Series(rain_city, index=index).resample("YE").sum().round(0)
        print(f"History: {n} hours x {len(HOTSPOTS)} hotspots = {len(hist)} rows")
        print("City rainfall by year (mm):", dict(zip(yearly.index.year, yearly.values)))
        print(f"Flooded hotspot-hours: {int(hist['flooded'].sum())} ({hist['flooded'].mean():.3%})")
        print(f"Planted storms: {len(planted)}; detected flood events: {len(events)}")
        if len(events):
            print(events[["event_id", "start", "duration_h", "hotspots", "flooded_hours",
                          "peak_depth_cm", "peak_rain_mmhr", "max_tide_m", "max_river_m", "mechanism"]]
                  .to_string(index=False))
    return hist, events, tide_table


if __name__ == "__main__":
    generate()
