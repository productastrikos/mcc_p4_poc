"""CCTV water-level check: sample frames, offline classifier and risk fusion.

With an Anthropic API key, frames are classified by Claude vision (llm.py).
Without one, a colour heuristic estimates how much of the frame is muddy
flood water. It is only a stand-in for demos and is labelled as such.
"""
import base64
import io
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from . import llm
from .config import CCTV_DIR

# How strongly a CCTV reading moves the forecast, as likelihood ratios per horizon.
CCTV_LR = {
    "Normal":       {"1h": 0.45, "3h": 0.65, "6h": 0.85},
    "Rising":       {"1h": 2.0,  "3h": 1.6,  "6h": 1.3},
    "Overflowing":  {"1h": 7.0,  "3h": 4.5,  "6h": 2.8},
    "Road Flooded": {"1h": 30.0, "3h": 14.0, "6h": 7.0},
}
CCTV_FLOOR = {"Road Flooded": 0.92, "Overflowing": 0.55}   # minimum +1h risk when confirmed


def fuse(probs: dict, reading: dict) -> dict:
    """Bayesian odds update of the model forecast with a CCTV reading, weighted by confidence."""
    status, conf = reading["status"], float(reading.get("confidence", 0.7))
    out = {}
    for k, p in probs.items():
        p = min(max(p, 1e-4), 1 - 1e-4)
        lr = CCTV_LR[status][k] ** conf
        odds = p / (1 - p) * lr
        out[k] = odds / (1 + odds)
    if status in CCTV_FLOOR:
        out["1h"] = max(out["1h"], CCTV_FLOOR[status] * conf + out["1h"] * (1 - conf))
    out["3h"] = max(out["3h"], out["1h"])
    out["6h"] = max(out["6h"], out["3h"])
    return {k: round(v, 3) for k, v in out.items()}


# ─── Offline heuristic ────────────────────────────────────────────────────
def heuristic_classify(img: Image.Image) -> dict:
    """Share of muddy-water pixels in the lower part of the frame."""
    small = img.convert("RGB").resize((240, 135))
    hsv = np.asarray(small.convert("HSV"), dtype=float) / 255.0
    lower = hsv[int(135 * 0.35):]
    h, s, v = lower[..., 0] * 360, lower[..., 1], lower[..., 2]
    muddy = (h >= 18) & (h <= 52) & (s >= 0.18) & (s <= 0.8) & (v >= 0.22) & (v <= 0.8)
    frac = float(muddy.mean())
    # Confidence grows with distance from the class boundaries.
    if frac < 0.035:
        status, depth, conf = "Normal", 0.0, 0.75 if frac < 0.02 else 0.6
    elif frac < 0.11:
        status, depth, conf = "Rising", 0.0, 0.6
    elif frac < 0.26:
        status, depth, conf = "Overflowing", round(2 + (frac - 0.11) * 40, 0), 0.65
    else:
        status, depth, conf = "Road Flooded", round(min(80, 15 + (frac - 0.26) * 60), 0), min(0.9, 0.6 + (frac - 0.26))
    return {
        "status": status, "depth_cm": depth, "confidence": round(conf, 2),
        "observations": f"Offline colour check: about {frac:.0%} of the lower frame looks like muddy flood water.",
        "depth_references": [], "is_drain_or_road_scene": True,
        "engine": "offline heuristic", "muddy_fraction": round(frac, 3),
    }


