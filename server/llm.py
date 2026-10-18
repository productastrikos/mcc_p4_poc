"""Claude calls for CCTV vision and alert drafting.

Credentials: set ANTHROPIC_API_KEY (environment or server/.env). Without a key,
callers fall back to the offline paths in cctv.py and alerts.py, and the UI
labels results accordingly.
"""
import json
import os

from .config import ROOT

MODEL = None  # resolved in _load_env()


def _load_env():
    """Read server/.env (KEY=VALUE lines) without overriding real environment variables."""
    global MODEL
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    MODEL = os.environ.get("FLOODSENSE_LLM_MODEL", "claude-opus-5-5")


_load_env()

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None


class LLMError(Exception):
    pass


def status() -> dict:
    if anthropic is None:
        return {"enabled": False, "model": MODEL, "reason": "anthropic package not installed (pip install -r server/requirements.txt)"}
    if os.environ.get("FLOODSENSE_LLM", "").lower() in ("off", "0", "false"):
        return {"enabled": False, "model": MODEL, "reason": "Disabled with FLOODSENSE_LLM=off"}
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return {"enabled": False, "model": MODEL, "reason": "No ANTHROPIC_API_KEY set; using offline fallbacks"}
    return {"enabled": True, "model": MODEL, "reason": None}


_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(max_retries=2, timeout=90.0)
    return _client


def call_json(system: str, content: list, schema: dict, effort: str = "medium", max_tokens: int = 8000):
    """One Messages API call constrained to `schema`. Returns (data, model_that_answered)."""
    if not status()["enabled"]:
        raise LLMError(status()["reason"])
    try:
        resp = _get_client().beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            # On a safety decline, let the API retry on its recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as e:
        raise LLMError("Anthropic API key was rejected") from e
    except anthropic.RateLimitError as e:
        raise LLMError("Anthropic API rate limit reached; try again shortly") from e
    except anthropic.BadRequestError as e:
        raise LLMError(f"Request rejected: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"Anthropic API error {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError("Could not reach the Anthropic API") from e

    if resp.stop_reason == "refusal":
        raise LLMError("The model declined this request")
    if resp.stop_reason == "max_tokens":
        raise LLMError("The model response was cut off")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise LLMError("Empty model response")
    try:
        return json.loads(text), resp.model
    except json.JSONDecodeError as e:
        raise LLMError("Model returned invalid JSON") from e


# ─── CCTV vision ──────────────────────────────────────────────────────────
CCTV_STATUSES = ["Normal", "Rising", "Overflowing", "Road Flooded"]

CCTV_SYSTEM = (
    "You are the flood-monitoring vision analyst at the Miri Smart City Command Centre (MSCCC), "
    "Sarawak, Malaysia. You read CCTV frames of urban monsoon drains and roads and report the water "
    "condition so that operators can confirm or dismiss a flood forecast. Be conservative: report only "
    "what is visible in the frame."
)

CCTV_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": CCTV_STATUSES},
        "depth_cm": {"type": "number", "description": "Estimated water depth on the road surface in cm; 0 if the road is not covered."},
        "confidence": {"type": "number", "description": "0 to 1"},
        "observations": {"type": "string", "description": "One or two sentences on what is visible."},
        "depth_references": {"type": "array", "items": {"type": "string"},
                             "description": "Visible objects used to judge depth, e.g. kerb, wheel hub."},
        "is_drain_or_road_scene": {"type": "boolean"},
    },
    "required": ["status", "depth_cm", "confidence", "observations", "depth_references", "is_drain_or_road_scene"],
    "additionalProperties": False,
}


