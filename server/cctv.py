"""CCTV water-level check: offline classifier and risk fusion.

With an Anthropic API key, frames are classified by Claude vision (llm.py).
Without one, a heuristic reads the flood depth staff when one is in view and
estimates how much of the frame is muddy flood water. It is only a stand-in
for demos and is labelled as such.
"""
import base64
import io

import numpy as np
from PIL import Image

from . import llm

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
GAUGE_CM = 100      # flood gauge staff: 1 m in 10 cm bands, red on the odd decimetres, red at the top
RISING_FRAC = 0.03  # muddy share of the lower frame that means the drain is running near the rim


def muddy_fraction(img: Image.Image) -> float:
    """Share of muddy-water pixels in the lower part of the frame."""
    small = img.convert("RGB").resize((240, 135))
    hsv = np.asarray(small.convert("HSV"), dtype=float) / 255.0
    lower = hsv[int(135 * 0.35):int(135 * 0.92)]
    h, s, v = lower[..., 0] * 360, lower[..., 1], lower[..., 2]
    muddy = (h >= 18) & (h <= 52) & (s >= 0.18) & (s <= 0.8) & (v >= 0.15) & (v <= 0.85)
    return float(muddy.mean())


def _runs(labels):
    """Run-length encode a 1-D label array: [(label, start, length)]."""
    starts = np.concatenate(([0], np.flatnonzero(np.diff(labels)) + 1))
    lengths = np.diff(np.concatenate((starts, [len(labels)])))
    return [(int(labels[s]), int(s), int(n)) for s, n in zip(starts, lengths)]


def _staff_profile(col):
    """Bands down one staff profile (0 other, 1 red, 2 white): (bands, pitch, top) or None.

    bands are (start, length) runs alternating red and white from the red top
    band down to where neither colour continues (water or road).
    """
    runs = _runs(col)
    reds = [n for lab, _, n in runs if lab == 1 and n >= 3]
    if len(reds) < 2:
        return None
    band = float(np.median(reds))
    # Absorb blips shorter than half a band (blurred band edges, rain streaks).
    merged = []
    for lab, st, n in runs:
        if merged and (n < band * 0.45 or lab == merged[-1][0]):
            plab, pst, pn = merged[-1]
            merged[-1] = (plab, pst, pn + n)
        else:
            merged.append((lab, st, n))
    best = None
    for i0, (lab0, _, n0) in enumerate(merged):
        if lab0 != 1 or n0 < band * 0.6:
            continue
        bands = []
        for lab, st, n in merged[i0:]:
            if lab == 0:
                break
            bands.append((st, n))
        if len(bands) < 2 or (best and len(bands) <= len(best[0])):
            continue
        # Pitch and top from a line through the band tops. Each top is above the
        # water whenever any of its band shows, and a colour threshold that
        # shrinks red bands moves red and white tops opposite ways, so the fit
        # cancels it.
        tops = np.array([st for st, _ in bands], dtype=float)
        if len(bands) >= 3:
            pitch, top = np.polyfit(np.arange(len(bands)), tops, 1)
        else:
            pitch, top = tops[1] - tops[0], tops[0]
        full = bands[:-1]   # every band but the last is whole
        if pitch >= 3 and all(0.55 * pitch <= n <= 1.6 * pitch for _, n in full):
            best = (bands, float(pitch), float(top))
    return best


