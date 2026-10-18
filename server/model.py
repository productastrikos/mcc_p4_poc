"""Flood-risk forecasting models, explanations and the mechanism classifier.

Three gradient-boosting classifiers (scikit-learn HistGradientBoosting), one
per horizon, predict the probability that a hotspot floods within the next
1, 3 and 6 hours. Monotonic constraints on the inputs the what-if simulator
drives (forecast rain, tide, drain level) keep it sensible: more rain or a
higher tide never lowers risk. Constraining every feature cost ~4 points of
PR-AUC on the hold-out year, so past rain and river level stay unconstrained.
"""
import json
import math
import time
from datetime import datetime

import joblib
import numpy as np
import pandas as pd

from .config import (
    ARTIFACT_DIR, DATA_DIR, FEATURE_GROUP, FEATURE_LABELS, FEATURES, HORIZONS,
    HOTSPOT_BY_ID, HOTSPOTS, LEVEL_RANK, SEED, TEST_START, level_for,
)
from .features import build_features, flood_labels
from .physics import EPOCH, RIVER_TIDE_GAIN, drain_base_pct

MODEL_PATH = ARTIFACT_DIR / "flood_models.joblib"
METRICS_PATH = ARTIFACT_DIR / "metrics.json"

# +1 = risk can only rise with this feature, 0 = unconstrained.
MONOTONIC = {
    "rain_1h": 0, "rain_3h": 0, "rain_6h": 0, "rain_fcst_3h": 1, "rain_fcst_6h": 1,
    "tide_m": 1, "tide_next_high_m": 1, "hours_to_high_tide": 0,
    "river_m": 0, "drain_pct": 1, "drain_rate": 0, "elevation_m": 0, "past_floods": 0,
}

# Values that stand for "this factor is not contributing" when explaining a
# prediction: no rain, a falling neap tide, normal river and an empty drain.
# The tide baseline must sit below every outfall level, or a typical high tide
# would already count as neutral at Pujut Adong.
NEUTRAL = {
    "rain_1h": 0.0, "rain_3h": 0.0, "rain_6h": 0.0, "rain_fcst_3h": 0.0, "rain_fcst_6h": 0.0,
    "tide_m": 0.9, "tide_next_high_m": 1.4, "hours_to_high_tide": 6.2,
    "river_m": 0.9, "drain_pct": 15.0, "drain_rate": 0.0,
}
GROUPS = ["Rain", "Tide", "River", "Drain"]
DRIVER_GROUPS = {
    "rain_now": ["rain_1h", "rain_3h", "rain_6h"],
    "rain_fcst": ["rain_fcst_3h", "rain_fcst_6h"],
    "tide": ["tide_m", "tide_next_high_m", "hours_to_high_tide"],
    "river": ["river_m"],
    "drain": ["drain_pct", "drain_rate"],
}
MECH_GROUP = {"rain_now": "Rain", "rain_fcst": "Rain", "tide": "Tide", "river": "River", "drain": "Drain"}

HIGH_TIDE_M = 2.0           # tide treated as "high" for backflow
RIVER_ALERT_M = 2.8         # Miri River alert level used by the classifier
DRAIN_BACKFLOW_PCT = 80.0   # brief: tidal backflow = high tide + drain > 80 %


# ═══ Training ═════════════════════════════════════════════════════════════
def load_history():
    hist = pd.read_csv(DATA_DIR / "sensor_history.csv", parse_dates=["time"])
    tides = pd.read_csv(DATA_DIR / "tide_table.csv", parse_dates=["time"])
    highs = tides[tides["type"] == "high"]
    highs_h = ((highs["time"] - EPOCH) / pd.Timedelta(hours=1)).values
    return hist, highs_h, highs["height_m"].values


