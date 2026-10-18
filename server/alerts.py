"""Alert drafts, operator approval and history.

Drafts are written by Claude (llm.draft_alert). Without an API key a
bilingual template is used instead and the draft is labelled as such.
Nothing is sent until an operator approves it; sending is simulated.
"""
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pandas as pd

from . import llm
from .config import DATA_DIR, HOTSPOT_BY_ID, LEVEL_RANK

ALERTS_PATH = DATA_DIR / "alerts.json"
OPEN_STATUSES = ("drafting", "pending")


def _clock(ts: pd.Timestamp, lang: str) -> str:
    h, m = ts.hour, ts.minute
    h12 = h % 12 or 12
    if lang == "en":
        return f"{h12}:{m:02d}{'am' if h < 12 else 'pm'}"
    period = "pagi" if h < 12 else "tengah hari" if h < 14 else "petang" if h < 19 else "malam"
    return f"{h12}:{m:02d} {period}"


def template_draft(ctx: dict) -> dict:
    """Offline bilingual alert and checklist from fixed templates."""
    hp = HOTSPOT_BY_ID[ctx["hotspot_id"]]
    danger = ctx["level"] == "Danger"
    when = pd.Timestamp(ctx["expected_by"])
    road = hp["roads"][0]
    en = (f"FLOOD {'DANGER' if danger else 'WARNING'} {hp['name']}: flooding likely by {_clock(when, 'en')}. "
          f"Move vehicles to higher ground, avoid {road}.")
    ms = (f"{'BAHAYA' if danger else 'AMARAN'} BANJIR {hp['name']}: banjir dijangka sebelum {_clock(when, 'ms')}. "
          f"Alihkan kenderaan ke tempat tinggi, elak {road}.")
    if len(en) + len(ms) + 1 > llm.ALERT_MAX_CHARS:
        en = f"FLOOD {'DANGER' if danger else 'WARNING'} {hp['name']} by {_clock(when, 'en')}. Move vehicles, avoid {road}."
        ms = f"{'BAHAYA' if danger else 'AMARAN'} BANJIR {hp['name']} sebelum {_clock(when, 'ms')}. Alih kenderaan, elak {road}."
    mech = ctx.get("mechanism") or "Rainfall Overload"
    items = [
        {"action": f"Deploy mobile pumps to {hp['pump_point']}", "owner": "MCC Engineering (mobile pumps)", "timing": "Within 30 min"},
        {"action": f"Confirm water level on {hp['cctv']} and Smart Drain {hp['drain'].split('(')[-1].rstrip(')')}",
         "owner": "MSCCC duty officer", "timing": "Now, then every 15 min"},
    ]
    if mech in ("Tidal Backflow", "Combined"):
        items.append({"action": "Close tidal flap gates and check the outfall is clear before high tide",
                      "owner": "JPS Miri (drainage and irrigation)", "timing": "Before high tide"})
    if mech in ("River Overflow", "Combined"):
        items.append({"action": "Monitor Miri River level and prepare sandbags along the riverbank",
                      "owner": "JPS Miri (drainage and irrigation)", "timing": "Within 1 h"})
    if danger:
        items += [
            {"action": f"Close and divert traffic on {road}", "owner": "Polis Trafik Miri", "timing": "Before expected onset"},
            {"action": "Alert the District Disaster Management Committee (JPBD Miri)",
             "owner": "JPBD Miri (District Disaster Management Committee)", "timing": "Immediately"},
            {"action": f"Open {hp['relief_centre']}", "owner": "APM Miri (civil defence)", "timing": "Within 1 h"},
        ]
    else:
        items += [
            {"action": f"Put traffic diversion for {road} on standby", "owner": "Polis Trafik Miri", "timing": "Standby"},
            {"action": "Notify JPBD Miri of a possible escalation", "owner": "MSCCC duty officer", "timing": "Within 30 min"},
        ]
    return {
        "public_en": en, "public_ms": ms, "checklist": items[:7],
        "operator_summary": (f"{hp['name']} at {ctx['level']} ({mech}); act before {ctx.get('expected_by_local', 'onset')}."),
        "engine": "template (no LLM key)",
    }


