"""Storm episodes: design storms for training and what-if scenarios for the simulator.

One code path serves both, so the simulator's inputs look like the data the
model was trained on.
"""
import numpy as np
import pandas as pd

from .config import FEATURES, HORIZONS, HOTSPOTS
from .features import feature_matrix, label_matrix
from .physics import episode_city, flooded, make_forecasts, river_series, simulate_hotspot


def run_episode(rain_mmhr, duration_h, tide_peak, hours_to_high, antecedent_mm=0.0,
                surge=0.0, tidal_range=1.7, shaped=False, rng=None, hotspots=HOTSPOTS, post_h=30):
    """Simulate every hotspot through one storm. Relative hour 0 is 'now'.

    Returns {hotspot_id: {rel, X (ndarray), Y (ndarray), rain, drain, depth, tide, river}}.
    """
    post_h = max(post_h, int(round(duration_h)) + 12)
    rel, rain_city, tide, highs_h, highs_z = episode_city(
        rain_mmhr, duration_h, tide_peak, hours_to_high, antecedent_mm,
        surge=surge, tidal_range=tidal_range, shaped=shaped, post_h=post_h)
    n = len(rel)
    tide_obs = tide + (rng.normal(0, 0.015, n) if rng is not None else 0)
    river, _ = river_series(rain_city, tide_obs)
    river_obs = river + (rng.normal(0, 0.015, n) if rng is not None else 0)
    out = {}
    for hp in hotspots:
        local = rain_city * hp["rain_mult"]
        if rng is not None:
            local = local * np.exp(rng.normal(0, 0.12, n))
        drain, depth, _ = simulate_hotspot(hp, local, tide_obs, river)
        drain_obs = np.clip(drain + rng.normal(0, 1.0, n), 0, 100) if rng is not None else drain
        f3, f6 = make_forecasts(local, rng)
        out[hp["id"]] = {
            "rel": rel,
            "X": feature_matrix(hp, rel.astype(float), local, f3, f6, tide_obs, highs_h, highs_z, river_obs, drain_obs,
                                np.round(depth, 1)),
            "Y": label_matrix(flooded(depth)),
            "rain": local, "drain": drain_obs, "depth": depth, "tide": tide_obs, "river": river_obs,
        }
    return out


def design_storm_set(n_episodes: int, rng: np.random.Generator) -> pd.DataFrame:
    """Training rows from randomised design storms, covering the simulator's input range."""
    Xs, Ys = [], []
    for _ in range(n_episodes):
        u = rng.random()
        rate = rng.uniform(3, 30) if u < 0.35 else rng.uniform(30, 80) if u < 0.8 else rng.uniform(80, 130)
        dur = int(rng.integers(1, 11))
        ep = run_episode(
            rain_mmhr=rate, duration_h=dur,
            tide_peak=rng.uniform(1.2, 2.9), hours_to_high=rng.uniform(-6, 10),
            antecedent_mm=rng.uniform(0, 150) if rng.random() < 0.5 else 0.0,
            surge=rng.uniform(0, 0.3) if rng.random() < 0.15 else 0.0,
            tidal_range=rng.uniform(1.2, 2.1), shaped=rng.random() < 0.6, rng=rng,
        )
        for e in ep.values():
            mask = (e["rel"] >= -8) & (e["rel"] <= dur + 8)
            Xs.append(e["X"][mask])
            Ys.append(e["Y"][mask])
    return pd.concat([pd.DataFrame(np.vstack(Xs), columns=FEATURES),
                      pd.DataFrame(np.vstack(Ys), columns=[f"y_{h}h" for h in HORIZONS])], axis=1)