def history_features(hist, highs_h, highs_z):
    frames = []
    for hp in HOTSPOTS:
        d = hist[hist["hotspot_id"] == hp["id"]].sort_values("time").reset_index(drop=True)
        hours = ((d["time"] - EPOCH) / pd.Timedelta(hours=1)).values
        X = build_features(hp, hours, d["rain_mm"].values, d["rain_fcst_3h"].values, d["rain_fcst_6h"].values,
                           d["tide_m"].values, highs_h, highs_z, d["river_m"].values, d["drain_pct"].values)
        Y = flood_labels(d["flooded"].values)
        meta = d[["time", "hotspot_id", "flooded", "drain_pct"]].rename(columns={"drain_pct": "drain_raw"})
        frames.append(pd.concat([meta, X, Y], axis=1))
    return pd.concat(frames, ignore_index=True)


def _new_model():
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(
        max_iter=350, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=30,
        l2_regularization=1.0, monotonic_cst=[MONOTONIC[f] for f in FEATURES],
        early_stopping=False, random_state=0,
    )


def _binary_metrics(y, p, threshold=0.5):
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    pred = p >= threshold
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    return {
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 5),
        "accuracy": round((tp + tn) / len(y), 4),
        "precision": round(prec, 3), "recall": round(rec, 3),
        "f1": round(2 * prec * rec / (prec + rec), 3) if prec + rec else 0.0,
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "positives": int(y.sum()), "rows": int(len(y)),
    }


def _lead_times(test, prob_col, alarm_mask_fn, lookback=12):
    """Hours of warning before each flood onset in the test set."""
    leads, detected, onsets = [], 0, 0
    for _, d in test.groupby("hotspot_id"):
        d = d.sort_values("time").reset_index(drop=True)
        fl = d["flooded"].values
        alarm = alarm_mask_fn(d)
        for t in np.where((fl[1:] == 1) & (fl[:-1] == 0))[0] + 1:
            onsets += 1
            lead = 0
            for k in range(1, lookback + 1):
                if t - k < 0 or not alarm[t - k]:
                    break
                lead = k
            if lead > 0:
                detected += 1
                leads.append(lead)
    return {
        "onsets": onsets, "warned": detected,
        "mean_lead_h": round(float(np.mean(leads)), 2) if leads else 0.0,
        "median_lead_h": float(np.median(leads)) if leads else 0.0,
    }


def _false_alarms(test, alarm_mask_fn):
    """Alarm episodes with no flooding during or within 6 h after them."""
    episodes, false = 0, 0
    for _, d in test.groupby("hotspot_id"):
        d = d.sort_values("time").reset_index(drop=True)
        alarm, fl = alarm_mask_fn(d), d["flooded"].values
        t = 0
        while t < len(d):
            if alarm[t]:
                s = t
                while t < len(d) and alarm[t]:
                    t += 1
                episodes += 1
                if fl[s:min(len(d), t + 6)].max() == 0:
                    false += 1
            t += 1
    months = (test["time"].max() - test["time"].min()) / pd.Timedelta(days=30.4)
    return {"alarm_episodes": episodes, "false_alarms": false,
            "false_alarms_per_month": round(false / max(months, 1e-9), 2)}