def read_gauge(img: Image.Image):
    """Read a red-and-white flood depth staff if one is in view.

    Every column with repeated red runs is read for alternating red and white
    bands. The staff is the widest group of neighbouring columns whose bands
    start at the same height, so a red car, a sign or a diagonally striped
    barrier is not mistaken for it. The visible length over the band pitch
    gives the height above the water.
    Returns {"depth_cm", "visible_cm", "band_px", "x"} or None.
    """
    im = img.convert("RGB")
    if im.width > 1600:   # keep the staff's resolution; only shrink very large photos
        im = im.resize((1600, round(im.height * 1600 / im.width)))
    rgb = np.asarray(im, dtype=np.int16)
    H, W, _ = rgb.shape
    y0, y1 = int(H * 0.12), int(H * 0.94)          # skip the burned-in camera text
    r, g, b = rgb[y0:y1, :, 0], rgb[y0:y1, :, 1], rgb[y0:y1, :, 2]
    # Colour ratios rather than fixed levels, so a dim morning or a lamp-lit staff still reads.
    red = (r > 60) & (r > 2 * g) & (r > 1.6 * b) & (r - g > 40)
    white = (r > 110) & (g > 110) & (b > 100) & (np.abs(r - g) < 40) & (np.abs(g - b) < 40)

    # Red runs at least 3 px tall, counted per column.
    red3 = red[:-2] & red[1:-1] & red[2:]
    starts = (red3[1:] & ~red3[:-1]).sum(axis=0) + red3[0]
    cols = []   # (x, top, n_bands, visible_cm, pitch, clean) per column that reads as a staff
    for x in np.flatnonzero(starts >= 2):
        sr, sw = red[:, max(0, x - 1):x + 2], white[:, max(0, x - 1):x + 2]
        n_red, n_white = sr.sum(axis=1), sw.sum(axis=1)
        n_other = sr.shape[1] - n_red - n_white
        col = np.select([(n_red >= n_white) & (n_red > n_other), n_white > n_other], [1, 2], 0).astype(np.int8)
        found = _staff_profile(col)
        if found:
            bands, pitch, top = found
            # A band is never longer than the pitch: anything more is a glint or
            # the staff's reflection on the water just below it.
            last = bands[-1][1]
            visible = 10.0 * (bands[-1][0] + min(last, pitch) - top) / pitch
            cols.append((int(x), bands[0][0], len(bands), visible, pitch, last <= 1.15 * pitch))
    # Group neighbouring columns (gaps of one allowed) whose top band starts within 2 px.
    groups = []
    for c in cols:
        g = groups[-1] if groups else None
        if g and c[0] - g[-1][0] <= 2 and abs(c[1] - g[0][1]) <= 2:
            g.append(c)
        else:
            groups.append([c])
    if not groups:
        return None
    staff = max(groups, key=lambda g: (len(g), max(c[2] for c in g)))
    if len(staff) < 3:
        return None
    n_max = max(c[2] for c in staff)
    core = [c for c in staff if c[2] == n_max]   # edge columns blur into the background
    core = [c for c in core if c[5]] or core      # columns without a glint at the waterline
    visible = min(float(GAUGE_CM), float(np.median([c[3] for c in core])))
    pitch = float(np.median([c[4] for c in core]))
    if visible < 15:   # too little staff to trust
        return None
    depth = max(0.0, GAUGE_CM - visible)
    if depth < 3:   # within the reading error of a band edge
        depth = 0.0
    x = (staff[0][0] + staff[-1][0]) // 2
    return {"depth_cm": round(depth), "visible_cm": round(visible), "band_px": round(pitch, 1), "x": x}


def heuristic_classify(img: Image.Image) -> dict:
    """Offline stand-in for the vision model.

    With a flood gauge staff in view, the depth is read from the staff. Without
    one (most uploaded photos), the share of muddy-water pixels decides.
    """
    frac = muddy_fraction(img)
    gauge = read_gauge(img)
    if gauge:
        depth = gauge["depth_cm"]
        if depth >= 10:
            status, conf = "Road Flooded", 0.85
        elif depth >= 1:
            status, conf = "Overflowing", 0.75
        elif frac >= RISING_FRAC:
            status, conf = "Rising", 0.65
        else:
            status, conf = "Normal", 0.75
        observations = (
            f"Offline image check: the flood gauge staff shows about {gauge['visible_cm']} cm above the water, "
            f"so about {depth} cm of water at the road edge. About {frac:.0%} of the lower frame looks like muddy water."
            if depth else
            f"Offline image check: the whole flood gauge staff is clear of the water. About {frac:.0%} of the lower "
            "frame looks like muddy water" + (", so the drain is running near its rim." if frac >= RISING_FRAC else ".")
        )
        return {
            "status": status, "depth_cm": float(depth), "confidence": conf, "observations": observations,
            "depth_references": ["flood gauge staff (10 cm bands)"], "is_drain_or_road_scene": True,
            "engine": "offline heuristic", "muddy_fraction": round(frac, 3), "gauge": gauge,
        }
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
        "observations": f"Offline colour check: about {frac:.0%} of the lower frame looks like muddy flood water (no depth gauge in view).",
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


if __name__ == "__main__":
    import sys
    for path in sys.argv[1:]:
        print(path, heuristic_classify(Image.open(path)))
