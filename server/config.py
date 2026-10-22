"""Static configuration: hotspots, paths, risk levels and feature definitions.

Hotspot coordinates come from OpenStreetMap (Nominatim) lookups of the named
areas and are approximate; MCC should confirm the exact sensor locations.
Hydraulic parameters are synthetic and tuned so each hotspot reproduces the
flood mechanisms named in MCC's brief.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
ARTIFACT_DIR = ROOT / "artifacts"
for d in (DATA_DIR, ARTIFACT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Synthetic history: two years of hourly readings ending the day before today.
HISTORY_START = "2024-10-15 00:00"
HISTORY_END = "2026-10-14 23:00"
TEST_START = "2025-10-15 00:00"   # last 12 months held out for evaluation
SEED = 20250129

HORIZONS = [1, 3, 6]
FLOOD_DEPTH_CM = 10.0             # surface water depth counted as "flooded"

# Risk levels on flood probability (from the brief).
LEVELS = [
    ("Normal", 0.0),
    ("Watch", 0.25),
    ("Warning", 0.50),
    ("Danger", 0.75),
]


def level_for(p: float) -> str:
    name = "Normal"
    for lvl, lo in LEVELS:
        if p >= lo:
            name = lvl
    return name


LEVEL_RANK = {name: i for i, (name, _) in enumerate(LEVELS)}

FEATURES = [
    "rain_1h", "rain_3h", "rain_6h", "rain_fcst_3h", "rain_fcst_6h",
    "tide_m", "tide_next_high_m", "hours_to_high_tide",
    "river_m", "drain_pct", "drain_rate", "water_depth_cm",
    "elevation_m", "past_floods",
]

FEATURE_LABELS = {
    "rain_1h": "Rainfall, last 1 h",
    "rain_3h": "Rainfall, last 3 h",
    "rain_6h": "Rainfall, last 6 h",
    "rain_fcst_3h": "Forecast rain, next 3 h",
    "rain_fcst_6h": "Forecast rain, next 6 h",
    "tide_m": "Tide height now",
    "tide_next_high_m": "Next high tide height",
    "hours_to_high_tide": "Time to high tide",
    "river_m": "Miri River level",
    "drain_pct": "Smart Drain level",
    "drain_rate": "Drain level rate of change",
    "water_depth_cm": "Water on the road now",
    "elevation_m": "Hotspot elevation",
    "past_floods": "Past flood count",
}

FEATURE_GROUP = {
    "rain_1h": "Rain", "rain_3h": "Rain", "rain_6h": "Rain",
    "rain_fcst_3h": "Rain", "rain_fcst_6h": "Rain",
    "tide_m": "Tide", "tide_next_high_m": "Tide", "hours_to_high_tide": "Tide",
    "river_m": "River",
    "drain_pct": "Drain", "drain_rate": "Drain",
    "water_depth_cm": "Surface",
    "elevation_m": "Site", "past_floods": "Site",
}

# past_floods  floods in MCC's records before the sensor history starts (model feature)
# capacity  drain discharge capacity (mm/h of rainfall equivalent)
# storage   drain storage before surcharge (mm)
# runoff    share of rainfall reaching the drain this hour; lag = share from the previous hour
# tide_sens how strongly a high tide blocks the outfall (0-1); outfall = tide level (m) where blocking starts
# river_sens / bank  sensitivity to Miri River backflow and the bank level (m) where it overtops
# pond      cm of surface water per mm of drain surcharge (low-lying sites pond faster)
HOTSPOTS = [
    {
        "id": "pujut-adong", "name": "Pujut Adong", "short": "PA",
        "lat": 4.4256, "lng": 114.0231, "pilot": True,
        "elevation_m": 1.6, "past_floods": 12, "population": 9400,
        "area": "Jalan Adong 1 / 2A, Pujut, beside Sungai Miri",
        "roads": ["Jalan Adong 1", "Jalan Adong 2A", "Jalan Pujut Adong"],
        "drain": "Sg. Adong tidal outfall drain", "drain_id": "SD-PA-01",
        "cctv": "CAM-PA-02",
        "relief_centre": "Dewan Masyarakat Pujut (relief centre)",
        "pump_point": "Sg. Adong outfall culvert",
        "known_mechanisms": ["Tidal Backflow", "River Overflow"],
        "rain_mult": 1.05, "capacity": 30, "storage": 70, "runoff": 0.85, "lag": 0.25,
        "tide_sens": 0.90, "outfall": 1.45, "river_sens": 0.75, "bank": 3.10, "pond": 0.40,
    },
    {
        "id": "tanjung-batu", "name": "Tanjung Batu", "short": "TB",
        "lat": 4.4069, "lng": 114.0183, "pilot": True,
        "elevation_m": 1.9, "past_floods": 9, "population": 7100,
        "area": "Jalan Tanjung Batu 4-7, Padang Kerbau",
        "roads": ["Jalan Tanjung Batu 4", "Jalan Tanjung Batu 7"],
        "drain": "Padang Kerbau main drain", "drain_id": "SD-TB-01",
        "cctv": "CAM-TB-01",
        "relief_centre": "Dewan Masyarakat Krokop (relief centre)",
        "pump_point": "Jalan Tanjung Batu 7 sump",
        "known_mechanisms": ["Tidal Backflow", "Low-lying terrain"],
        "rain_mult": 1.00, "capacity": 34, "storage": 70, "runoff": 0.80, "lag": 0.20,
        "tide_sens": 0.80, "outfall": 1.55, "river_sens": 0.55, "bank": 3.20, "pond": 0.35,
    },
    {
        "id": "taman-tunku", "name": "Jalan Dato / Taman Tunku", "short": "TT",
        "lat": 4.3135, "lng": 113.9923, "pilot": True,
        "elevation_m": 2.4, "past_floods": 10, "population": 11800,
        "area": "Taman Tunku and Jalan Dato catchment",
        "roads": ["Jalan Dato", "Jalan Taman Tunku"],
        "drain": "Taman Tunku trunk drain", "drain_id": "SD-TT-02",
        "cctv": "CAM-TT-03",
        "relief_centre": "Dewan Masyarakat Lusut (relief centre)",
        "pump_point": "Taman Tunku trunk drain junction",
        "known_mechanisms": ["Rainfall Overload", "Tidal Backflow"],
        "rain_mult": 1.10, "capacity": 32, "storage": 65, "runoff": 0.85, "lag": 0.25,
        "tide_sens": 0.55, "outfall": 1.70, "river_sens": 0.35, "bank": 3.40, "pond": 0.36,
    },
    {
        "id": "senadin-mcot", "name": "Senadin / MCOT", "short": "SM",
        "lat": 4.5007, "lng": 114.0168, "pilot": False,
        "elevation_m": 3.1, "past_floods": 8, "population": 13500,
        "area": "Senadin commercial area and MCOT",
        "roads": ["Jalan Senadin", "Jalan Kuala Baram Bypass"],
        "drain": "Senadin collector drain", "drain_id": "SD-SM-01",
        "cctv": "CAM-SM-01",
        "relief_centre": "Dewan Senadin (relief centre)",
        "pump_point": "Senadin collector drain",
        "known_mechanisms": ["Rainfall Overload"],
        "rain_mult": 1.15, "capacity": 36, "storage": 60, "runoff": 0.90, "lag": 0.30,
        "tide_sens": 0.35, "outfall": 1.90, "river_sens": 0.20, "bank": 3.60, "pond": 0.33,
    },
    {
        "id": "desa-senadin", "name": "Desa Senadin", "short": "DS",
        "lat": 4.4947, "lng": 114.0349, "pilot": False,
        "elevation_m": 2.8, "past_floods": 7, "population": 6900,
        "area": "Desa Senadin residential estate",
        "roads": ["Jalan Desa Senadin", "Lorong Desa Senadin 2"],
        "drain": "Desa Senadin estate drain", "drain_id": "SD-DS-01",
        "cctv": "CAM-DS-01",
        "relief_centre": "SK Senadin hall (relief centre)",
        "pump_point": "Desa Senadin estate outfall",
        "known_mechanisms": ["Rainfall Overload", "Low-lying terrain"],
        "rain_mult": 1.10, "capacity": 30, "storage": 55, "runoff": 0.85, "lag": 0.30,
        "tide_sens": 0.30, "outfall": 2.00, "river_sens": 0.15, "bank": 3.80, "pond": 0.35,
    },
    {
        "id": "tudan-desaras", "name": "Tudan Desaras", "short": "TD",
        "lat": 4.4735, "lng": 114.0302, "pilot": False,
        "elevation_m": 3.8, "past_floods": 6, "population": 8800,
        "area": "Tudan / Desaras, foot of the Tudan hills",
        "roads": ["Jalan Tudan", "Lorong Desaras 1A"],
        "drain": "Tudan hillside interceptor drain", "drain_id": "SD-TD-01",
        "cctv": "CAM-TD-02",
        "relief_centre": "Dewan Masyarakat Tudan (relief centre)",
        "pump_point": "Lorong Desaras 1A culvert",
        "known_mechanisms": ["Rainfall Overload"],
        "rain_mult": 1.20, "capacity": 38, "storage": 55, "runoff": 0.95, "lag": 0.35,
        "tide_sens": 0.10, "outfall": 2.40, "river_sens": 0.10, "bank": 4.00, "pond": 0.30,
    },
]

# From the drainage asset register: drains with tidal outfalls, and sites the
# Miri River can overtop. The mechanism classifier only names a tidal or river
# cause where one is physically possible.
for _h in HOTSPOTS:
    _h["tidal_outfall"] = _h["tide_sens"] >= 0.5
    _h["river_adjacent"] = _h["river_sens"] >= 0.3

HOTSPOT_BY_ID = {h["id"]: h for h in HOTSPOTS}

# Mobile pump fleet (MCC Engineering). A deployed unit adds discharge at the
# hotspot's pump point, in mm/h of rainfall equivalent over the catchment.
PUMP_UNITS = ["MP-01", "MP-02", "MP-03", "MP-04"]
PUMP_MMHR = 12.0

# Miri River alert level (m) used by the mechanism classifier and the twin.
RIVER_ALERT_M = 2.8
HIGH_TIDE_M = 2.0

PUBLIC_FIELDS = [
    "id", "name", "short", "lat", "lng", "pilot", "elevation_m", "past_floods", "population",
    "area", "roads", "drain", "drain_id", "cctv", "relief_centre", "pump_point", "known_mechanisms",
    "tidal_outfall", "river_adjacent", "bank", "outfall", "capacity", "tide_sens", "river_sens",
]


def public_hotspot(h: dict) -> dict:
    return {k: h[k] for k in PUBLIC_FIELDS}