def train(n_design_storms: int = 1500, verbose: bool = True):
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.inspection import permutation_importance
    from .scenario import design_storm_set

    t0 = time.time()
    rng = np.random.default_rng(SEED + 1)
    hist, highs_h, highs_z = load_history()
    data = history_features(hist, highs_h, highs_z)
    is_test = data["time"] >= pd.Timestamp(TEST_START)
    train_hist, test = data[~is_test], data[is_test].copy()
    if verbose:
        print(f"History rows: train {len(train_hist)}, test {len(test)} ({time.time() - t0:.1f}s)")
    aug = design_storm_set(n_design_storms, rng)
    if verbose:
        print(f"Design-storm rows: {len(aug)} ({time.time() - t0:.1f}s)")

    models, metrics, rf_metrics, importance = {}, {}, {}, {}
    test_probs = np.zeros((len(test), len(HORIZONS)))
    for j, h in enumerate(HORIZONS):
        y = f"y_{h}h"
        tr = pd.concat([train_hist[FEATURES + [y]], aug[FEATURES + [y]]]).dropna(subset=[y])
        clf = _new_model().fit(tr[FEATURES], tr[y].astype(int))
        models[h] = clf
        test_probs[:, j] = clf.predict_proba(test[FEATURES])[:, 1]
        rf = RandomForestClassifier(n_estimators=150, max_depth=14, min_samples_leaf=5,
                                    n_jobs=-1, random_state=0).fit(tr[FEATURES], tr[y].astype(int))
        ok = test[y].notna().values
        rf_metrics[h] = _binary_metrics(test.loc[ok, y].astype(int).values, rf.predict_proba(test.loc[ok, FEATURES])[:, 1])
        if verbose:
            print(f"  +{h}h trained on {len(tr)} rows ({time.time() - t0:.1f}s)")

    test_probs = np.maximum.accumulate(test_probs, axis=1)   # P(flood within 1h) <= within 3h <= within 6h
    for j, h in enumerate(HORIZONS):
        test[f"p_{h}h"] = test_probs[:, j]
        ok = test[f"y_{h}h"].notna().values
        metrics[h] = _binary_metrics(test.loc[ok, f"y_{h}h"].astype(int).values, test.loc[ok, f"p_{h}h"].values)
        # Reactive baseline: alert when the drain is already >= 90 % full.
        base = (test.loc[ok, "drain_raw"].values >= 90).astype(float)
        metrics[h]["baseline_drain90"] = _binary_metrics(test.loc[ok, f"y_{h}h"].astype(int).values, base)
        metrics[h]["random_forest"] = rf_metrics[h]

        # Permutation importance on all test positives plus a sample of negatives.
        pos = test[ok & (test[f"y_{h}h"] == 1).values]
        neg_pool = test[ok & (test[f"y_{h}h"] == 0).values]
        sub = pd.concat([pos, neg_pool.sample(min(12000, len(neg_pool)), random_state=0)])
        pi = permutation_importance(models[h], sub[FEATURES], sub[f"y_{h}h"].astype(int),
                                    scoring="average_precision", n_repeats=4, random_state=0, n_jobs=-1)
        imp = np.clip(pi.importances_mean, 0, None)
        imp = imp / imp.sum() if imp.sum() > 0 else imp
        importance[h] = {f: round(float(v), 4) for f, v in zip(FEATURES, imp)}

    # Operational rule: a hotspot is at Warning when any horizon reaches 0.5.
    # Probabilities are cumulative, so that is the +6h value.
    lead_ai = _lead_times(test, "p_6h", lambda d: d["p_6h"].values >= 0.5)
    lead_watch = _lead_times(test, "p_6h", lambda d: d["p_6h"].values >= 0.25)
    lead_base = _lead_times(test, "drain_raw", lambda d: d["drain_raw"].values >= 90)
    fa_ai = _false_alarms(test, lambda d: d["p_6h"].values >= 0.5)
    fa_base = _false_alarms(test, lambda d: d["drain_raw"].values >= 90)

    # Calibration of the +3h model on the test set.
    bins = np.linspace(0, 1, 11)
    ok = test["y_3h"].notna()
    cut = pd.cut(test.loc[ok, "p_3h"], bins, include_lowest=True)
    calib = (test.loc[ok].groupby(cut, observed=True)
             .agg(pred=("p_3h", "mean"), obs=("y_3h", "mean"), n=("y_3h", "size")).reset_index(drop=True))

    per_hotspot = {}
    for hid, d in test.groupby("hotspot_id"):
        okh = d["y_3h"].notna()
        yy = d.loc[okh, "y_3h"].astype(int).values
        per_hotspot[hid] = {
            "positives": int(yy.sum()),
            "recall_3h": round(float(((d.loc[okh, "p_3h"] >= 0.5) & (yy == 1)).sum() / max(yy.sum(), 1)), 3),
            "pr_auc_3h": _binary_metrics(yy, d.loc[okh, "p_3h"].values)["pr_auc"] if yy.sum() else None,
        }

    events = pd.read_csv(DATA_DIR / "flood_events.csv", parse_dates=["start", "end"])
    out = {
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "algorithm": "HistGradientBoostingClassifier (scikit-learn), one model per horizon, monotonic constraints",
        "features": FEATURES, "feature_labels": FEATURE_LABELS, "feature_groups": FEATURE_GROUP,
        "train_period": [str(train_hist["time"].min()), str(train_hist["time"].max())],
        "test_period": [str(test["time"].min()), str(test["time"].max())],
        "rows": {"history_train": int(len(train_hist)), "design_storms": int(len(aug)),
                 "design_storm_episodes": n_design_storms, "test": int(len(test))},
        "events": {"total": int(len(events)),
                   "train": int((events["start"] < pd.Timestamp(TEST_START)).sum()),
                   "test": int((events["start"] >= pd.Timestamp(TEST_START)).sum())},
        "horizons": {str(h): metrics[h] for h in HORIZONS},
        "importance": {str(h): importance[h] for h in HORIZONS},
        "lead_time": {"ai_warning": lead_ai, "ai_watch": lead_watch, "baseline_drain90": lead_base},
        "false_alarms": {"ai_warning": fa_ai, "baseline_drain90": fa_base},
        "calibration_3h": calib.round(4).to_dict(orient="records"),
        "per_hotspot": per_hotspot,
        "train_seconds": round(time.time() - t0, 1),
    }
    joblib.dump({"models": models, "features": FEATURES}, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(out, indent=2, default=str))
    if verbose:
        for h in HORIZONS:
            m = metrics[h]
            print(f"  +{h}h  ROC-AUC {m['roc_auc']}  PR-AUC {m['pr_auc']}  P {m['precision']}  R {m['recall']}  "
                  f"F1 {m['f1']}  | RF PR-AUC {m['random_forest']['pr_auc']}  | drain>=90 F1 {m['baseline_drain90']['f1']}")
        print(f"  Lead time (Warning): {lead_ai}  Watch: {lead_watch}  vs drain>=90: {lead_base}")
        print(f"  False alarms: AI {fa_ai}  baseline {fa_base}")
        print(f"Done in {time.time() - t0:.1f}s")
    return out