def _prepare(image_b64: str):
    raw = base64.b64decode(image_b64.split(",", 1)[-1])
    img = Image.open(io.BytesIO(raw))
    img.load()
    rgb = img.convert("RGB")
    # Keep requests small: the long edge at most 1568 px, sent as JPEG.
    scale = min(1.0, 1568 / max(rgb.size))
    if scale < 1.0:
        rgb = rgb.resize((int(rgb.width * scale), int(rgb.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    rgb.save(buf, "JPEG", quality=88)
    return rgb, base64.b64encode(buf.getvalue()).decode("ascii")


def analyze(image_b64: str, hotspot: dict) -> dict:
    img, jpeg_b64 = _prepare(image_b64)
    if llm.status()["enabled"]:
        try:
            return llm.classify_cctv(jpeg_b64, "image/jpeg", hotspot["cctv"], hotspot["name"])
        except llm.LLMError as e:
            out = heuristic_classify(img)
            out["engine"] = "offline heuristic"
            out["llm_error"] = str(e)
            return out
    return heuristic_classify(img)


# ─── Sample frames ────────────────────────────────────────────────────────
SAMPLES = [
    ("normal", "Normal", "Drain at normal level"),
    ("rising", "Rising", "Drain running high"),
    ("overflowing", "Overflowing", "Drain overflowing onto road"),
    ("flooded", "Road Flooded", "Road flooded"),
]

WATER = (118, 96, 62)
WATER_LIGHT = (150, 126, 86)


def _font(size):
    for name in ("consola.ttf", "DejaVuSansMono.ttf", "cour.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _frame(kind: str, seed: int) -> Image.Image:
    W, H = 960, 540
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    hz = 200   # horizon

    for y in range(hz):   # overcast sky
        c = int(150 + 40 * y / hz)
        d.line([(0, y), (W, y)], fill=(c - 10, c - 4, c + 4))
    x = 0
    while x < W:   # shophouses on the horizon
        w = int(rng.integers(70, 140)); h = int(rng.integers(40, 95))
        tone = int(rng.integers(120, 175))
        d.rectangle([x, hz - h, x + w, hz], fill=(tone, tone - 6, tone - 14))
        for wy in range(hz - h + 10, hz - 8, 16):
            for wx in range(x + 8, x + w - 10, 18):
                d.rectangle([wx, wy, wx + 8, wy + 7], fill=(tone - 45, tone - 40, tone - 30))
        x += w + int(rng.integers(0, 12))

    d.rectangle([0, hz, W, H], fill=(92, 108, 74))                           # verge
    vp = (575, hz)
    road = [(250, H), (W, H), (_lerp((W, H), vp, 0.97)), (_lerp((250, H), vp, 0.97))]
    wet = kind in ("overflowing", "flooded")
    d.polygon(road, fill=(70, 72, 76) if wet else (96, 98, 102))
    for i in range(10):   # lane markings
        t0, t1 = i / 10, i / 10 + 0.045
        a, b = _lerp((610, H), vp, t0), _lerp((610, H), vp, t1)
        d.line([a, b], fill=(205, 205, 190), width=max(1, int(9 * (1 - t0))))
    kerb_outer = [(205, H), (250, H), _lerp((250, H), vp, 0.97), _lerp((205, H), vp, 0.97)]
    d.polygon(kerb_outer, fill=(178, 176, 168))
    drain_l, drain_r = (30, H), (205, H)
    drain = [drain_l, drain_r, _lerp(drain_r, vp, 0.97), _lerp(drain_l, vp, 0.97)]
    d.polygon(drain, fill=(58, 60, 58))
    inner_l, inner_r = (62, H), (178, H)
    d.polygon([inner_l, inner_r, _lerp(inner_r, vp, 0.97), _lerp(inner_l, vp, 0.97)], fill=(40, 42, 42))

    water_level = {"normal": 0.18, "rising": 0.82, "overflowing": 1.0, "flooded": 1.0}[kind]
    cx_l = lambda t: _lerp(inner_l, vp, t)  # noqa: E731
    cx_r = lambda t: _lerp(inner_r, vp, t)  # noqa: E731
    # Water in the channel: a band centred in the drain whose width tracks the level.
    poly_l, poly_r = [], []
    for k in range(21):
        t = 0.97 * k / 20
        l, r = cx_l(t), cx_r(t)
        mid = (l[0] + r[0]) / 2
        half = (r[0] - l[0]) / 2 * water_level
        poly_l.append((mid - half, l[1])); poly_r.append((mid + half, r[1]))
    d.polygon(poly_l + poly_r[::-1], fill=WATER)
    for k in range(18):   # flow streaks
        t = rng.uniform(0, 0.9); l, r = cx_l(t), cx_r(t)
        mid = (l[0] + r[0]) / 2; half = (r[0] - l[0]) / 2 * water_level * 0.8
        xx = mid + rng.uniform(-half, half)
        d.line([(xx, l[1]), (xx + rng.uniform(-6, 6), l[1] - 14 * (1 - t))], fill=WATER_LIGHT, width=2)

    if kind == "overflowing":
        pts = []
        for k in range(26):   # spill fanning onto the road edge
            t = 0.95 * k / 25
            a = _lerp((205, H), vp, t)
            pts.append((a[0] + (1 - t) * (90 + 40 * math.sin(k * 1.3)), a[1]))
        d.polygon([_lerp(drain_l, vp, 0.0)] + pts + [_lerp((205, H), vp, 0.95), _lerp(drain_l, vp, 0.95)], fill=WATER)
    if kind == "flooded":
        d.polygon([(0, H), (W, H), (W, hz + 70), (0, hz + 45)], fill=WATER)
        for k in range(60):
            y = int(rng.uniform(hz + 55, H)); x0 = rng.uniform(0, W)
            ln = rng.uniform(20, 90) * (y - hz) / (H - hz)
            d.line([(x0, y), (x0 + ln, y)], fill=WATER_LIGHT, width=2)
        # Half-submerged car and a depth gauge.
        d.rounded_rectangle([640, 300, 820, 368], radius=18, fill=(150, 30, 34))
        d.rounded_rectangle([668, 262, 790, 306], radius=14, fill=(120, 24, 28))
        d.rectangle([684, 270, 728, 300], fill=(150, 170, 182)); d.rectangle([736, 270, 778, 300], fill=(150, 170, 182))
        d.polygon([(600, 345), (860, 352), (860, 372), (600, 368)], fill=WATER)
        d.rectangle([420, 230, 428, 420], fill=(210, 210, 210))
        for k, y in enumerate(range(300, 420, 16)):
            d.rectangle([420, y, 428, y + 8], fill=(200, 40, 40) if k % 2 == 0 else (235, 235, 235))
        d.polygon([(380, 395), (470, 395), (470, 420), (380, 420)], fill=WATER)

    d.rectangle([880, 140, 892, 330], fill=(120, 124, 128))   # lamp post
    d.line([(886, 145), (840, 128)], fill=(120, 124, 128), width=6)

    # CCTV look: soften, desaturate, noise, vignette, overlay text.
    img = img.filter(ImageFilter.GaussianBlur(1.1))
    arr = np.asarray(img, dtype=float)
    gray = arr.mean(axis=2, keepdims=True)
    arr = gray + (arr - gray) * 0.72
    arr += rng.normal(0, 6, arr.shape)
    yy, xx = np.mgrid[0:H, 0:W]
    vig = 1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
    arr = np.clip(arr * vig[..., None], 0, 255).astype(np.uint8)
    img = Image.fromarray(arr)
    d = ImageDraw.Draw(img)
    f = _font(20)
    d.rectangle([0, 0, W, 30], fill=(0, 0, 0))
    d.text((10, 5), f"MSCCC DEMO CAM   SAMPLE FRAME: {kind.upper()}", fill=(235, 235, 235), font=f)
    d.text((W - 210, H - 30), "SYNTHETIC IMAGE", fill=(240, 240, 240), font=f)
    return img


def ensure_samples():
    out = []
    for i, (key, status, label) in enumerate(SAMPLES):
        path = CCTV_DIR / f"sample-{key}.jpg"
        if not path.exists():
            _frame(key, seed=100 + i).save(path, "JPEG", quality=86)
        out.append({"key": key, "label": label, "expected": status, "url": f"/api/static/cctv/{path.name}"})
    return out


if __name__ == "__main__":
    for s in ensure_samples():
        img = Image.open(CCTV_DIR / s["url"].rsplit("/", 1)[-1])
        print(s["key"], heuristic_classify(img))
