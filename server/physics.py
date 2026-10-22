"""Synthetic hydrology for Miri: tides, Miri River, Smart Drains and surface flooding.

This is a simple lumped model, not a calibrated hydraulic model. It exists to
produce internally consistent sensor data in which the four flood mechanisms
in MCC's brief (rainfall overload, tidal backflow, river overflow, low-lying
terrain) behave the way they do on the ground, so the ML models have
something real to learn from.

Time convention: index t is the end of hour t. Rain at t is the rain that fell
during that hour; drain and depth at t are the state at the end of that hour.
"""
import numpy as np
import pandas as pd

from .config import FLOOD_DEPTH_CM

EPOCH = pd.Timestamp("2024-01-01 00:00")   # local time, Malaysia (UTC+8)
TIDE_MEAN = 1.35
# Harmonic constituents tuned to give a mixed, mainly semi-diurnal tide with
# a ~0-2.6 m range: (period h, amplitude m, phase rad) for M2, S2, K1, O1.
CONSTITUENTS = [(12.4206, 0.60, 0.3), (12.0, 0.24, 1.1), (23.9345, 0.42, 2.0), (25.8193, 0.32, 0.7)]
M2_PERIOD = 12.4206

RIVER_BASE = 0.85
RIVER_TIDE_GAIN = 0.30
RIVER_STORE_GAIN = 0.012
RIVER_TAU_H = 24.0
MAX_DEPTH_CM = 160.0


def hours_since_epoch(ts) -> float:
    return (pd.Timestamp(ts) - EPOCH).total_seconds() / 3600.0


def tide_at(hours):
    """Astronomical tide height (m above chart datum) at hours since EPOCH."""
    h = np.asarray(hours, dtype=float)
    z = np.full_like(h, TIDE_MEAN)
    for period, amp, phase in CONSTITUENTS:
        z = z + amp * np.cos(2 * np.pi * h / period - phase)
    return z


def tide_extremes(start, end, step_min: int = 6):
    """High and low tides between start and end as (kind, timestamp, height)."""
    t0, t1 = hours_since_epoch(start), hours_since_epoch(end)
    hs = np.arange(t0 - 1.0, t1 + 1.0, step_min / 60.0)
    z = tide_at(hs)
    d = np.diff(z)
    out = []
    for i in range(1, len(d)):
        if d[i - 1] > 0 >= d[i]:
            kind = "high"
        elif d[i - 1] < 0 <= d[i]:
            kind = "low"
        else:
            continue
        if t0 <= hs[i] <= t1:
            out.append((kind, (EPOCH + pd.Timedelta(hours=float(hs[i]))).round("min"), round(float(z[i]), 2)))
    return out


def next_high_features(hours, highs_h, highs_z):
    """For each hour: hours to the next high tide and its height."""
    hours = np.asarray(hours, dtype=float)
    idx = np.searchsorted(highs_h, hours, side="right")
    idx = np.clip(idx, 0, len(highs_h) - 1)
    return highs_h[idx] - hours, highs_z[idx]


def scenario_tide(hours_rel, peak_m: float, hours_to_high: float, tidal_range: float = 1.7):
    """Idealised semi-diurnal tide curve for what-if scenarios."""
    low = max(0.1, peak_m - tidal_range)
    phase = 2 * np.pi * (np.asarray(hours_rel, dtype=float) - hours_to_high) / M2_PERIOD
    return low + (peak_m - low) * (1 + np.cos(phase)) / 2


# ─── River ────────────────────────────────────────────────────────────────
def river_series(rain_city, tide_obs, store0: float = 0.0):
    """Miri River level (m): catchment storage plus tidal influence near the mouth."""
    k = np.exp(-1.0 / RIVER_TAU_H)
    store = store0
    out = np.empty(len(rain_city))
    stores = np.empty(len(rain_city))
    for t, r in enumerate(rain_city):
        store = store * k + r
        stores[t] = store
        out[t] = RIVER_BASE + RIVER_TIDE_GAIN * (tide_obs[t] - TIDE_MEAN) + RIVER_STORE_GAIN * store
    return out, stores


