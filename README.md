# Miri FloodSense

A working prototype of a predictive flood early-warning platform for the Miri Smart City Command Centre (MSCCC). It forecasts flooding 1, 3 and 6 hours ahead at six hotspots, explains the cause, checks CCTV frames and drafts bilingual Miri CARES alerts for an operator to approve. A digital twin runs the hydraulic model 6 hours ahead, and response actions (mobile pumps, road closures, relief centres) are tracked per incident and fed back into it. A one-click situation report covers shift handover.

All sensor data is **synthetic**: two years of hourly readings from a simple hydraulic model, with 16 planted flood events (including a major event in January 2025). Hotspot coordinates come from OpenStreetMap and are approximate.

## Quick start

You need Python 3.10+ and Node 18+.

```bash
pip install -r server/requirements.txt
npm install

npm run server     # API on http://localhost:8000
npm start          # UI on http://localhost:3000 (proxies /api to :8000)
```

On the first start the server generates the data and trains the models, which takes about 3 minutes. To do this ahead of time, run `npm run train`.

To serve everything from one port, run `npm run build` and then `npm run server`, and open http://localhost:8000. `npm run build` points the UI at the deployed API (`.env.production`); for a local build, first create `.env.production.local` containing `REACT_APP_API_URL=` (empty).

### Deploy

The server deployment (mcc-flood.astrikos.xyz, ports 3347 / 4347) is in [DEPLOY.md](DEPLOY.md).

### Enable Claude (optional)

Create `server/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
# FLOODSENSE_LLM_MODEL=claude-opus-5-5   (default)
# FLOODSENSE_LLM=off                     (force offline mode)
```

With a key, CCTV frames are classified by Claude vision and alerts and checklists are drafted by Claude. Without one, the app uses offline fallbacks: a flood-gauge reader and colour heuristic for CCTV, and templates for alerts. Each result shows which engine produced it.

## Demo script

| What to show | How |
|---|---|
| A storm at high tide raises Pujut Adong to **Danger 3 h ahead**, cause **Tidal Backflow** | Command Dashboard → **Storm drill**. The clock jumps to 2 h before a ~2.45 m high tide with a 40 mm/hr storm. Pujut Adong shows +1 h Normal and +3 h Danger (about 86%). The drill plays at one sensor-hour per 20 s; the road floods about 3 h later. Drafts and actions during a drill are tagged as exercises. |
| The digital twin shows why, and what a pump would do | **Digital Twin**. Each hotspot is a 3D street model driven by the twin: road water, Smart Drain fill, the outfall flap gate closing against the tide or river, the receiving water, rain, time of day, pumps and road closures. Switch the grid to **CCTV wall** to see every site's street camera. In the inspector, drag to orbit, or switch to **Camera** or **Section** (the to-scale cross-section). Scrub back 24 h or ahead through the 6 h projection. **Deploy** a mobile pump and the projection updates, with "without the pump" and "one more pump" comparisons. |
| Sliders update all hotspots live | **Scenario Simulator**. Start from the "Storm at high tide" preset, then move rainfall (0–120 mm/hr), tide (0–3 m), duration and timing. All six hotspots re-forecast as you drag (in under a second). |
| A camera frame is classified and raises risk | Open a hotspot (for example Pujut Adong) → **CCTV water-level check**. The feed shows the site's live conditions; pick a test condition (for example **Test: Road flooded**) and **Check this frame**, or upload a photo. It shows the status, the depth and the before/after risk. |
| A bilingual alert and checklist are drafted for approval | Drafts are created automatically when a hotspot reaches Warning (the drill does this). You can also use **Draft alert** on a hotspot or **Draft alerts** in the simulator. In the **Alert Centre**, edit the EN/BM text (300 characters combined), tick the checklist and approve or reject. |
| The model would have warned earlier in a real event | **Model** page → event catalogue → **Replay** (or **Replay 2025 flood** on the dashboard). |
| Shift handover | **SITREP** in the header builds a Markdown situation report (conditions, every hotspot, incidents, alerts, response) to copy or download. **AI Briefing** lists each hotspot at Watch or above with its cause, the twin's projection and one-click actions. |

The feed controls in the dashboard header are play/pause, step one hour, speed, **Storm drill** and **Replay 2025 flood**. The live feed runs in **Real time** by default: one sensor reading per hour, in step with the Malaysia (MYT) clock. All times in the app are MYT, whatever the browser's time zone. After a drill or replay, **Back to live** restarts the simulated feed at the current time and brings back any live pumps, closures and relief centres that were set aside.

The app asks for the duty officer's name and role on first open (stored in the browser only). It is used to sign approvals, response actions and the SITREP.

## How it works

**Forecasting.** One gradient-boosting classifier per horizon (scikit-learn `HistGradientBoostingClassifier`) predicts "flooding (road water ≥ 10 cm) within the next h hours". It uses 14 features per hotspot:

