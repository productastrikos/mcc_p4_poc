"""Alert drafts, operator approval and history.

Drafts are written by Claude (llm.draft_alert). Without an API key a
bilingual template is used instead and the draft is labelled as such.
Nothing is sent until an operator approves it; sending is simulated.

Kinds
  warning    the hotspot is at Warning or Danger (drafted automatically)
  watch      an advisory an operator chose to draft at Watch
  all_clear  drafted when an incident that had a sent warning closes

Sources
  live       the real-time feed: approval sends to Miri CARES (simulated)
  drill      storm drill, replay  event replay, simulator  what-if scenario:
             exercises. Approval is recorded but nothing goes to the public,
             and the text carries an [EXERCISE] / [LATIHAN] tag.

Status: drafting → pending → sent (live) | approved (exercise) | rejected,
or superseded (a newer draft replaced it) or expired (the situation moved on
before anyone decided).
"""
import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from pathlib import Path

import pandas as pd

from . import llm
from .config import DATA_DIR, HOTSPOT_BY_ID, LEVEL_RANK

# FLOODSENSE_ALERTS points a second server (tests, demos) at its own alert history.
ALERTS_PATH = Path(os.environ["FLOODSENSE_ALERTS"]) if os.environ.get("FLOODSENSE_ALERTS") else DATA_DIR / "alerts.json"
OPEN_STATUSES = ("drafting", "pending")
DONE_STATUSES = ("sent", "approved")
STALE_HOURS = 6
EXERCISE_TAG = {"en": "[EXERCISE] ", "ms": "[LATIHAN] "}


def myt_stamp() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def _clock(ts: pd.Timestamp, lang: str) -> str:
    h, m = ts.hour, ts.minute
    h12 = h % 12 or 12
    if lang == "en":
        return f"{h12}:{m:02d}{'am' if h < 12 else 'pm'}"
    period = "pagi" if h < 12 else "tengah hari" if h < 14 else "petang" if h < 19 else "malam"
    return f"{h12}:{m:02d} {period}"


def _fit(en, ms, short_en, short_ms, tag_en="", tag_ms=""):
    """Use the long wording if both languages fit the 300-character limit together."""
    if len(tag_en + en) + len(tag_ms + ms) + 1 <= llm.ALERT_MAX_CHARS:
        return tag_en + en, tag_ms + ms
    return tag_en + short_en, tag_ms + short_ms