class AlertStore:
    def __init__(self):
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=3)
        self.alerts = []
        if ALERTS_PATH.exists():
            try:
                self.alerts = json.loads(ALERTS_PATH.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                self.alerts = []
        # Drafts interrupted by a restart are retried as templates.
        for a in self.alerts:
            if a["status"] == "drafting":
                a.update(self._finish(template_draft(a["context"])))
                a["status"] = "pending"

    def _save(self):
        ALERTS_PATH.write_text(json.dumps(self.alerts, indent=2, default=str), encoding="utf-8")

    def list(self):
        with self.lock:
            return sorted(self.alerts, key=lambda a: (a["created_at"][:16], LEVEL_RANK[a["level"]]), reverse=True)

    def get(self, alert_id):
        with self.lock:
            return next((a for a in self.alerts if a["id"] == alert_id), None)

    def open_for(self, hotspot_id, source):
        with self.lock:
            return [a for a in self.alerts
                    if a["hotspot_id"] == hotspot_id and a["source"] == source and a["status"] in OPEN_STATUSES]

    def should_draft(self, hotspot_id, level, source, sim_time):
        """Draft once per hotspot per 6 sim-hours, and again on escalation to a higher level."""
        with self.lock:
            recent = [a for a in self.alerts if a["hotspot_id"] == hotspot_id and a["source"] == source
                      and a["status"] != "rejected"
                      and abs((pd.Timestamp(sim_time) - pd.Timestamp(a["sim_time"])) / pd.Timedelta(hours=1)) < 6]
            return not any(LEVEL_RANK[a["level"]] >= LEVEL_RANK[level] for a in recent)

    def create(self, ctx: dict) -> dict:
        hp = HOTSPOT_BY_ID[ctx["hotspot_id"]]
        alert = {
            "id": "AL-" + uuid.uuid4().hex[:6].upper(),
            "hotspot_id": hp["id"], "hotspot_name": hp["name"],
            "level": ctx["level"], "mechanism": ctx.get("mechanism"),
            "headline": ctx.get("headline"), "probs": ctx.get("probs"),
            "source": ctx.get("source", "live"), "sim_time": ctx.get("sim_time"),
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "status": "drafting", "context": ctx,
            "public_en": "", "public_ms": "", "checklist": [], "operator_summary": "", "engine": None,
        }
        with self.lock:
            # A newer draft for the same hotspot and source replaces older open ones.
            for a in self.alerts:
                if a["hotspot_id"] == hp["id"] and a["source"] == alert["source"] and a["status"] in OPEN_STATUSES:
                    a["status"] = "superseded"
                    a["superseded_by"] = alert["id"]
            self.alerts.append(alert)
            self._save()
        self.pool.submit(self._draft, alert["id"])
        return alert

    @staticmethod
    def _finish(draft: dict) -> dict:
        checklist = [{"id": i + 1, "done": False, **item} for i, item in enumerate(draft["checklist"])]
        return {
            "public_en": draft["public_en"].strip(), "public_ms": draft["public_ms"].strip(),
            "checklist": checklist, "operator_summary": draft.get("operator_summary", ""),
            "engine": draft.get("engine"), "llm_error": draft.get("llm_error"),
        }

    def _draft(self, alert_id):
        alert = self.get(alert_id)
        if alert is None:
            return
        ctx = alert["context"]
        try:
            draft = llm.draft_alert(ctx)
        except llm.LLMError as e:
            draft = template_draft(ctx)
            if llm.status()["enabled"]:
                draft["llm_error"] = str(e)
        except Exception as e:  # never leave a draft stuck in 'drafting'
            draft = template_draft(ctx)
            draft["llm_error"] = f"Unexpected error: {e}"
        with self.lock:
            alert.update(self._finish(draft))
            if alert["status"] == "drafting":
                alert["status"] = "pending"
            self._save()

    def update(self, alert_id, fields: dict):
        with self.lock:
            a = self.get(alert_id)
            if a is None:
                return None
            for k in ("public_en", "public_ms", "checklist", "operator_note"):
                if k in fields:
                    a[k] = fields[k]
            a["edited"] = True
            self._save()
            return a

    def decide(self, alert_id, approve: bool, operator: str, note: str = ""):
        with self.lock:
            a = self.get(alert_id)
            if a is None or a["status"] != "pending":
                return a
            now = datetime.now().isoformat(timespec="seconds")
            if approve:
                text_len = len(a["public_en"]) + 1 + len(a["public_ms"])
                if text_len > llm.ALERT_MAX_CHARS:
                    raise ValueError(f"Public alert is {text_len} characters; the limit is {llm.ALERT_MAX_CHARS}.")
                a.update(status="sent", approved_by=operator, decided_at=now,
                         channels=["Miri CARES push", "Miri CARES in-app banner"], operator_note=note)
            else:
                a.update(status="rejected", approved_by=operator, decided_at=now, operator_note=note)
            self._save()
            return a

    def clear(self):
        with self.lock:
            self.alerts = []
            self._save()
