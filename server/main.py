"""Miri FloodSense API.

Run:  python -m uvicorn server.main:app --port 8000
The first start trains the models if server/artifacts is empty (about 3 minutes).
"""
import json
import math
import os
import re
from datetime import datetime

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import cctv, llm, sitrep
from .alerts import AlertStore
from .config import (
    DATA_DIR, FEATURES, FLOOD_DEPTH_CM, HORIZONS, HOTSPOT_BY_ID, HOTSPOTS, LEVEL_RANK, LEVELS, ROOT,
    public_hotspot,
)
from .model import METRICS_PATH, MODEL_PATH, FloodModel


def _model_is_current():
    """The saved model exists and was trained on today's feature list."""
    if not (MODEL_PATH.exists() and METRICS_PATH.exists()):
        return False
    try:
        return json.loads(METRICS_PATH.read_text()).get("features") == FEATURES
    except (OSError, json.JSONDecodeError):
        return False


if not (DATA_DIR / "sensor_history.csv").exists():
    print("No sensor history found: generating data (about 30 seconds)...")
    from .generate_data import generate
    generate()
if not _model_is_current():
    print("No trained model for the current features: training (about 3 minutes)...")
    from .model import train
    train()

from .live import LiveEngine, ResponseError, iso, myt_now, myt_stamp  # noqa: E402  (needs the data files)
from .scenario import run_episode  # noqa: E402

model = FloodModel()
alerts = AlertStore()
engine = LiveEngine(model, alerts)

app = FastAPI(title="Miri FloodSense API", version="0.1.0")

# The deployed UI is on its own subdomain, so the browser calls this API cross-origin.
# CORS_ORIGINS lists the UI origins, comma-separated. Unset means same-origin only
# (the dev proxy, or the single-port build served below).
CORS_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
if CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type"])