- rain over the last 1 h, 3 h and 6 h
- forecast rain for the next 3 h and 6 h
- tide now, the next high tide and the time until it
- Miri River level
- Smart Drain fill and its rate of change
- water on the road now (the Smart Drain's above-rim gauge)
- elevation and past flood count

Monotonic constraints keep forecast rain, tide, drain fill and road water from lowering the risk. Training uses the historical series plus 1,500 design-storm episodes, and the last year is held out for testing.

Levels are Normal < 25% ≤ Watch < 50% ≤ Warning < 75% ≤ Danger, taking the highest of the three horizons. A road that is flooded now (≥ 10 cm on the gauge, or CCTV "Road Flooded" with confidence ≥ 0.6) is always Danger. Probabilities and depths are rounded down for display, so a shown 50% is never really 49.6%.

**Results on the held-out year** (the Model page shows the current numbers):

| Measure | AI forecast | Reactive rule (drain ≥ 90%) |
|---|---|---|
| PR-AUC (+3 h) | 0.976 | — |
| Flood onsets warned in advance (Warning) | 31 of 31 | 22 of 31 |
| Mean warning lead time | 3.1 h | 1.55 h |
| False alarms per month | 1.92 | 1.33 |

The hour-by-hour scores include hours when the road is already flooded, which are easy to call from the road-water reading. The lead time and onsets warned only count the hours before each flood began, so they are the fairer test of early warning.

**Cause.** Rules taken from the brief classify the mechanism:

- **Tidal Backflow:** high tide ≥ 2.0 m within the horizon, drain projected above 80%, and a tidal outfall.
- **River Overflow:** at a river-side site, the Miri River at its 2.8 m alert level, projected to pass it within the horizon, or near it while river is the main driver.
- **Combined:** both of the above, or tidal conditions with extreme rain.
- **Rainfall Overload:** anything else.

Water still standing on the road after the rain keeps the mechanism of the incident that put it there. An exact Shapley breakdown over six driver groups (rain now, forecast rain, tide, river, drain, road water) gives the plain-English drivers. What-if checks then show how the risk would change at low tide, with a normal river or with no forecast rain.

**Digital twin.** The twin is the same hydraulic model that generated the data (`server/physics.py`), run on the live state. For each hotspot it shows drain fill, road water, the share of the outfall blocked by the tide (above the outfall's invert level) or by river backwater, and the discharge capacity left. It projects 6 h ahead with the hourly rain forecast and the predicted tide, including any storm surge. Each mobile pump adds 12 mm/h of discharge that works whatever the tide. The ML forecast and the twin are independent: when they disagree, check CCTV.

**Incidents and response.** An incident opens when a hotspot reaches Warning or its road floods. It closes after 2 sensor-hours back at Normal with a dry road, and the log records the peak level, hours flooded and peak depth. Response actions are four mobile pumps (MP-01 to MP-04), road closures and relief centres. They can be taken from the hotspot page, the twin, the AI Briefing or by ticking the matching item on an alert's checklist. Actions in a drill are exercises and are cleared on **Back to live**. Replays are read-only.

**3D twin and camera feeds.** Each hotspot's street is modelled in three.js to scale against chart datum: a cambered road (shallow water stays in the gutters), 1.2 m U-drains, the outfall culvert and flap gate, and a flood wall or bank on the receiving water. The water levels, gate, rain, sun and street lighting (MYT), pumps and road closures follow the twin's state. The street camera on each site is rendered from the same model and processed to look like CCTV: low-light gain and grain at night, raindrops on the lens, burned-in camera ID and time. Every feed is labelled SIMULATED FEED. The 3D views need WebGL and fall back to a message without it; the cross-section works everywhere.

**CCTV.** The CCTV reading (Normal / Rising / Overflowing / Road Flooded, plus depth) is fused into the forecast with a Bayesian odds update weighted by confidence, and lasts 30 minutes. Each camera has a red-and-white flood depth staff (1 m in 10 cm bands) at the road edge. Claude vision reads it when it is in view. Offline, the heuristic finds the staff by its regular bands, measures how much stands above the water (about ±2 cm on the simulated feeds, day or night), and uses the share of muddy water in the frame to tell Rising from Normal. Photos without a staff fall back to the muddy-water share alone.

**Alerts.** Alert drafts are never sent automatically:

- **Kinds.** A Warning or Danger alert is drafted when a hotspot reaches Warning. A Watch advisory is drafted only on request, and drafting is refused at Normal. An all-clear is drafted when an incident closes after an alert went out.
- **Approval.** An operator approves or rejects each draft, and approval checks the 300-character EN + BM limit.
- **Expiry.** Open drafts expire after 6 sensor-hours without a decision, or when the hotspot is back at Normal with its incident closed. A newer draft for the same hotspot supersedes the older one.
- **Exercises.** Drafts from a drill, replay or the simulator are tagged [EXERCISE] / [LATIHAN], and approving one records it without "sending".

## Project layout

```
server/                    FastAPI backend (Python)
  __main__.py              python -m server: runs the API on $HOST:$PORT (default 127.0.0.1:8000)
  main.py                  API endpoints; serves build/ when present
  config.py                hotspots, features, levels
  physics.py               synthetic tide, river, drain and ponding model
  generate_data.py         2-year history, flood events, tide table
  features.py, model.py    features, training, metrics, explanations
  scenario.py              what-if simulator episodes
  live.py                  simulated live feed (MYT-synced), storm drill, event replay,
                           incidents, response actions, digital twin projection
  cctv.py, llm.py          CCTV analysis and Claude calls (with offline fallbacks)
  alerts.py                alert drafts, approval, expiry and exercise tagging
  sitrep.py                Markdown situation report
  data/, artifacts/        generated data and trained models (re-created if deleted)
src/                       React UI (Create React App, Tailwind, Chart.js, React-Leaflet)
  pages/                   Dashboard, DigitalTwin, Hotspots, HotspotDetail, Simulator, AlertCentre, ModelPage
  components/flood/        risk map, forecast cells, cause panel, CCTV check, feed controls,
                           twin cross-section (TwinSection), response panel
  twin3d/                  three.js street scenes (siteScene), procedural textures, the shared
                           renderer and CCTV look (engine), React views (lazy-loaded)
  components/layout/       header, sidebar, notifications, AI Briefing, SITREP, operator sign-in
  data/DataProvider.js     polls /api/live and /api/alerts; operator session; response actions
  theme/                   theme.css: Astrikos tokens (dark and light), base styles and every
                           component class; ThemeProvider.js: data-theme on <body>
```

The UI follows the Astrikos UI theme specification (v1.0): Lexend Deca for headings and figures, Lato for everything else, graphite surfaces in dark mode (the default) and ink on paper in light mode. Every colour, card, button, table and chart style comes from the token blocks at the top of `src/theme/theme.css`; Tailwind's colour names are mapped onto the same tokens in `tailwind.config.js`. Flood levels use the status colours (Normal = success, Watch = info, Warning = warning, Danger = danger). The 3D street scenes in `src/twin3d` keep their own material colours, since they depict the physical site rather than the interface. The dashboard template's unused example pages (`Charts`, `Tables`, `ListDetail`, `MapPage`) and `sampleData.js` are still in `src/` but are not routed.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | status, LLM mode, model version |
| GET | `/api/hotspots` | hotspot register |
| GET | `/api/live` | live snapshot: sensors, forecasts, causes, incidents, response, events |
| GET | `/api/live/history/{id}?hours=36` | recent readings and forecasts for one hotspot |
| POST | `/api/live/control` | `play`, `pause`, `step`, `speed`, `reset`, `drill`, `replay` |
| GET | `/api/twin` | digital twin: hydraulic state, 6 h projection and pump options per hotspot |
| GET | `/api/twin/history?hours=24` | recorded twin states for the scrubber |
| POST | `/api/respond` | `deploy_pump`, `recall_pump`, `close_roads`, `reopen_roads`, `open_relief`, `close_relief` |
| GET | `/api/sitrep?operator=…` | situation report (Markdown) |
| GET | `/api/tides?days=3` | tide table, including any drill storm surge |
| POST | `/api/simulate` | what-if scenario (`rain_mmhr`, `duration_h`, `tide_m`, `hours_to_high`, `antecedent_mm`) |
| POST | `/api/simulate/draft` | exercise alert drafts for a scenario |
| POST, DELETE | `/api/cctv/analyze`, `/api/cctv/{id}` | classify a frame (`hotspot_id`, `image_base64`) and apply it; clear it |
| GET, POST, PATCH, DELETE | `/api/alerts…` | list, draft, edit (text, checklist), approve, reject and clear alerts |
| GET | `/api/model` | metrics, feature importance, event catalogue |

## Limits of this prototype

- The data is synthetic, and the hydraulic parameters are illustrative rather than calibrated to Miri's drainage network.
- No real alerts are sent: "approve" records the decision and shows the Miri CARES preview.
- The alert history is stored in `server/data/alerts.json` (set `FLOODSENSE_ALERTS` to use another file), and the live feed, incidents and response actions are held in memory.
- Operator sign-in only records a name and role in the browser. There are no accounts or passwords.
- The ML forecast and the digital twin are both built on the same synthetic hydraulics, so they agree more closely here than they would on real data.
- The logo (`public/mcc-logo.svg`) is the crest of Majlis Bandaraya Miri (Miri City Council), taken from Wikimedia Commons ([Seal of Miri.svg](https://commons.wikimedia.org/wiki/File:Seal_of_Miri.svg), public domain) and optimised with svgo. `favicon.ico` and `apple-touch-icon.png` are rendered from it. It is the council's official insignia, so confirm with MCC before using it outside this prototype.
- The camera feeds are rendered from the 3D twin, not real CCTV, and the street models are representative layouts rather than surveys of each site. The offline gauge reader is tuned to the simulated staff; real photos are better handled by Claude vision.
