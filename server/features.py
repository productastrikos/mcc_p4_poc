"""Model features and labels from hourly sensor series."""
import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from .config import FEATURES, HORIZONS
from .physics import next_high_features


def rolling_sum(x, window):
    c = np.concatenate([[0.0], np.cumsum(x)])
    idx = np.arange(1, len(x) + 1)
    return c[idx] - c[np.maximum(0, idx - window)]


def feature_matrix(hp, hours, rain, fcst3, fcst6, tide, highs_h, highs_z, river, drain):
    """Feature array (n, len(FEATURES)) for one hotspot. `hours` and `highs_h` share a time base."""
    rain = np.asarray(rain, dtype=float)
    drain = np.asarray(drain, dtype=float)
    n = len(rain)
    h2h, next_high = next_high_features(hours, highs_h, highs_z)
    cols = {
        "rain_1h": rain,
        "rain_3h": rolling_sum(rain, 3),
        "rain_6h": rolling_sum(rain, 6),
        "rain_fcst_3h": fcst3,
        "rain_fcst_6h": fcst6,
        "tide_m": tide,
        "tide_next_high_m": next_high,
        "hours_to_high_tide": h2h,
        "river_m": river,
        "drain_pct": drain,
        "drain_rate": np.diff(drain, prepend=drain[0]),
        "elevation_m": np.full(n, hp["elevation_m"]),
        "past_floods": np.full(n, hp["past_floods"]),
    }
    return np.column_stack([np.asarray(cols[f], dtype=float) for f in FEATURES])


def build_features(*args):
    return pd.DataFrame(feature_matrix(*args), columns=FEATURES)


def label_matrix(flooded):
    """y[t, j] = 1 if the site floods at any time in (t, t+h_j]. Rows without a full window are NaN."""
    f = np.asarray(flooded, dtype=float)
    n = len(f)
    out = np.full((n, len(HORIZONS)), np.nan)
    for j, h in enumerate(HORIZONS):
        if n > h:
            out[: n - h, j] = sliding_window_view(f[1:], h).max(axis=1)
    return out


def flood_labels(flooded):
    return pd.DataFrame(label_matrix(flooded), columns=[f"y_{h}h" for h in HORIZONS])