def clean(obj):
    """Make numpy / pandas values JSON-safe."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [clean(v) for v in obj.tolist()]
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    return obj


def J(obj, status=200):
    return JSONResponse(content=clean(obj), status_code=status)


# ─── Meta ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return J({"ok": True, "llm": llm.status(), "model": {"trained_at": model.metrics["trained_at"],
                                                        "algorithm": model.metrics["algorithm"]},
              "levels": [{"name": n, "min": lo} for n, lo in LEVELS], "server_time": myt_stamp()})


@app.get("/api/hotspots")
def hotspots():
    return J([public_hotspot(h) for h in HOTSPOTS])


# ─── Live feed ────────────────────────────────────────────────────────────
@app.get("/api/live")
def live():
    return J(engine.snapshot())


@app.get("/api/live/history/{hotspot_id}")
def live_history(hotspot_id: str, hours: int = 48):
    if hotspot_id not in HOTSPOT_BY_ID:
        raise HTTPException(404, "Unknown hotspot")
    return J(engine.history(hotspot_id, max(6, min(hours, 72))))


class Control(BaseModel):
    action: str
    speed: str | None = None
    event_id: str | None = None
    rate: float | None = Field(None, ge=5, le=150)
    duration: int | None = Field(None, ge=1, le=12)


@app.post("/api/live/control")
def live_control(c: Control):
    kw = {k: v for k, v in c.model_dump().items() if k != "action" and v is not None}
    try:
        engine.control(c.action, **kw)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return J(engine.snapshot())


# ─── Digital twin and response ────────────────────────────────────────────
@app.get("/api/twin")
def twin():
    return J(engine.twin())


@app.get("/api/twin/history")
def twin_history(hours: int = 24):
    return J(engine.twin_history(max(1, min(hours, 48))))


class Respond(BaseModel):
    action: str
    hotspot_id: str
    unit: str | None = None
    operator: str = "MSCCC duty officer"


@app.post("/api/respond")
def respond(r: Respond):
    if r.hotspot_id not in HOTSPOT_BY_ID:
        raise HTTPException(404, "Unknown hotspot")
    try:
        state = engine.respond(r.action, r.hotspot_id, r.unit, r.operator)
    except ResponseError as e:
        raise HTTPException(400, str(e))
    return J(state)


@app.get("/api/sitrep")
def get_sitrep(operator: str = "MSCCC duty officer"):
    snap = engine.snapshot()
    generated = myt_now().isoformat(timespec="seconds")
    return J({"markdown": sitrep.build(snap, alerts.list(), operator, generated), "generated_at": generated,
              "sim_time": snap["sim_time"], "source": snap["source"]})


@app.get("/api/tides")
def tides(days: int = 3):
    return J(engine.tide_table(max(1, min(days, 10))))


# ─── What-if simulator ────────────────────────────────────────────────────
class Scenario(BaseModel):
    rain_mmhr: float = Field(45, ge=0, le=150)
    duration_h: int = Field(3, ge=0, le=24)
    tide_m: float = Field(2.5, ge=0, le=3.2)
    hours_to_high: float = Field(1.5, ge=-6, le=12)
    antecedent_mm: float = Field(0, ge=0, le=300)


def _run_scenario(s: Scenario):
    ep = run_episode(s.rain_mmhr, s.duration_h, s.tide_m, s.hours_to_high, s.antecedent_mm)
    any_e = next(iter(ep.values()))
    rel = any_e["rel"]
    i0 = int(np.where(rel == 0)[0][0])
    T = min(len(rel) - i0, max(s.duration_h, 3) + 9)
    out = []
    for hp in HOTSPOTS:
        e = ep[hp["id"]]
        x = dict(zip(FEATURES, e["X"][i0]))
        a = model.assess(hp["id"], x)
        P = model.predict(pd.DataFrame(e["X"][i0:i0 + T], columns=FEATURES))
        depth = e["depth"][i0:i0 + T]
        wet = np.where(depth >= FLOOD_DEPTH_CM)[0]
        out.append({
            **public_hotspot(hp), "features": x, "assessment": a,
            "timeline": {
                "hour": list(range(T)),
                "p1": P[:, 0].round(3), "p3": P[:, 1].round(3), "p6": P[:, 2].round(3),
                "drain": e["drain"][i0:i0 + T].round(1), "depth": depth.round(1),
            },
            # What the hydraulic model (the digital twin) does with the same storm.
            "hydraulic": {"peak_depth_cm": int(depth.max()), "peak_hour": int(depth.argmax()),
                          "first_flood_hour": int(wet[0]) if len(wet) else None,
                          "flooded_hours": int(len(wet))},
        })
    lo = max(0, i0 - 6)
    city = {"hour": rel[lo:i0 + T], "rain": (any_e["rain"][lo:i0 + T] / HOTSPOTS[0]["rain_mult"]).round(1),
            "tide": any_e["tide"][lo:i0 + T].round(2), "river": any_e["river"][lo:i0 + T].round(2)}
    return out, city


@app.post("/api/simulate")
def simulate(s: Scenario):
    out, city = _run_scenario(s)
    return J({"params": s.model_dump(), "hotspots": out, "city": city})


class ScenarioDraft(Scenario):
    hotspot_ids: list[str] | None = None


@app.post("/api/simulate/draft")
def simulate_draft(s: ScenarioDraft):
    out, _ = _run_scenario(s)
    now = myt_now().floor("min")
    created = []
    for r in out:
        a = r["assessment"]
        if s.hotspot_ids is not None and r["id"] not in s.hotspot_ids:
            continue
        if LEVEL_RANK[a["level"]] < LEVEL_RANK["Warning"]:
            continue
        hp = HOTSPOT_BY_ID[r["id"]]
        x = r["features"]
        first = next((h for h in HORIZONS if a["probs"][f"{h}h"] >= 0.5), int(a["alert_horizon"][:-1]))
        ht = now + pd.Timedelta(hours=s.hours_to_high)
        created.append(alerts.create({
            "kind": "warning",
            "hotspot_id": hp["id"], "hotspot": hp["name"], "area": hp["area"], "roads": hp["roads"],
            "relief_centre": hp["relief_centre"], "pump_point": hp["pump_point"], "drain": hp["drain"],
            "drain_id": hp["drain_id"], "cctv_camera": hp["cctv"],
            "source": "simulator", "exercise": True, "flooding_now": a["flooding_now"], "water_depth_cm": a["water_depth_cm"],
            "scenario": f"{s.rain_mmhr:.0f} mm/hr for {s.duration_h} h, high tide {s.tide_m:.1f} m in {s.hours_to_high:g} h",
            "sim_time": iso(now), "local_time_now": f"{now:%A %d %B %Y, %H:%M}",
            "level": a["level"], "probs": a["probs"], "alert_horizon": a["alert_horizon"],
            "expected_by": iso(now + pd.Timedelta(hours=first)),
            "expected_by_local": f"{now + pd.Timedelta(hours=first):%H:%M}",
            "mechanism": a["mechanism"], "headline": a["headline"], "drivers": [d["text"] for d in a["drivers"]],
            "sensors": {"rain_forecast_3h_mm": round(x["rain_fcst_3h"], 0), "drain_pct": round(x["drain_pct"], 0),
                        "water_on_road_cm": int(x["water_depth_cm"]),
                        "river_m": round(x["river_m"], 2), "tide_m": round(x["tide_m"], 2)},
            "next_high_tide": {"time": f"{ht:%H:%M}", "height_m": s.tide_m, "surge_m": 0.0} if s.hours_to_high >= 0 else None,
            "cctv_confirmation": None, "incident": None, "response": None,
            "hydraulic": r["hydraulic"],
        }))
    return J({"created": created})


# ─── CCTV ─────────────────────────────────────────────────────────────────
class CCTVRequest(BaseModel):
    hotspot_id: str
    image_base64: str = Field(..., max_length=15_000_000)
    apply: bool = True


@app.post("/api/cctv/analyze")
def cctv_analyze(req: CCTVRequest):
    hp = HOTSPOT_BY_ID.get(req.hotspot_id)
    if hp is None:
        raise HTTPException(404, "Unknown hotspot")
    try:
        reading = cctv.analyze(req.image_base64, hp)
    except Exception as e:  # unreadable image
        raise HTTPException(400, f"Could not read the image: {e}")
    before = after = None
    if req.apply:
        before, after = engine.set_cctv(req.hotspot_id, reading)
    return J({"reading": reading, "before": before, "after": after})


@app.delete("/api/cctv/{hotspot_id}")
def cctv_clear(hotspot_id: str):
    if hotspot_id not in HOTSPOT_BY_ID:
        raise HTTPException(404, "Unknown hotspot")
    engine.clear_cctv(hotspot_id)
    return J({"ok": True})


# ─── Alerts ───────────────────────────────────────────────────────────────
@app.get("/api/alerts")
def list_alerts():
    alerts.expire_stale("simulator", myt_now(), {})
    return J(alerts.list())


class DraftRequest(BaseModel):
    hotspot_id: str


@app.post("/api/alerts/draft")
def draft_alert(req: DraftRequest):
    if req.hotspot_id not in HOTSPOT_BY_ID:
        raise HTTPException(404, "Unknown hotspot")
    with engine.lock:
        a = engine.current[req.hotspot_id]
        if a["level"] == "Normal":
            raise HTTPException(400, f"{HOTSPOT_BY_ID[req.hotspot_id]['name']} is at Normal: there is nothing to warn about.")
        ctx = engine.alert_context(req.hotspot_id)
        alert = alerts.create(ctx)
        kind = "advisory" if ctx["kind"] == "watch" else "alert"
        engine.log("info", f"{a['level']} {kind} drafted for {ctx['hotspot']}",
                   f"Draft {alert['id']} requested by the operator.", req.hotspot_id, alert["id"])
    return J(alert)


class AlertEdit(BaseModel):
    public_en: str | None = None
    public_ms: str | None = None
    checklist: list[dict] | None = None
    operator_note: str | None = None
    operator: str = "MSCCC duty officer"


# Checklist actions that are also response actions in the digital twin.
CHECKLIST_ACTIONS = [
    (re.compile(r"\b(deploy|send)\b.*\bpumps?\b", re.I), "deploy_pump"),
    (re.compile(r"\b(close|divert)\b.*\b(road|traffic|jalan|lorong)\b", re.I), "close_roads"),
    (re.compile(r"\bopen\b.*\brelief centre\b", re.I), "open_relief"),
]


@app.patch("/api/alerts/{alert_id}")
def edit_alert(alert_id: str, body: AlertEdit):
    before = alerts.get(alert_id)
    if before is None:
        raise HTTPException(404, "Unknown alert")
    was_done = {c["id"]: c.get("done") for c in before.get("checklist", [])}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k != "operator"}
    try:
        a = alerts.update(alert_id, fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    notes = []
    # Ticking "deploy pumps", "close road" or "open relief centre" does it in the twin too,
    # but only for alerts from the feed that is running now (not simulator exercises).
    if body.checklist is not None and a.get("kind", "warning") != "all_clear" and a["source"] == engine.source:
        for item in a["checklist"]:
            if not item.get("done") or was_done.get(item["id"]):
                continue
            for pattern, action in CHECKLIST_ACTIONS:
                if pattern.search(item.get("action", "")):
                    try:
                        engine.respond(action, a["hotspot_id"], operator=body.operator)
                        notes.append({"ok": True, "action": action})
                    except ResponseError as e:
                        notes.append({"ok": False, "action": action, "message": str(e)})
                    break
    return J({**a, "response_actions": notes})


class Decision(BaseModel):
    operator: str = "MSCCC duty officer"
    note: str = ""


def _decide(alert_id, approve, d):
    try:
        a = alerts.decide(alert_id, approve, d.operator, d.note)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if a is None:
        raise HTTPException(404, "Unknown alert")
    if a["source"] == engine.source:
        if a["status"] == "sent":
            engine.log("success", f"Alert {a['id']} sent: {a['hotspot_name']}",
                       f"{a['level']} alert approved by {d.operator} and sent to Miri CARES (simulated).", a["hotspot_id"], a["id"])
        elif a["status"] == "approved":
            engine.log("success", f"Exercise alert {a['id']} approved: {a['hotspot_name']}",
                       f"Approved by {d.operator}. Exercise only: nothing was sent to the public.", a["hotspot_id"], a["id"])
        else:
            engine.log("info", f"Alert {a['id']} rejected: {a['hotspot_name']}",
                       f"Rejected by {d.operator}{': ' + d.note if d.note else ''}.", a["hotspot_id"], a["id"])
    return J(a)


@app.post("/api/alerts/{alert_id}/approve")
def approve_alert(alert_id: str, d: Decision):
    return _decide(alert_id, True, d)


@app.post("/api/alerts/{alert_id}/reject")
def reject_alert(alert_id: str, d: Decision):
    return _decide(alert_id, False, d)


@app.delete("/api/alerts")
def clear_alerts():
    alerts.clear()
    return J({"ok": True})


# ─── Model ────────────────────────────────────────────────────────────────
@app.get("/api/model")
def model_info():
    events = pd.read_csv(DATA_DIR / "flood_events.csv", parse_dates=["start", "end"])
    return J({**model.metrics, "flood_events": events.to_dict(orient="records"),
              "hotspots": [public_hotspot(h) for h in HOTSPOTS]})


# ─── Production build of the React app (npm run build) ────────────────────
BUILD_DIR = (ROOT.parent / "build").resolve()
if BUILD_DIR.exists():
    app.mount("/static", StaticFiles(directory=BUILD_DIR / "static"), name="app-static")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        f = (BUILD_DIR / path).resolve()
        # Only files inside build/: a path with ".." must not reach server/.env or the rest of the disk.
        if path and f.is_file() and f.is_relative_to(BUILD_DIR):
            return FileResponse(f)
        return FileResponse(BUILD_DIR / "index.html")