# ─── Drains and surface water ─────────────────────────────────────────────
def _clip01(x):
    return min(1.0, max(0.0, x))


def drain_base_pct(hp, tide, river):
    """Standing water in the drain from tide and river backwater, % of depth."""
    return (6.0 + 32.0 * hp["tide_sens"] * _clip01((tide - 0.4) / 2.1)
            + 25.0 * hp["river_sens"] * _clip01((river - 1.5) / 1.8))


def outfall_factors(hp, tide, river):
    """Share of the outfall's capacity left by the tide and by river backwater (1 = free-flowing)."""
    f_tide = 1 - hp["tide_sens"] * _clip01((tide - hp["outfall"]) / 0.8)
    f_river = 1 - hp["river_sens"] * _clip01((river - (hp["bank"] - 1.3)) / 1.3)
    return f_tide, f_river


def hydraulics(hp, tide, river, pump=0.0):
    """Drain and outfall state for given tide and river levels (used by the digital twin)."""
    base = drain_base_pct(hp, tide, river)
    f_tide, f_river = outfall_factors(hp, tide, river)
    gravity = hp["capacity"] * max(0.06, f_tide * f_river)
    return {
        "backwater_pct": round(base, 1),
        "tide_block_pct": round(100 * (1 - f_tide), 0),
        "river_block_pct": round(100 * (1 - f_river), 0),
        "gravity_mmhr": round(gravity, 1),
        "pump_mmhr": round(pump, 1),
        "capacity_mmhr": round(gravity + pump, 1),
        "design_mmhr": hp["capacity"],
        "storage_mm": round(hp["storage"] * (1 - base / 100.0), 1),
    }


def step(hp, S, D, rain, rain_prev, tide, river, pump=0.0):
    """Advance one hotspot by one hour. Returns (S, D, drain_pct).

    `pump` is extra discharge from mobile pumps (mm/h); it works whatever the tide.
    """
    base = drain_base_pct(hp, tide, river)
    avail = hp["storage"] * (1 - base / 100.0)
    f_tide, f_river = outfall_factors(hp, tide, river)
    q = hp["capacity"] * max(0.06, f_tide * f_river) + pump

    S = S + hp["runoff"] * rain + hp["lag"] * rain_prev
    out = min(S, q)
    S -= out
    overflow = max(0.0, S - avail)
    S = min(S, avail)
    spare = q - out

    # Ponding saturates as water spreads over a wider area.
    room = max(0.0, 1 - D / MAX_DEPTH_CM)
    D = D + overflow * hp["pond"] * room
    if river > hp["bank"]:
        D += hp["river_sens"] * (river - hp["bank"]) * 20.0 * room
        recede = 0.5
    else:
        recede = 1.0 + 0.25 * spare + 0.06 * D
    D = max(0.0, D - recede)

    pct = base + (100 - base) * (S / avail if avail > 0 else 1.0)
    if overflow > 0 or D > 2.0:
        pct = 100.0
    return S, D, min(100.0, pct)


def simulate_hotspot(hp, rain, tide_obs, river, S0=0.0, D0=0.0):
    n = len(rain)
    drain = np.empty(n)
    depth = np.empty(n)
    S, D, prev = S0, D0, 0.0
    for t in range(n):
        S, D, drain[t] = step(hp, S, D, rain[t], prev, tide_obs[t], river[t])
        depth[t] = D
        prev = rain[t]
    return drain, depth, (S, D)


# ─── Weather ──────────────────────────────────────────────────────────────
MONTH_WETNESS = {1: 1.6, 2: 1.25, 3: 1.0, 4: 0.9, 5: 1.0, 6: 0.8, 7: 0.7, 8: 0.75,
                 9: 0.9, 10: 1.2, 11: 1.5, 12: 1.8}


def storm_profile(duration: int):
    """Rain shape over a storm: builds quickly, peaks early, tails off."""
    if duration <= 1:
        return np.array([1.0])
    x = np.linspace(0, 1, duration)
    p = np.where(x < 0.35, 0.55 + 0.45 * x / 0.35, 1.0 - 0.55 * (x - 0.35) / 0.65)
    return p / p.max()