def template_draft(ctx: dict) -> dict:
    """Offline bilingual alert and checklist from fixed templates."""
    hp = HOTSPOT_BY_ID[ctx["hotspot_id"]]
    kind = ctx.get("kind", "warning")
    level = ctx["level"]
    danger = level == "Danger"
    when = pd.Timestamp(ctx["expected_by"])
    road = hp["roads"][0]
    relief = hp["relief_centre"].replace(" (relief centre)", "")
    tag_en, tag_ms = (EXERCISE_TAG["en"], EXERCISE_TAG["ms"]) if ctx.get("exercise") else ("", "")
    mech = ctx.get("mechanism") or "Rainfall Overload"

    if kind == "all_clear":
        en, ms = _fit(
            f"FLOOD ALL CLEAR {hp['name']}: flood risk has eased and water has receded. Take care on {road}; report blocked drains via Miri CARES.",
            f"BANJIR SURUT {hp['name']}: risiko banjir telah berkurang dan air telah surut. Berhati-hati di {road}; lapor longkang tersumbat melalui Miri CARES.",
            f"FLOOD ALL CLEAR {hp['name']}: risk has eased. Take care on {road}.",
            f"BANJIR SURUT {hp['name']}: risiko berkurang. Berhati-hati di {road}.", tag_en, tag_ms)
        items = [
            {"action": f"Confirm on {hp['cctv']} and Smart Drain {hp['drain_id']} that water has receded", "owner": "MSCCC duty officer", "timing": "Now"},
            {"action": f"Recall mobile pumps from {hp['pump_point']} once the drain is below 60%", "owner": "MCC Engineering (mobile pumps)", "timing": "Within 1 h"},
            {"action": f"Inspect {road} and reopen any closed roads", "owner": "JKR Miri (roads)", "timing": "Within 1 h"},
            {"action": f"Stand down {hp['relief_centre']} if it was opened", "owner": "APM Miri (civil defence)", "timing": "When residents have returned"},
            {"action": "Log debris and drain blockages for clearing", "owner": "MCC Enforcement", "timing": "Within 24 h"},
        ]
        summary = f"{hp['name']} back to Normal; send the all-clear and stand down resources."
    elif kind == "watch":
        en, ms = _fit(
            f"FLOOD WATCH {hp['name']}: heavy rain may cause flooding in the next few hours. Avoid parking in low areas near {road}; follow Miri CARES for updates.",
            f"AWASAN BANJIR {hp['name']}: hujan lebat boleh menyebabkan banjir dalam beberapa jam lagi. Elak meletak kenderaan di kawasan rendah berhampiran {road}.",
            f"FLOOD WATCH {hp['name']}: flooding possible. Avoid low areas near {road}.",
            f"AWASAN BANJIR {hp['name']}: banjir mungkin berlaku. Elak kawasan rendah di {road}.", tag_en, tag_ms)
        items = [
            {"action": f"Watch {hp['cctv']} and Smart Drain {hp['drain_id']}", "owner": "MSCCC duty officer", "timing": "Every 30 min"},
            {"action": f"Put a mobile pump on standby for {hp['pump_point']}", "owner": "MCC Engineering (mobile pumps)", "timing": "Within 1 h"},
            {"action": f"Check that the {hp['drain']} outfall is clear of debris", "owner": "JPS Miri (drainage and irrigation)", "timing": "Within 2 h"},
        ]
        summary = f"{hp['name']} at Watch ({mech}); advisory only, escalate if it reaches Warning."
    else:
        word_en, word_ms = ("DANGER", "BAHAYA") if danger else ("WARNING", "AMARAN")
        if ctx.get("flooding_now"):
            en, ms = _fit(
                f"FLOOD {word_en} {hp['name']}: roads are flooding now. Avoid {road}, move vehicles to higher ground. Relief centre: {relief}.",
                f"{word_ms} BANJIR {hp['name']}: jalan sedang dinaiki air. Elak {road}, alihkan kenderaan ke tempat tinggi. Pusat pemindahan: {relief}.",
                f"FLOOD {word_en} {hp['name']}: flooding now. Avoid {road}.",
                f"{word_ms} BANJIR {hp['name']}: banjir sekarang. Elak {road}.", tag_en, tag_ms)
        else:
            en, ms = _fit(
                f"FLOOD {word_en} {hp['name']}: flooding likely by {_clock(when, 'en')}. Move vehicles to higher ground, avoid {road}.",
                f"{word_ms} BANJIR {hp['name']}: banjir dijangka sebelum {_clock(when, 'ms')}. Alihkan kenderaan ke tempat tinggi, elak {road}.",
                f"FLOOD {word_en} {hp['name']} by {_clock(when, 'en')}. Move vehicles, avoid {road}.",
                f"{word_ms} BANJIR {hp['name']} sebelum {_clock(when, 'ms')}. Alih kenderaan, elak {road}.", tag_en, tag_ms)
        items = [
            {"action": f"Deploy mobile pumps to {hp['pump_point']}", "owner": "MCC Engineering (mobile pumps)", "timing": "Within 30 min"},
            {"action": f"Confirm water level on {hp['cctv']} and Smart Drain {hp['drain_id']}",
             "owner": "MSCCC duty officer", "timing": "Now, then every 15 min"},
        ]
        if mech in ("Tidal Backflow", "Combined") and hp["tidal_outfall"]:
            nht = ctx.get("next_high_tide") or {}
            items.append({"action": "Close tidal flap gates and check the outfall is clear before high tide",
                          "owner": "JPS Miri (drainage and irrigation)",
                          "timing": f"Before high tide{' at ' + nht['time'] if nht.get('time') else ''}"})
        if mech in ("River Overflow", "Combined") and hp["river_adjacent"]:
            items.append({"action": "Monitor Miri River level and prepare sandbags along the riverbank",
                          "owner": "JPS Miri (drainage and irrigation)", "timing": "Within 1 h"})
        if danger:
            items += [
                {"action": f"Close and divert traffic on {road}", "owner": "Polis Trafik Miri",
                 "timing": "Now" if ctx.get("flooding_now") else "Before expected onset"},
                {"action": "Alert the District Disaster Management Committee (JPBD Miri)",
                 "owner": "JPBD Miri (District Disaster Management Committee)", "timing": "Immediately"},
                {"action": f"Open {hp['relief_centre']}", "owner": "APM Miri (civil defence)", "timing": "Within 1 h"},
            ]
        else:
            items += [
                {"action": f"Put traffic diversion for {road} on standby", "owner": "Polis Trafik Miri", "timing": "Standby"},
                {"action": "Notify JPBD Miri of a possible escalation", "owner": "MSCCC duty officer", "timing": "Within 30 min"},
            ]
        summary = (f"{hp['name']} at {level} ({mech}); "
                   + ("flooding is under way." if ctx.get("flooding_now") else f"act before {ctx.get('expected_by_local', 'onset')}."))
    return {
        "public_en": en, "public_ms": ms, "checklist": items[:7],
        "operator_summary": summary,
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
        for a in self.alerts:
            a.setdefault("kind", "warning")
            a.setdefault("exercise", a.get("source") != "live")
            # Drafts interrupted by a restart are retried as templates.
            if a["status"] == "drafting":
                a.update(self._finish(template_draft(a["context"])))
                a["status"] = "pending"
            # The feed restarts at the current time, so exercises from the last run are over.
            if a["status"] in OPEN_STATUSES and a["source"] in ("drill", "replay"):
                self._expire(a, "Exercise ended when the server restarted")
        self._save()

    def _save(self):
        ALERTS_PATH.write_text(json.dumps(self.alerts, indent=2, default=str), encoding="utf-8")

    def list(self):
        with self.lock:
            return sorted(self.alerts, key=lambda a: (a["created_at"][:19], LEVEL_RANK.get(a["level"], 0)), reverse=True)

    def get(self, alert_id):
        with self.lock:
            return next((a for a in self.alerts if a["id"] == alert_id), None)

    def should_draft(self, hotspot_id, level, source, sim_time):
        """Draft once per hotspot per 6 sim-hours, and again on escalation to a higher level.

        A rejected draft counts too: the operator has decided, so the next hour does
        not bring the same draft back unless the level rises.
        """
        with self.lock:
            recent = [a for a in self.alerts if a["hotspot_id"] == hotspot_id and a["source"] == source
                      and a.get("kind", "warning") == "warning" and a["status"] not in ("expired",)
                      and 0 <= (pd.Timestamp(sim_time) - pd.Timestamp(a["sim_time"])) / pd.Timedelta(hours=1) < STALE_HOURS]
            return not any(LEVEL_RANK[a["level"]] >= LEVEL_RANK[level] for a in recent)

    def sent_since(self, hotspot_id, source, since):
        with self.lock:
            return any(a["hotspot_id"] == hotspot_id and a["source"] == source and a["status"] in DONE_STATUSES
                       and a.get("kind", "warning") != "all_clear" and a["sim_time"] >= since for a in self.alerts)

    def create(self, ctx: dict) -> dict:
        hp = HOTSPOT_BY_ID[ctx["hotspot_id"]]
        kind = ctx.get("kind", "warning")
        alert = {
            "id": "AL-" + uuid.uuid4().hex[:6].upper(),
            "kind": kind,
            "hotspot_id": hp["id"], "hotspot_name": hp["name"],
            "level": ctx["level"], "mechanism": ctx.get("mechanism"),
            "headline": ctx.get("headline"), "probs": ctx.get("probs"),
            "source": ctx.get("source", "live"), "exercise": bool(ctx.get("exercise")),
            "sim_time": ctx.get("sim_time"),
            "created_at": myt_stamp(),
            "status": "drafting", "context": ctx,
            "public_en": "", "public_ms": "", "checklist": [], "operator_summary": "", "engine": None,
        }
        with self.lock:
            # A newer draft for the same hotspot and source replaces older open ones.
            for a in self.alerts:
                if a["hotspot_id"] == hp["id"] and a["source"] == alert["source"] and a["status"] in OPEN_STATUSES:
                    a["status"] = "superseded"
                    a["superseded_by"] = alert["id"]
                    a["decided_at"] = alert["created_at"]
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
            if ctx.get("exercise"):   # never let an exercise read like a real warning
                for k, lang in (("public_en", "en"), ("public_ms", "ms")):
                    if not draft[k].lstrip().startswith(EXERCISE_TAG[lang].strip()):
                        draft[k] = EXERCISE_TAG[lang] + draft[k].lstrip()
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
            if any(k in fields for k in ("public_en", "public_ms")) and a["status"] != "pending":
                raise ValueError("Only a pending draft's text can be edited.")
            if "checklist" in fields and a["status"] not in ("pending", "sent", "approved"):
                raise ValueError(f"The checklist of a {a['status']} alert is closed.")
            for k in ("public_en", "public_ms", "checklist", "operator_note"):
                if k in fields:
                    a[k] = fields[k]
            if "public_en" in fields or "public_ms" in fields:
                a["edited"] = True
            self._save()
            return a

    def decide(self, alert_id, approve: bool, operator: str, note: str = ""):
        with self.lock:
            a = self.get(alert_id)
            if a is None:
                return None
            if a["status"] != "pending":
                raise ValueError(f"This alert is {a['status']} and can no longer be approved or rejected.")
            now = myt_stamp()
            if approve:
                text_len = len(a["public_en"]) + 1 + len(a["public_ms"])
                if text_len > llm.ALERT_MAX_CHARS:
                    raise ValueError(f"Public alert is {text_len} characters; the limit is {llm.ALERT_MAX_CHARS}.")
                if a.get("exercise"):
                    a.update(status="approved", approved_by=operator, decided_at=now, operator_note=note,
                             channels=[], exercise_note="Exercise: approval recorded, nothing sent to the public.")
                else:
                    a.update(status="sent", approved_by=operator, decided_at=now,
                             channels=["Miri CARES push", "Miri CARES in-app banner"], operator_note=note)
            else:
                a.update(status="rejected", approved_by=operator, decided_at=now, operator_note=note)
            self._save()
            return a

    # ─── Expiry ───────────────────────────────────────────────────────────
    @staticmethod
    def _expire(a, reason):
        a["status"] = "expired"
        a["expired_reason"] = reason
        a["decided_at"] = myt_stamp()

    def expire_open(self, sources, reason):
        """Expire open drafts from the given sources (an exercise has ended)."""
        with self.lock:
            changed = False
            for a in self.alerts:
                if a["status"] in OPEN_STATUSES and a["source"] in sources:
                    self._expire(a, reason)
                    changed = True
            if changed:
                self._save()

    def expire_stale(self, source, sim_time, levels, open_incidents=None):
        """Expire open drafts the feed has overtaken.

        A draft is stale when it is 6 sensor-hours old, when it is from a later time
        than the sensor clock (the clock was reset), or when its hotspot is back to
        Normal with no incident open, so the warning is no longer needed.
        """
        t = pd.Timestamp(sim_time)
        with self.lock:
            changed = False
            for a in self.alerts:
                if a["status"] not in OPEN_STATUSES or a["source"] != source:
                    continue
                age = (t - pd.Timestamp(a["sim_time"])) / pd.Timedelta(hours=1)
                eased = (a.get("kind") != "all_clear" and levels.get(a["hotspot_id"]) == "Normal"
                         and open_incidents is not None and a["hotspot_id"] not in open_incidents)
                if age >= STALE_HOURS:
                    self._expire(a, f"No decision within {STALE_HOURS} sensor-hours")
                elif age < 0:
                    self._expire(a, "The sensor clock was reset")
                elif eased:
                    self._expire(a, "The hotspot returned to Normal before a decision")
                else:
                    continue
                changed = True
            if changed:
                self._save()

    def clear(self):
        with self.lock:
            self.alerts = []
            self._save()
