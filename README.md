# Miri FloodSense

A working prototype of a predictive flood early-warning platform for the Miri Smart City Command Centre (MSCCC). It forecasts flooding 1, 3 and 6 hours ahead at six hotspots, explains the cause, checks CCTV frames and drafts bilingual Miri CARES alerts for an operator to approve.

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

To serve everything from one port, run `npm run build` and then `npm run server`, and open http://localhost:8000.

### Enable Claude (optional)

Create `server/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
# FLOODSENSE_LLM_MODEL=claude-opus-5-5   (default)
# FLOODSENSE_LLM=off                     (force offline mode)
```

With a key, CCTV frames are classified by Claude vision and alerts and checklists are drafted by Claude. Without one, the app uses offline fallbacks: a colour heuristic for CCTV and templates for alerts. Each result shows which engine produced it.

## Demo script

| What to show | How |
|---|---|
| A storm at high tide raises Pujut Adong to **Danger 3 h ahead**, cause **Tidal Backflow** | Command Dashboard → **Storm drill**. The clock jumps to 2 h before a ~2.45 m high tide with a 40 mm/hr storm. Pujut Adong shows +1 h Normal and +3 h Danger (about 85%). Press play to watch the road flood about 3 h later. |
| Sliders update all hotspots live | **Scenario Simulator**. Start from the "Storm at high tide" preset, then move rainfall (0–120 mm/hr), tide (0–3 m), duration and timing. All six hotspots re-forecast as you drag (in under a second). |
| An uploaded flood image is classified and raises risk | Open a hotspot (for example Pujut Adong) → **CCTV water-level check**. Upload a photo or pick the "flooded" sample frame. It shows the status, the depth and the before/after risk. |
| A bilingual alert and checklist are drafted for approval | Drafts are created automatically when a hotspot reaches Warning (the drill does this). You can also use **Draft alert** on a hotspot or **Draft alerts** in the simulator. In the **Alert Centre**, edit the EN/BM text (300 characters combined), tick the checklist and approve or reject. |
| The model would have warned earlier in a real event | **Model** page → event catalogue → **Replay** (or **Replay 2025 flood** on the dashboard). |

The feed controls in the dashboard header are play/pause, step one hour, speed, **Storm drill** and **Replay 2025 flood**. After a drill or replay, **Back to live** restarts the simulated feed at the current time.

## How it works

**Forecasting.** One gradient-boosting classifier per horizon (scikit-learn `HistGradientBoostingClassifier`) predicts "flooding (road water ≥ 10 cm) within the next h hours". It uses 13 features per hotspot:

- rain over the last 1 h, 3 h and 6 h
- forecast rain for the next 3 h and 6 h
- tide now, the next high tide and the time until it
- Miri River level
- Smart Drain fill and its rate of change
- elevation and past flood count

Monotonic constraints keep forecast rain, tide and drain fill from lowering the risk. Training uses the historical series plus 1,500 design-storm episodes, and the last year is held out for testing.

Levels are Normal < 25% ≤ Watch < 50% ≤ Warning < 75% ≤ Danger.

**Results on the held-out year** (the Model page shows the current numbers):

| Measure | AI forecast | Reactive rule (drain ≥ 90%) |
|---|---|---|
| PR-AUC (+3 h) | about 0.93 | — |
| Flood onsets warned in advance | 30 of 31 | 22 of 31 |
| Mean warning lead time | about 3.1 h | about 1.6 h |
| False alarms per month | 2.2 | 1.3 |

**Cause.** Rules taken from the brief classify the mechanism:

- **Tidal Backflow:** high tide ≥ 2.0 m within the horizon, drain projected above 80%, and a tidal outfall.
- **River Overflow:** Miri River ≥ 2.8 m at a river-side site.
- **Combined:** both of the above, or tidal conditions with intense rain.
- **Rainfall Overload:** anything else.

An exact Shapley breakdown over five driver groups (rain now, forecast rain, tide, river, drain) gives the plain-English drivers. What-if checks then show how the risk would change at low tide, with a normal river or with no forecast rain.

**CCTV.** The CCTV reading (Normal / Rising / Overflowing / Road Flooded, plus depth) is fused into the forecast with a Bayesian odds update weighted by confidence, and lasts 30 minutes.

**Alerts.** Alert drafts are never sent automatically. An operator approves each one, and approval checks the 300-character limit.

## Project layout

```
server/                    FastAPI backend (Python)
  main.py                  API endpoints; serves build/ when present
  config.py                hotspots, features, levels
  physics.py               synthetic tide, river, drain and ponding model
  generate_data.py         2-year history, flood events, tide table
  features.py, model.py    features, training, metrics, explanations
  scenario.py              what-if simulator episodes
  live.py                  simulated live feed, storm drill, event replay
  cctv.py, llm.py          CCTV analysis and Claude calls (with offline fallbacks)
  alerts.py                alert drafts and approval
  data/, artifacts/        generated data and trained models (re-created if deleted)
src/                       React UI (Create React App, Tailwind, Chart.js, React-Leaflet)
  pages/                   Dashboard, Hotspots, HotspotDetail, Simulator, AlertCentre, ModelPage
  components/flood/        risk map, forecast cells, cause panel, CCTV check, feed controls
  data/DataProvider.js     polls /api/live and /api/alerts
  theme/                   the template's colours and component styles, unchanged (FloodSense-only
                           classes are appended at the end of components.css)
```

The UI is built on the dashboard template that was already in this folder and keeps its theme: colours, buttons, cards and chart styles all come from `src/theme/theme.css`. Flood levels use the template's status colours (Normal = success, Watch = info, Warning = warning, Danger = danger). Its unused example pages (`Charts`, `Tables`, `ListDetail`, `MapPage`) and `sampleData.js` are still in `src/` but are not routed.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | status, LLM mode, model version |
| GET | `/api/live` | live snapshot: sensors, forecasts, causes, events |
| GET | `/api/live/history/{id}?hours=36` | recent readings and forecasts for one hotspot |
| POST | `/api/live/control` | `play`, `pause`, `step`, `speed`, `reset`, `drill`, `replay` |
| POST | `/api/simulate` | what-if scenario (`rain_mmhr`, `duration_h`, `tide_m`, `hours_to_high`, `antecedent_mm`) |
| POST | `/api/simulate/draft` | exercise alert drafts for a scenario |
| POST | `/api/cctv/analyze` | classify a frame (`hotspot_id`, `image_base64`) and apply it |
| GET, POST, PATCH | `/api/alerts…` | list, draft, edit, approve and reject alerts |
| GET | `/api/model` | metrics, feature importance, event catalogue |

## Limits of this prototype

- The data is synthetic, and the hydraulic parameters are illustrative rather than calibrated to Miri's drainage network.
- No real alerts are sent: "approve" records the decision and shows the Miri CARES preview.
- The alert history is stored in `server/data/alerts.json`, and the live feed is held in memory.
