"""Situation report (SITREP) for shift handover and the District Disaster Management Committee.

Built only from the live snapshot and the alert store, so every number in it is
one the dashboard is showing at the same moment.
"""
import pandas as pd

from .config import HOTSPOT_BY_ID, LEVEL_RANK


def _pct(p):
    return f"{int(p * 100 + 1e-9)}%"


def _hhmm(iso):
    return pd.Timestamp(iso).strftime("%H:%M") if iso else "–"


def _day(iso):
    return pd.Timestamp(iso).strftime("%d %b %Y %H:%M") if iso else "–"


def build(snap: dict, alerts: list, operator: str, generated_at: str) -> str:
    c = snap["city"]
    mode = {"live": "Live feed", "drill": "STORM DRILL (exercise)", "replay": "EVENT REPLAY (exercise)"}[snap["source"]]
    hs = sorted(snap["hotspots"], key=lambda h: (-LEVEL_RANK[h["assessment"]["level"]], -h["assessment"]["probs"]["6h"]))
    counts = {lvl: sum(1 for h in hs if h["assessment"]["level"] == lvl) for lvl in ("Danger", "Warning", "Watch", "Normal")}
    lines = [
        "# MSCCC Flood Situation Report",
        "",
        f"- **Sensor time:** {_day(snap['sim_time'])} MYT ({mode})",
        f"- **Generated:** {_day(generated_at)} MYT by {operator}",
        f"- **Status:** {counts['Danger']} Danger, {counts['Warning']} Warning, {counts['Watch']} Watch, "
        f"{counts['Normal']} Normal; {c['flooding_now']} hotspot(s) flooded now",
        "",
        "## Conditions",
        "",
        f"- Rain: {c['rain_mmhr']} mm/h average across hotspots (highest {c['rain_max_mmhr']} mm/h); "
        f"up to {c['rain_fcst_3h_max']:.0f} mm forecast in the next 3 h",
        f"- Tide: {c['tide_m']} m and {c['tide_trend']}"
        + (f"; next high {c['next_high']['height_m']} m at {_hhmm(c['next_high']['time'])}"
           + (f" (includes {c['next_high']['surge_m']} m storm surge)" if c['next_high']['surge_m'] else "")
           if c["next_high"] else ""),
        f"- Miri River: {c['river_m']} m ({c['river_trend']:+.2f} m in the last hour; alert level {c['river_alert_m']} m)",
        f"- Highest Smart Drain: {c['max_drain_pct']:.0f}% at {HOTSPOT_BY_ID[c['max_drain_hotspot']]['name']}",
        "",
        "## Hotspots",
        "",
        "| Hotspot | Level | +1 h | +3 h | +6 h | Drain | Road water | Cause |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for h in hs:
        a, s = h["assessment"], h["sensors"]
        p = a["probs"]
        lines.append(f"| {h['name']} | {a['level']}{' (flooding now)' if a['flooding_now'] else ''} | "
                     f"{_pct(p['1h'])} | {_pct(p['3h'])} | {_pct(p['6h'])} | {s['drain_pct']:.0f}% | "
                     f"{int(s['water_depth_cm'])} cm | {a['mechanism'] or '–'} |")
    lines += ["", "## Assessment", ""]
    for h in hs:
        if LEVEL_RANK[h["assessment"]["level"]] >= 1:
            lines.append(f"- **{h['name']}:** {h['assessment']['headline']}")
    if all(LEVEL_RANK[h["assessment"]["level"]] == 0 for h in hs):
        lines.append("- All hotspots at Normal for the next 6 hours.")

    inc = snap["incidents"]
    lines += ["", "## Incidents", ""]
    if not inc["open"] and not inc["closed"]:
        lines.append("- None in this session.")
    for i in inc["open"]:
        lines.append(f"- **{i['id']} {i['hotspot_name']}** (open since {_hhmm(i['opened'])}): {i['mechanism']}, "
                     f"peak {i['peak_level']}, {i['flooded_hours']} h flooded, peak water {i['peak_depth_cm']:.0f} cm")
    for i in inc["closed"][:5]:
        lines.append(f"- {i['id']} {i['hotspot_name']} (closed {_hhmm(i['closed'])}): {i['mechanism']}, "
                     f"peak {i['peak_level']}, {i['flooded_hours']} h flooded")

    r = snap["response"]
    deployed = [p for p in r["pumps"] if p["hotspot_id"]]
    lines += ["", "## Resources", ""]
    lines.append(f"- Mobile pumps: {len(deployed)} of {len(r['pumps'])} deployed"
                 + (": " + ", ".join(f"{p['unit']} at {HOTSPOT_BY_ID[p['hotspot_id']]['name']}" for p in deployed) if deployed else ""))
    lines.append("- Roads closed: " + (", ".join(f"{HOTSPOT_BY_ID[k]['name']} ({', '.join(v['roads'])})"
                                               for k, v in r["roads_closed"].items()) or "none"))
    lines.append("- Relief centres open: " + (", ".join(HOTSPOT_BY_ID[k]["relief_centre"] for k in r["relief_open"]) or "none"))

    source = snap["source"]
    mine = [a for a in alerts if a["source"] == source]
    pending = [a for a in mine if a["status"] in ("drafting", "pending")]
    done = [a for a in mine if a["status"] in ("sent", "approved")]
    lines += ["", "## Alerts", ""]
    lines.append(f"- Awaiting approval: {len(pending)}" + (" (" + ", ".join(f"{a['id']} {a['hotspot_name']} {a['level']}" for a in pending) + ")" if pending else ""))
    lines.append(f"- {'Approved (exercise)' if source != 'live' else 'Sent to Miri CARES'}: {len(done)}"
                 + (" (" + ", ".join(f"{a['id']} {a['hotspot_name']} at {_hhmm(a['decided_at'])}" for a in done[:6]) + ")" if done else ""))
    open_actions = [(a, item) for a in done + pending for item in a.get("checklist", []) if not item.get("done")]
    if open_actions:
        lines += ["", "## Open actions", ""]
        for a, item in open_actions[:12]:
            lines.append(f"- [ ] {item['action']} ({item['owner']}, {item['timing']}) [{a['hotspot_name']}, {a['id']}]")
    lines += ["", "---", "Synthetic prototype data. Forecasts are probabilities of road water of 10 cm or more within each horizon."]
    return "\n".join(lines)