def background_rain(index: pd.DatetimeIndex, rng: np.random.Generator, max_peak: float = 34.0):
    """Ordinary convective showers and monsoon rain. Rarely floods on its own."""
    n = len(index)
    rain = np.zeros(n)
    month = index.month.values
    hour = index.hour.values
    diurnal = 0.45 + 1.1 * np.exp(-(((hour - 16) % 24) ** 2) / 14.0)
    t = 0
    while t < n:
        if rng.random() < 0.011 * MONTH_WETNESS[month[t]] * diurnal[t]:
            dur = int(rng.integers(1, 6))
            peak = min(max_peak, float(rng.lognormal(np.log(7.0), 0.75)))
            seg = rain[t:t + dur]
            seg += peak * storm_profile(dur)[: len(seg)]
            t += dur + int(rng.integers(2, 10))
        else:
            t += 1
    # North-east monsoon spells (Nov-Feb): long steady rain.
    t = 0
    while t < n:
        if month[t] in (11, 12, 1, 2) and rng.random() < 0.0045:
            dur = int(rng.integers(10, 36))
            level = float(rng.uniform(0.8, 3.0))
            seg = rain[t:t + dur]
            seg += level * rng.uniform(0.5, 1.5, size=len(seg))
            t += dur + 48
        else:
            t += 1
    return rain


def make_forecasts(rain, rng: np.random.Generator | None):
    """Rain forecasts for the next 3 h and 6 h, with realistic error when rng is given."""
    n = len(rain)
    padded = np.concatenate([rain, np.zeros(6)])
    c = np.concatenate([[0.0], np.cumsum(padded)])
    idx = np.arange(n)
    true3 = c[idx + 4] - c[idx + 1]
    true6 = c[idx + 7] - c[idx + 1]
    if rng is None:
        return true3, true6
    err = np.exp(rng.normal(0, 0.28, n))
    miss = rng.random(n) < 0.06
    err[miss] *= 0.35
    f3 = true3 * err
    f6 = f3 + (true6 - true3) * np.exp(rng.normal(0, 0.35, n))
    phantom = (rng.random(n) < 0.02) & (true3 < 5)
    bump = rng.uniform(8, 35, n)
    f3 = np.where(phantom, f3 + bump, f3)
    f6 = np.where(phantom, f6 + bump * 1.3, f6)
    return f3, f6


# ─── Episodes: design storms and what-if scenarios ────────────────────────
def episode_city(rain_mmhr, duration_h, tide_peak, hours_to_high, antecedent_mm=0.0,
                 pre_h=48, post_h=18, surge=0.0, tidal_range=1.7, shaped=False):
    """City-level inputs for a storm that starts the hour after 'now'.

    Relative hour 0 is now; the storm falls in hours 1..duration at
    `rain_mmhr` on average (constant unless `shaped`). Returns relative hours,
    city rain, observed tide, and the high-tide times and heights.
    """
    rel = np.arange(-pre_h, post_h + 1)
    rain = np.zeros(len(rel))
    if antecedent_mm > 0:
        mask = (rel >= -30) & (rel <= -4)
        rain[mask] += antecedent_mm / mask.sum()
    dur = int(round(duration_h))
    if dur > 0 and rain_mmhr > 0:
        mask = (rel >= 1) & (rel <= dur)
        shape = storm_profile(dur) if shaped else np.ones(dur)
        rain[mask] += rain_mmhr * shape / shape.mean()
    tide = scenario_tide(rel, tide_peak, hours_to_high, tidal_range)
    if surge:
        tide = tide + surge * np.exp(-((rel - hours_to_high) ** 2) / 18.0)
    highs = hours_to_high + M2_PERIOD * np.arange(-6, 4)
    return rel, rain, tide, highs, np.full(len(highs), tide_peak)


def flooded(depth):
    return depth >= FLOOD_DEPTH_CM