# ═══ Inference ════════════════════════════════════════════════════════════
def _fmt_minutes(hours: float) -> str:
    mins = int(round(hours * 60))
    if mins < 60:
        return f"{mins} min"
    h, m = divmod(mins, 60)
    return f"{h} h" if m < 8 else f"{h} h {m:02d} min"


class FloodModel:
    def __init__(self):
        bundle = joblib.load(MODEL_PATH)
        self.models = bundle["models"]
        self.metrics = json.loads(METRICS_PATH.read_text())

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        P = np.column_stack([self.models[h].predict_proba(X[FEATURES])[:, 1] for h in HORIZONS])
        return np.maximum.accumulate(P, axis=1)

    # ─── Explanations ────────────────────────────────────────────────────
    def _shapley(self, x: dict, hp: dict):
        """Exact Shapley values over the driver groups, one column per horizon.

        A group that is 'absent' takes its NEUTRAL values. With five groups this is
        32 model evaluations, and it shares interaction effects (rain arriving at
        high tide) fairly between the groups involved. The tide and river groups
        also own the backwater they push into the drain (and the tide its effect
        on the river mouth), so a drain that reads high only because the tide is
        in is credited to the tide.
        Returns players, phi (players x horizons) and V (all 32 coalition forecasts).
        """
        players = list(DRIVER_GROUPS)
        n = len(players)
        i_tide, i_river, i_drain = players.index("tide"), players.index("river"), players.index("drain")
        tide_bw = drain_base_pct(hp, x["tide_m"], NEUTRAL["river_m"]) - drain_base_pct(hp, NEUTRAL["tide_m"], NEUTRAL["river_m"])
        river_bw = drain_base_pct(hp, NEUTRAL["tide_m"], x["river_m"]) - drain_base_pct(hp, NEUTRAL["tide_m"], NEUTRAL["river_m"])
        rows = []
        for mask in range(2 ** n):
            r = dict(x)
            for i, pl in enumerate(players):
                if not (mask >> i) & 1:
                    for f in DRIVER_GROUPS[pl]:
                        r[f] = NEUTRAL[f]
            if (mask >> i_river) & 1 and not (mask >> i_tide) & 1:
                r["river_m"] = max(NEUTRAL["river_m"], r["river_m"] - RIVER_TIDE_GAIN * (x["tide_m"] - NEUTRAL["tide_m"]))
            if (mask >> i_drain) & 1:
                if not (mask >> i_tide) & 1:
                    r["drain_pct"] = max(NEUTRAL["drain_pct"], r["drain_pct"] - tide_bw)
                if not (mask >> i_river) & 1:
                    r["drain_pct"] = max(NEUTRAL["drain_pct"], r["drain_pct"] - river_bw)
            rows.append(r)
        V = self.predict(pd.DataFrame(rows))
        w = [math.factorial(k) * math.factorial(n - k - 1) / math.factorial(n) for k in range(n)]
        phi = np.zeros((n, V.shape[1]))
        for i in range(n):
            for mask in range(2 ** n):
                if not (mask >> i) & 1:
                    phi[i] += w[bin(mask).count("1")] * (V[mask | (1 << i)] - V[mask])
        return players, phi, V

    def assess(self, hotspot_id: str, x: dict, probs=None) -> dict:
        """Forecast, level, mechanism and plain-English drivers for one hotspot.

        `probs` overrides the model forecast (for example after CCTV fusion);
        explanations always describe the model's own forecast.
        """
        hp = HOTSPOT_BY_ID[hotspot_id]
        x = {f: float(x[f]) for f in FEATURES}
        players, phi, V = self._shapley(x, hp)
        p_model = V[-1]
        full = 2 ** len(players) - 1
        without = {pl: V[full & ~(1 << i)] for i, pl in enumerate(players)}
        p = p_model if probs is None else np.asarray(probs, dtype=float)
        level = level_for(float(p.max()))
        # Alert horizon: the earliest horizon that reaches the overall level.
        ranks = [LEVEL_RANK[level_for(float(v))] for v in p]
        j = ranks.index(max(ranks))
        h = HORIZONS[j]

        contrib = {pl: max(0.0, float(phi[i, j])) for i, pl in enumerate(players)}
        by_group = {g: 0.0 for g in GROUPS}
        for pl, v in contrib.items():
            by_group[MECH_GROUP[pl]] += v
        tot = sum(by_group.values())
        shares = {g: round(v / tot, 3) if tot > 0 else 0.0 for g, v in by_group.items()}

        # Counterfactual evidence: the model's forecast with one factor set to normal.
        counterfactual = {
            "low_tide": round(float(without["tide"][j]), 3),
            "normal_river": round(float(without["river"][j]), 3),
            "no_rain_forecast": round(float(without["rain_fcst"][j]), 3),
        }
        mech = self._mechanism(x, hp, h, shares, float(p_model[j]), counterfactual) if level != "Normal" else None
        return {
            "probs": {f"{hh}h": round(float(p[i]), 3) for i, hh in enumerate(HORIZONS)},
            "model_probs": {f"{hh}h": round(float(p_model[i]), 3) for i, hh in enumerate(HORIZONS)},
            "levels": {f"{hh}h": level_for(float(p[i])) for i, hh in enumerate(HORIZONS)},
            "level": level,
            "alert_horizon": f"{h}h",
            "mechanism": mech,
            "shares": shares,
            "drivers": self._drivers(x, contrib, hp),
            "counterfactual": counterfactual,
            "headline": self._headline(mech, x, hp, level),
            "projected_drain_pct": round(self._projected_drain(x, h), 0),
        }

    @staticmethod
    def _rain_rate(x):
        return max(x["rain_1h"], x["rain_fcst_3h"] / 3.0)

    @staticmethod
    def _max_tide_within(x, h):
        return max(x["tide_m"], x["tide_next_high_m"] if x["hours_to_high_tide"] <= h else x["tide_m"])

    @staticmethod
    def _projected_drain(x, h):
        fc = x["rain_fcst_3h"] * min(h, 3) / 3 + max(0.0, x["rain_fcst_6h"] - x["rain_fcst_3h"]) * max(0, h - 3) / 3
        return min(100.0, x["drain_pct"] + max(0.0, x["drain_rate"]) * min(h, 2) + 0.6 * fc + 0.3 * x["rain_1h"])

    def _mechanism(self, x, hp, h, shares, p, cf):
        """Dominant cause, using the brief's definitions.

        Tidal Backflow: a tidal-outfall site, high tide within the horizon and the
        drain projected above 80 %. River Overflow: a riverside site with the Miri
        River at alert level. Combined: both, or tidal backflow under extreme rain.
        The Shapley shares and counterfactuals are returned alongside as evidence
        but do not flip the label, so it stays stable from hour to hour.
        """
        tidal = (hp["tidal_outfall"]
                 and self._max_tide_within(x, h) >= HIGH_TIDE_M
                 and self._projected_drain(x, h) > DRAIN_BACKFLOW_PCT)
        river = hp["river_adjacent"] and x["river_m"] >= RIVER_ALERT_M
        intense = self._rain_rate(x) >= 70 or x["rain_3h"] + x["rain_fcst_3h"] >= 150
        if river and tidal:
            return "Combined"
        if river:
            return "River Overflow"
        if tidal:
            return "Combined" if intense else "Tidal Backflow"
        return "Rainfall Overload"

    def _drivers(self, x, contrib, hp):
        """Top contributing factors in plain English, strongest first."""
        text = {
            "rain_now": lambda: f"{x['rain_1h']:.0f} mm/hr rain now ({x['rain_3h']:.0f} mm in the last 3 h)",
            "rain_fcst": lambda: (f"{x['rain_fcst_3h']:.0f} mm rain forecast in the next 3 h"
                                  + (f", {x['rain_fcst_6h']:.0f} mm in 6 h" if x["rain_fcst_6h"] - x["rain_fcst_3h"] >= 5 else "")),
            "tide": lambda: (f"High tide {x['tide_next_high_m']:.1f} m in {_fmt_minutes(x['hours_to_high_tide'])} (now {x['tide_m']:.1f} m)"
                             if x["hours_to_high_tide"] <= 6 else f"Tide at {x['tide_m']:.1f} m"),
            "river": lambda: f"Miri River at {x['river_m']:.2f} m (overtops near {hp['bank']:.1f} m)",
            "drain": lambda: (f"Smart Drain {x['drain_pct']:.0f}% full"
                              + (f", rising {x['drain_rate']:.0f}%/h" if x["drain_rate"] >= 3 else "")),
        }
        scored = [{"key": k, "group": MECH_GROUP[k], "text": text[k](), "weight": v}
                  for k, v in contrib.items() if v > 0.01]
        scored.sort(key=lambda d: -d["weight"])
        tot = sum(d["weight"] for d in scored) or 1.0
        for d in scored:
            d["weight"] = round(d["weight"] / tot, 3)
        return scored[:4]

    def _headline(self, mech, x, hp, level):
        name = hp["name"]
        rate = self._rain_rate(x)
        if mech is None:
            return f"No significant flood risk at {name} in the next 6 h"
        if mech == "Tidal Backflow":
            when = ("High tide now" if x["hours_to_high_tide"] > 9 or x["tide_m"] >= x["tide_next_high_m"] - 0.05
                    else f"High tide ({x['tide_next_high_m']:.1f} m) in {_fmt_minutes(x['hours_to_high_tide'])}")
            return f"{when} + {rate:.0f} mm/hr rain → backflow risk at {name}"
        if mech == "River Overflow":
            return f"Miri River at {x['river_m']:.1f} m + sustained rain → river overflow risk at {name}"
        if mech == "Combined":
            return (f"{rate:.0f} mm/hr rain + tide {self._max_tide_within(x, 6):.1f} m + river {x['river_m']:.1f} m "
                    f"→ compound flood risk at {name}")
        return f"{rate:.0f} mm/hr rain ({x['rain_fcst_3h']:.0f} mm in 3 h) exceeds drain capacity → flash flood risk at {name}"


if __name__ == "__main__":
    train()