def classify_cctv(image_b64: str, media_type: str, camera: str, hotspot_name: str) -> dict:
    prompt = (
        f"CCTV frame from camera {camera} at the {hotspot_name} flood hotspot.\n\n"
        "Classify the water condition as exactly one of:\n"
        "- Normal: drain water well below the rim; road dry or only wet from rain.\n"
        "- Rising: drain more than about half full or flowing fast near the rim; road not covered.\n"
        "- Overflowing: water spilling over the drain edge onto the kerb or road shoulder; shallow sheet flow.\n"
        "- Road Flooded: standing or flowing water across the carriageway.\n\n"
        "Estimate the water depth on the road in cm (0 if the road is not covered). Judge depth from visible "
        "references such as kerbs (about 15 cm), wheel hubs (about 30 cm), the bottom of car doors (about 40 cm) "
        "or a person's knees (about 50 cm). If the frame is not a drain or road scene, or is too dark or blurred "
        "to judge, say so in the observations and give a low confidence."
    )
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
        {"type": "text", "text": prompt},
    ]
    data, model = call_json(CCTV_SYSTEM, content, CCTV_SCHEMA, effort="low", max_tokens=6000)
    data["confidence"] = max(0.0, min(1.0, float(data["confidence"])))
    data["depth_cm"] = max(0.0, float(data["depth_cm"]))
    return {**data, "engine": model}


# ─── Alert drafting ───────────────────────────────────────────────────────
ALERT_MAX_CHARS = 300   # the bilingual public alert, English + Bahasa Malaysia together

ALERT_SYSTEM = (
    "You draft flood warnings for Miri City Council's Smart City Command Centre (MSCCC) in Miri, Sarawak. "
    "Each draft has two parts that a duty operator reviews before anything is sent:\n"
    "1. A public alert for the Miri CARES app, in English and in Bahasa Malaysia. Residents read it on a phone "
    "lock screen, so it must be short, name the affected area and roads, say when flooding is expected, and give "
    "one or two concrete actions (for example move vehicles to higher ground, avoid a named road, prepare to go to "
    "a named relief centre). Use plain words, no hashtags, no emoji, no internal jargon such as model names or "
    "probabilities. The Bahasa Malaysia version must be natural Malaysian usage, not a word-for-word translation.\n"
    "2. An action checklist for MSCCC operators: specific, ordered actions with an owner and timing, such as "
    "deploying mobile pumps to a named point, closing or diverting a named road, alerting the District Disaster "
    "Management Committee (Jawatankuasa Pengurusan Bencana Daerah Miri), and confirming conditions on CCTV.\n"
    "Only use places, roads and facilities given in the context."
)

ALERT_SCHEMA = {
    "type": "object",
    "properties": {
        "public_en": {"type": "string", "description": "English public alert, at most 140 characters."},
        "public_ms": {"type": "string", "description": "Bahasa Malaysia public alert, at most 155 characters."},
        "checklist": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "action": {"type": "string"},
                    "owner": {"type": "string"},
                    "timing": {"type": "string"},
                },
                "required": ["action", "owner", "timing"],
                "additionalProperties": False,
            },
        },
        "operator_summary": {"type": "string", "description": "One sentence situation summary for the operator."},
    },
    "required": ["public_en", "public_ms", "checklist", "operator_summary"],
    "additionalProperties": False,
}

OWNERS = [
    "MSCCC duty officer", "MCC Engineering (mobile pumps)", "MCC Enforcement", "JKR Miri (roads)",
    "JPS Miri (drainage and irrigation)", "Polis Trafik Miri", "BOMBA Miri (fire and rescue)",
    "APM Miri (civil defence)", "JPBD Miri (District Disaster Management Committee)", "Miri CARES team",
]


def draft_alert(context: dict) -> dict:
    prompt = (
        "Draft the public alert and the operator checklist for this forecast.\n\n"
        f"Hard limit: public_en and public_ms together must not exceed {ALERT_MAX_CHARS} characters "
        "(aim for about 130 and 150). Start public_en with 'FLOOD WARNING' or 'FLOOD DANGER' to match the level, "
        "and public_ms with 'AMARAN BANJIR' or 'BAHAYA BANJIR'.\n"
        "Checklist: 4 to 7 items, most urgent first. Choose owners from: " + "; ".join(OWNERS) + ". "
        "Include closing or diverting a named road and alerting the District Disaster Management Committee when the "
        "level is Danger; at Warning, put them on standby instead.\n\n"
        f"<forecast_context>\n{json.dumps(context, indent=2, default=str)}\n</forecast_context>"
    )
    data, model = call_json(ALERT_SYSTEM, [{"type": "text", "text": prompt}], ALERT_SCHEMA, effort="medium", max_tokens=8000)
    return {**data, "engine": model}
