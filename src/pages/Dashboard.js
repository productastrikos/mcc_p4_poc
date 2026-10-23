import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Drawer, EmptyState, Loading, PageHeader, ProgressBar } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import RiskMap from '../components/flood/RiskMap';
import FeedControls, { ModeBanner } from '../components/flood/FeedControls';
import { ForecastCells, LevelWithState, MechanismBadge, OfflineBanner, SensorTile } from '../components/flood/bits';
import { useData } from '../data/DataProvider';
import { api } from '../services/api';
import {
  LEVEL_RANK, LEVELS, RIVER_ALERT_M, cm, dayTime, hhmm, levelFor, levelTone, loadTone, pct,
} from '../utils';

function HotspotRow({ h, selected, onSelect, onOpen }) {
  const a = h.assessment;
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => onSelect(h.id)} onDoubleClick={() => onOpen(h.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(h.id)}
      title="Click to select, double-click to open"
      className={`px-4 py-3 border-b last:border-0 cursor-pointer transition-colors ${selected ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-fg truncate">
            {h.name} {h.pilot && <span className="text-[10px] font-bold text-primary align-middle ml-1">PILOT</span>}
          </p>
          <MechanismBadge mechanism={a?.mechanism} depth={a?.water_depth_cm} />
        </div>
        <LevelWithState assessment={a} className="justify-end" />
      </div>
      <div className="flex items-center justify-between gap-3 mt-2">
        <ForecastCells probs={a?.probs} compact />
        <div className="text-right text-[10.5px] text-fg-faint leading-tight">
          <div>Drain <b className="text-fg">{Math.round(h.sensors.drain_pct)}%</b> · water <b className="text-fg">{cm(h.sensors.water_depth_cm)}</b></div>
          <div>Rain <b className="text-fg">{h.sensors.rain_mmhr}</b> mm/h</div>
          {h.response?.pumps?.length > 0 && <div className="text-primary font-semibold">{h.response.pumps.join(', ')} on site</div>}
          {h.cctv_reading && <div className="text-accent font-semibold">CCTV: {h.cctv_reading.status}</div>}
        </div>
      </div>
    </div>
  );
}

/** Rows = hotspots, columns = now / +1h / +3h / +6h, coloured by level. */
function ForecastTimeline({ hotspots, onOpen }) {
  return (
    <Card title="Forecast timeline" subtitle="Probability of road water of 10 cm or more within each horizon. Click a row to open the hotspot." padded={false}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Hotspot</th><th>Drain</th><th>Road water</th><th>+1 h</th><th>+3 h</th><th>+6 h</th><th>Cause</th></tr>
          </thead>
          <tbody>
            {hotspots.map((h) => {
              const a = h.assessment;
              return (
                <tr key={h.id} className="is-clickable" onClick={() => onOpen(h.id)}>
                  <td className="cell-strong whitespace-nowrap">{h.name}</td>
                  <td className="tabular-nums">{Math.round(h.sensors.drain_pct)}%</td>
                  <td className={`tabular-nums ${a?.flooding_now ? 'text-danger font-semibold' : ''}`}>{cm(h.sensors.water_depth_cm)}</td>
                  {['1h', '3h', '6h'].map((k) => {
                    const p = a?.probs?.[k] ?? 0;
                    const l = levelFor(p);
                    return (
                      <td key={k}>
                        <span className={`fc-cell tone-${l.tone}`}>
                          <span className="fc-cell-value">{pct(p)}</span>
                          <span className="fc-cell-label">{l.name.toUpperCase()}</span>
                        </span>
                      </td>
                    );
                  })}
                  <td><MechanismBadge mechanism={a?.mechanism} depth={a?.water_depth_cm} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OpsLog({ events }) {
  const navigate = useNavigate();
  return (
    <ul className="space-y-1">
      {events.slice(0, 30).map((e) => {
        const target = e.alert_id ? `/alerts?id=${e.alert_id}` : e.hotspot_id ? `/hotspots/${e.hotspot_id}` : null;
        const body = (
          <>
            <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: `var(--color-${e.tone})` }} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg leading-snug">{e.title}</p>
              <p className="text-fg-muted leading-snug">{e.message}</p>
              <p className="text-[10px] text-fg-faint mt-0.5 font-mono">sensor {dayTime(e.sim_time)}</p>
            </div>
          </>
        );
        return (
          <li key={e.id}>
            {target
              ? <button type="button" className="ops-entry is-link" onClick={() => navigate(target)} title={e.alert_id ? 'Open alert' : 'Open hotspot'}>{body}</button>
              : <div className="ops-entry">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function Incidents({ incidents, onOpen }) {
  const { open, closed } = incidents;
  if (!open.length && !closed.length) {
    return <EmptyState icon="shield" title="No incidents this session">An incident opens when a hotspot reaches Warning or its road floods. Run a storm drill to see one.</EmptyState>;
  }
  return (
    <div className="space-y-2">
      {open.map((i) => (
        <button key={i.id} type="button" className="tile w-full text-left hover:border-primary" onClick={() => onOpen(i.hotspot_id)}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-fg">{i.id} · {i.hotspot_name}</span>
            <Badge tone={levelTone(i.level)}>{i.level.toUpperCase()}</Badge>
          </div>
          <p className="text-[11px] text-fg-muted mt-1">
            Open since {dayTime(i.opened)} · {i.mechanism} · peak {i.peak_level}
            {i.flooded_hours ? ` · flooded ${i.flooded_hours} h, peak ${i.peak_depth_cm} cm` : ' · no flooding yet'}
          </p>
        </button>
      ))}
      {closed.slice(0, 3).map((i) => (
        <div key={i.id} className="text-[11px] text-fg-faint px-1">
          {i.id} {i.hotspot_name}: closed {dayTime(i.closed)}, peak {i.peak_level}{i.flooded_hours ? `, flooded ${i.flooded_hours} h` : ''}
        </div>
      ))}
    </div>
  );
}

/* ─── Drill-down drawers for the sensor tiles ─────────────────────────── */
function RainDrawer({ live, onClose }) {
  return (
    <Drawer eyebrow="Rainfall" title="Rain by hotspot" subtitle={`Sensor time ${dayTime(live.sim_time)}`} onClose={onClose} width={420}>
      <table className="table">
        <thead><tr><th>Hotspot</th><th>Now</th><th>Last 3 h</th><th>Next 3 h</th><th>Next 6 h</th></tr></thead>
        <tbody>
          {live.hotspots.map((h) => (
            <tr key={h.id}>
              <td className="cell-strong">{h.name}</td>
              <td className="tabular-nums">{h.sensors.rain_mmhr} mm/h</td>
              <td className="tabular-nums">{Math.round(h.sensors.rain_3h)} mm</td>
              <td className="tabular-nums">{Math.round(h.sensors.rain_fcst_3h)} mm</td>
              <td className="tabular-nums">{Math.round(h.sensors.rain_fcst_6h)} mm</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-fg-faint mt-3">Rain gauges at each hotspot; forecasts are the rainfall nowcast for the hotspot's catchment. The dashboard tile shows the average across the six hotspots.</p>
    </Drawer>
  );
}

function TideDrawer({ live, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/api/tides?days=3').then(setRows).catch(() => setRows([])); }, [live.sim_time]);
  const c = live.city;
  return (
    <Drawer eyebrow="Tide" title="Tide table, Miri" subtitle={`Now ${c.tide_m.toFixed(2)} m and ${c.tide_trend} · heights in metres above chart datum`} onClose={onClose} width={420}>
      {!rows && <Loading>Loading the tide table…</Loading>}
      {rows && (
        <table className="table">
          <thead><tr><th>Day</th><th>Time</th><th>Tide</th><th>Height</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.time} className={t.past ? 'opacity-50' : ''}>
                <td>{dayTime(t.time).split(' ').slice(0, 2).join(' ')}</td>
                <td className="font-mono">{hhmm(t.time)}</td>
                <td>{t.type === 'high' ? 'High' : 'Low'}</td>
                <td className="tabular-nums">
                  <span className={t.above_high_tide ? 'text-warning font-semibold' : ''}>{t.height_m.toFixed(2)} m</span>
                  {t.surge_m > 0 && <span className="text-[10px] text-fg-faint"> (+{t.surge_m.toFixed(2)} surge)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-fg-faint mt-3">High tides of 2.0 m or more (amber) can block tidal outfalls at Pujut Adong, Tanjung Batu and Taman Tunku. Faded rows are past.</p>
    </Drawer>
  );
}

function RiverDrawer({ live, hist, onClose }) {
  const riverside = live.hotspots.filter((h) => h.river_adjacent);
  const c = live.city;
  return (
    <Drawer eyebrow="Miri River" title={`${c.river_m.toFixed(2)} m`} subtitle={`${c.river_trend >= 0 ? '+' : ''}${c.river_trend.toFixed(2)} m in the last hour · alert level ${RIVER_ALERT_M} m`} onClose={onClose} width={420}>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-[11px] mb-1"><span className="text-fg-faint">Level against alert level</span><span className="font-semibold text-fg">{Math.round((c.river_m / RIVER_ALERT_M) * 100)}%</span></div>
          <ProgressBar value={c.river_m} max={RIVER_ALERT_M} tone={c.river_m >= RIVER_ALERT_M ? 'danger' : c.river_m >= RIVER_ALERT_M - 0.3 ? 'warning' : 'info'} />
        </div>
        {hist && (
          <ChartCard title="Miri River, last 36 h" subtitle="metres" height={150} xMaxTicks={8}
            data={{ labels: hist.time.map(hhmm), datasets: [{ label: 'Miri River (m)', data: hist.river, color: 'chart-3', fill: false }] }}
            thresholds={[{ value: RIVER_ALERT_M, tone: 'warning', label: 'Alert level', description: `${RIVER_ALERT_M} m` }]} />
        )}
        <table className="table">
          <thead><tr><th>Riverside hotspot</th><th>Bank overtops at</th><th>Margin</th></tr></thead>
          <tbody>
            {riverside.map((h) => {
              const margin = h.bank - c.river_m;
              return (
                <tr key={h.id}>
                  <td className="cell-strong">{h.name}</td>
                  <td className="tabular-nums">{h.bank.toFixed(2)} m</td>
                  <td className={`tabular-nums ${margin < 0 ? 'text-danger font-semibold' : margin < 0.5 ? 'text-warning font-semibold' : ''}`}>
                    {margin < 0 ? `${(-margin).toFixed(2)} m over` : `${margin.toFixed(2)} m`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}

function DrainDrawer({ live, onClose }) {
  const navigate = useNavigate();
  return (
    <Drawer eyebrow="Smart Drains" title="Drain levels" subtitle="% of drain depth; 100% means brim-full or surcharging" onClose={onClose} width={420}
      footer={<Button onClick={() => navigate('/twin')} icon="layers">Open digital twin</Button>}>
      <div className="space-y-3">
        {[...live.hotspots].sort((a, b) => b.sensors.drain_pct - a.sensors.drain_pct).map((h) => (
          <div key={h.id}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-fg font-semibold">{h.name} <span className="text-fg-faint font-normal">{h.drain_id}</span></span>
              <span className="tabular-nums text-fg">{Math.round(h.sensors.drain_pct)}% <span className="text-fg-faint">({h.sensors.drain_rate >= 0 ? '+' : ''}{h.sensors.drain_rate}%/h)</span></span>
            </div>
            <ProgressBar value={h.sensors.drain_pct} tone={loadTone(h.sensors.drain_pct, 60, 80)} />
            {h.sensors.water_depth_cm > 0 && <p className="text-[10.5px] text-danger mt-0.5">{cm(h.sensors.water_depth_cm)} of water above the rim, on the road</p>}
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function RiskDrawer({ live, onClose }) {
  const navigate = useNavigate();
  const list = live.hotspots.filter((h) => LEVEL_RANK[h.assessment.level] >= 2)
    .sort((a, b) => LEVEL_RANK[b.assessment.level] - LEVEL_RANK[a.assessment.level]);
  return (
    <Drawer eyebrow="Warning or above" title={`${list.length} of ${live.hotspots.length} hotspots`} subtitle="Any horizon at 50% or more, or flooding now" onClose={onClose} width={420}>
      {list.length === 0 && <EmptyState icon="check" title="No hotspot at Warning or Danger">All six are below 50% at every horizon. They appear here as soon as one rises.</EmptyState>}
      <div className="space-y-2">
        {list.map((h) => (
          <button key={h.id} type="button" className="tile w-full text-left" onClick={() => navigate(`/hotspots/${h.id}`)}>
            <div className="flex items-center justify-between gap-2 mb-1"><span className="text-xs font-bold text-fg">{h.name}</span><LevelWithState assessment={h.assessment} /></div>
            <p className="text-[11px] text-fg-muted">{h.assessment.headline}</p>
          </button>
        ))}
      </div>
    </Drawer>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { live, online, pendingAlerts } = useData();
  const [selected, setSelected] = useState('pujut-adong');
  const [hist, setHist] = useState(null);
  const [drawer, setDrawer] = useState(null);

  // City conditions chart uses the selected hotspot's sensor history.
  const simTime = live?.sim_time;
  useEffect(() => {
    if (!simTime) return;
    api.get(`/api/live/history/${selected}?hours=36`).then(setHist).catch(() => {});
  }, [simTime, selected]);

  if (!live) return <div className="space-y-4">{!online && <OfflineBanner />}<Loading>Loading the live feed…</Loading></div>;

  const open = (id) => navigate(`/hotspots/${id}`);
  const ranked = [...live.hotspots].sort((a, b) =>
    (LEVEL_RANK[b.assessment?.level] - LEVEL_RANK[a.assessment?.level]) || ((b.assessment?.probs['6h'] || 0) - (a.assessment?.probs['6h'] || 0)));
  const atWarning = live.hotspots.filter((h) => LEVEL_RANK[h.assessment?.level] >= 2).length;
  const c = live.city;
  const labels = hist?.time.map(hhmm) || [];
  const maxDrainName = live.hotspots.find((h) => h.id === c.max_drain_hotspot)?.name;
  const selName = live.hotspots.find((h) => h.id === selected)?.name;

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title="Command Dashboard"
        subtitle="Rain, tide, river, Smart Drain and CCTV fused into one picture, with flood forecasts for the next 6 hours"
        actions={<FeedControls />}
      />
      <ModeBanner />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <SensorTile icon="rain" label="Rain" value={c.rain_mmhr} unit="mm/h" onClick={() => setDrawer('rain')}
          title="Average across the six hotspots. Click for each hotspot."
          sub={c.rain_fcst_3h_max > 0 ? `≤ ${c.rain_fcst_3h_max} mm in next 3 h` : 'None forecast, 3 h'} />
        <SensorTile icon="waves" label="Tide" value={c.tide_m.toFixed(2)} unit="m" onClick={() => setDrawer('tide')}
          sub={`${c.tide_trend === 'rising' ? '▲' : '▼'} ${c.next_high ? `high ${c.next_high.height_m.toFixed(2)} @ ${hhmm(c.next_high.time)}` : c.tide_trend}`} />
        <SensorTile icon="layers" label="Miri River" value={c.river_m.toFixed(2)} unit="m" onClick={() => setDrawer('river')}
          sub={`${c.river_trend >= 0 ? '+' : ''}${c.river_trend.toFixed(2)} m/h · alert ${RIVER_ALERT_M}`}
          tone={c.river_m >= RIVER_ALERT_M ? 'danger' : c.river_m >= RIVER_ALERT_M - 0.3 ? 'warning' : undefined} />
        <SensorTile icon="drop" label="Top drain" value={c.max_drain_pct} unit="%" onClick={() => setDrawer('drain')}
          tone={c.max_drain_pct >= 80 ? 'danger' : c.max_drain_pct >= 60 ? 'warning' : undefined}
          sub={maxDrainName} />
        <SensorTile icon="alert" label="Warning+" value={atWarning} unit={`/ ${live.hotspots.length}`} onClick={() => setDrawer('risk')}
          title="Hotspots at Warning or Danger"
          tone={atWarning ? 'danger' : 'success'} sub={c.flooding_now ? `${c.flooding_now} flooded now` : 'any horizon ≥ 50%'} />
        <SensorTile icon="bell" label="To approve" value={pendingAlerts.length} unit={pendingAlerts.length === 1 ? 'draft' : 'drafts'}
          title="Alert drafts awaiting approval"
          tone={pendingAlerts.length ? 'warning' : undefined} sub="Open Alert Centre" onClick={() => navigate('/alerts')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card overflow-hidden flex flex-col">
          <div className="card-header">
            <div className="flex-1">
              <h3 className="card-title">Flood risk map</h3>
              <p className="card-subtitle">Highest level across +1/+3/+6 h, or Danger when flooding is observed. Click a hotspot for its forecast.</p>
            </div>
            <div className="hidden md:flex items-center gap-3">
              {LEVELS.map((l) => <Badge key={l.name} tone={l.tone} dot plain>{l.name.toUpperCase()}</Badge>)}
            </div>
          </div>
          <div className="relative flex-1" style={{ minHeight: 460 }}>
            <div className="absolute inset-0">
              <RiskMap hotspots={live.hotspots} selectedId={selected} onSelect={setSelected} onOpen={open} height="100%" />
            </div>
          </div>
        </div>
        <Card title="Hotspots" subtitle="Ranked by risk · double-click to open" padded={false}
          actions={<Button size="sm" variant="ghost" onClick={() => open(selected)}>Open {live.hotspots.find((h) => h.id === selected)?.short}</Button>}>
          {ranked.map((h) => <HotspotRow key={h.id} h={h} selected={selected === h.id} onSelect={setSelected} onOpen={open} />)}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 space-y-4">
          <ForecastTimeline hotspots={ranked} onOpen={open} />
          <Card title="Incidents" subtitle="Opened at Warning or when a road floods; closed after 2 h back at Normal"
            actions={<Button size="sm" variant="ghost" icon="layers" onClick={() => navigate('/twin')}>Digital twin</Button>}>
            <Incidents incidents={live.incidents} onOpen={open} />
          </Card>
        </div>
        <Card title="Operations log" subtitle="Level changes, drafts, decisions, actions and field reports" className="xl:col-span-2" bodyClassName="max-h-[520px] overflow-y-auto">
          <OpsLog events={live.events} />
        </Card>
      </div>

      {hist && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title={`Rainfall: ${selName}`}
            subtitle="mm per hour, last 36 h (select a hotspot on the map or list)"
            type="bar" height={180} xMaxTicks={12}
            data={{ labels, datasets: [{ label: 'Rain (mm/h)', data: hist.rain, color: 'chart-1' }] }}
          />
          <ChartCard
            title="Tide and Miri River"
            subtitle="metres, last 36 h"
            legend height={180} xMaxTicks={12}
            data={{
              labels,
              datasets: [
                { label: 'Tide (m)', data: hist.tide, color: 'chart-2', fill: false },
                { label: 'Miri River (m)', data: hist.river, color: 'chart-3', fill: false },
              ],
            }}
            thresholds={[
              { value: 2.0, tone: 'info', label: 'High tide', description: '≥ 2.0 m' },
              { value: RIVER_ALERT_M, tone: 'warning', label: 'River alert', description: `${RIVER_ALERT_M} m` },
            ]}
          />
        </div>
      )}

      {drawer === 'rain' && <RainDrawer live={live} onClose={() => setDrawer(null)} />}
      {drawer === 'tide' && <TideDrawer live={live} onClose={() => setDrawer(null)} />}
      {drawer === 'river' && <RiverDrawer live={live} hist={hist} onClose={() => setDrawer(null)} />}
      {drawer === 'drain' && <DrainDrawer live={live} onClose={() => setDrawer(null)} />}
      {drawer === 'risk' && <RiskDrawer live={live} onClose={() => setDrawer(null)} />}
    </div>
  );
}
