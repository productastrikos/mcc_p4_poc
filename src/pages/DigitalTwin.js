import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, DetailGrid, Icon, PageHeader, ProgressBar, Tabs } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import TwinSection from '../components/flood/TwinSection';
import ResponsePanel from '../components/flood/ResponsePanel';
import FeedControls, { ModeBanner } from '../components/flood/FeedControls';
import { CCTV_TONE } from '../components/flood/CCTVCheck';
import { ForecastCells, LevelBadge, LevelWithState, MechanismBadge, OfflineBanner, ProjectionSentence } from '../components/flood/bits';
import { CameraFeed, TwinOrbit, TwinThumb } from '../twin3d/lazy';
import { cameraInfo, frameState } from '../twin3d/state';
import { useData, usePolled } from '../data/DataProvider';
import { api } from '../services/api';
import {
  FLOOD_DEPTH_CM, HIGH_TIDE_M, LEVEL_RANK, OUTFALL_TONE, RIVER_ALERT_M, addHours, cm, dayTime, hhmm,
  outfallBlocking, outfallState,
} from '../utils';

const GRID_TABS = [{ value: 'models', label: '3D models' }, { value: 'cameras', label: 'CCTV wall' }];
const VIEW_TABS = [{ value: '3d', label: '3D' }, { value: 'camera', label: 'Camera' }, { value: 'section', label: 'Section' }];

const PAST_H = 24;
const AHEAD_H = 6;

/** The state of one site at a scrubber offset: recorded (< 0), now (0) or projected (> 0). */
function frameFor(site, twin, hist, offset) {
  if (offset === 0 || !hist) {
    const s = site.state;
    return {
      kind: 'now', source: twin.source, time: twin.sim_time, rain: s.rain_mmhr, drain: s.drain_pct, depth: s.depth_cm,
      tide: twin.sea.tide_m, river: twin.river.level_m, pumps: site.response.pumps.length,
      roadsClosed: site.response.roads_closed, level: site.level,
      block: { tide: s.tide_block_pct, river: s.river_block_pct }, outfall: s.outfall_state, capacity: s.capacity_mmhr,
    };
  }
  if (offset < 0) {
    // Anchor on the current sensor hour in case the history is a poll behind.
    const base = hist.time.lastIndexOf(twin.sim_time);
    const i = (base >= 0 ? base : hist.time.length) + offset;
    const r = hist.sites[site.id];
    if (i < 0 || !r) return null;
    const tide = hist.tide[i];
    const river = hist.river[i];
    const block = outfallBlocking(site, tide, river);
    const pumpMm = r.pump_mmhr[i] || 0;
    return {
      kind: 'recorded', time: hist.time[i], rain: r.rain[i], drain: r.drain[i], depth: r.depth[i], tide, river,
      pumps: Math.round(pumpMm / 12), roadsClosed: false, level: r.level[i], block, outfall: outfallState(block),
      capacity: site.capacity * Math.max(0.06, (1 - block.tide / 100) * (1 - block.river / 100)) + pumpMm,
    };
  }
  const p = site.projection;
  const i = offset - 1;
  const block = outfallBlocking(site, p.tide[i], p.river[i]);
  return {
    kind: 'projected', time: p.time[i], rain: p.rain[i], drain: p.drain[i], depth: p.depth[i], tide: p.tide[i], river: p.river[i],
    pumps: site.response.pumps.length, roadsClosed: site.response.roads_closed, level: null, block, outfall: outfallState(block),
    capacity: site.capacity * Math.max(0.06, (1 - block.tide / 100) * (1 - block.river / 100)) + site.response.pump_mmhr,
  };
}

function FrameTag({ frame }) {
  if (frame.kind === 'now') {
    return frame.source === 'live'
      ? <Badge tone="success" dot>LIVE</Badge>
      : <Badge tone="warning" dot>{frame.source === 'drill' ? 'DRILL' : 'REPLAY'} {hhmm(frame.time)}</Badge>;
  }
  if (frame.kind === 'recorded') return <Badge tone="neutral">RECORDED {hhmm(frame.time)}</Badge>;
  return <Badge tone="accent">PROJECTED {hhmm(frame.time)}</Badge>;
}

function SiteCard({ site, frame, selected, onSelect }) {
  const flooded = frame.depth >= FLOOD_DEPTH_CM;
  return (
    <button type="button" onClick={() => onSelect(site.id)}
      className={`card twin-card text-left ${selected ? 'is-selected' : ''} ${flooded ? 'is-flooded' : ''}`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-fg truncate">{site.name}</p>
          <p className="text-[10px] text-fg-faint truncate">{site.drain} · {site.tidal_outfall ? 'tidal outfall' : 'gravity outfall'}</p>
        </div>
        {frame.kind === 'projected'
          ? <FrameTag frame={frame} />
          : <span className="flex items-center gap-1.5">{frame.level && <LevelBadge level={frame.level} />}</span>}
      </div>
      <TwinThumb site={site} state={frameState(frame)} className="twin-thumb" />
      <div className="grid grid-cols-4 gap-1 px-3 pb-3 text-center">
        <Stat label="Drain" value={`${Math.round(frame.drain)}%`} tone={frame.drain >= 80 ? 'warning' : undefined} />
        <Stat label="Road" value={cm(frame.depth)} tone={flooded ? 'danger' : frame.depth >= 2 ? 'warning' : undefined} />
        <Stat label="Outfall" value={frame.outfall.replace('Partly tide-locked', 'Part-locked').replace('River backwater', 'Backwater')} tone={OUTFALL_TONE[frame.outfall]} />
        <Stat label="Capacity" value={`${Math.round(frame.capacity)}/${site.capacity}`} sub="mm/h" />
      </div>
    </button>
  );
}

/** One street camera on the CCTV wall (always the current reading). */
function CameraTile({ site, twin, selected, onSelect }) {
  const reading = site.cctv_reading;
  return (
    <button type="button" onClick={() => onSelect(site.id)}
      className={`card twin-card text-left ${selected ? 'is-selected' : ''}`} title={`Show ${site.cctv} in the inspector`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-fg truncate">{site.name}</p>
          <p className="text-[10px] text-fg-faint truncate">{site.cctv} · {site.roads[0]}</p>
        </div>
        {reading
          ? <Badge tone={CCTV_TONE[reading.status]} dot>{reading.status.toUpperCase()}</Badge>
          : <LevelBadge level={site.level} />}
      </div>
      <CameraFeed site={site} state={frameState(frameFor(site, twin, null, 0))} fps={8}
        info={cameraInfo(site, twin.sim_time, { source: twin.source })} className="cctv-canvas" />
    </button>
  );
}

/** Labels pinned to the 3D twin's elements. */
function labelsFor(site, frame) {
  const blocked = Math.max(frame.block.tide, frame.block.river);
  return {
    sensor: { text: `${site.drain_id} · drain ${Math.round(frame.drain)}%`, tone: frame.drain >= 80 ? 'warning' : 'neutral' },
    gauge: {
      text: `Road water ${cm(frame.depth)}`,
      tone: frame.depth >= FLOOD_DEPTH_CM ? 'danger' : frame.depth >= 2 ? 'warning' : 'neutral',
    },
    gate: { text: `Outfall ${frame.outfall.toLowerCase()}${blocked ? ` · ${blocked}% shut` : ''}`, tone: OUTFALL_TONE[frame.outfall] },
    creek: { text: `Tide ${frame.tide.toFixed(2)} m`, tone: 'info' },
    pump: frame.pumps ? { text: `${frame.pumps} pump${frame.pumps > 1 ? 's' : ''} · +${frame.pumps * 12} mm/h`, tone: 'primary' } : null,
    barrier: frame.roadsClosed ? { text: 'Road closed', tone: 'warning' } : null,
  };
}

function Stat({ label, value, tone, sub }) {
  return (
    <div className="twin-stat">
      <p className="label-caps" style={{ fontSize: 8.5 }}>{label}</p>
      <p className="text-[11.5px] font-bold tabular-nums leading-tight" style={tone ? { color: `var(--color-${tone})` } : undefined}>
        {value}{sub && <span className="text-[9px] font-medium text-fg-faint ml-0.5">{sub}</span>}
      </p>
    </div>
  );
}

// Position of an hour offset on the slider track, as a % of its width.
const trackPct = (h) => `${((h + PAST_H) / (PAST_H + AHEAD_H)) * 100}%`;

function Scrubber({ offset, setOffset, simTime, source }) {
  const nowLabel = source === 'live' ? 'Now (live)' : source === 'drill' ? 'Now (drill)' : 'Now (replay)';
  const label = offset === 0 ? nowLabel : offset < 0 ? `${-offset} h ago · recorded` : `+${offset} h · projected`;
  return (
    <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => setOffset(Math.max(-PAST_H, offset - 1))} disabled={offset <= -PAST_H} title="One hour back">◀ 1 h</Button>
        <Button size="sm" variant={offset === 0 ? 'primary' : 'secondary'} onClick={() => setOffset(0)}>Now</Button>
        <Button size="sm" variant="ghost" onClick={() => setOffset(Math.min(AHEAD_H, offset + 1))} disabled={offset >= AHEAD_H} title="One hour ahead">1 h ▶</Button>
      </div>
      <div className="flex-1 min-w-[220px]">
        <input type="range" className="slider" min={-PAST_H} max={AHEAD_H} step={1} value={offset}
          onChange={(e) => setOffset(parseInt(e.target.value, 10))} aria-label="Twin time" />
        <div className="relative h-3.5 text-[9.5px] text-fg-faint mt-1">
          <span className="absolute left-0">−{PAST_H} h recorded</span>
          <span className="absolute -translate-x-1/2" style={{ left: trackPct(-12) }}>−12 h</span>
          <span className="absolute -translate-x-1/2 text-fg font-semibold" style={{ left: trackPct(0) }}>now</span>
          <span className="absolute right-0">+{AHEAD_H} h projected</span>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-bold text-fg">{label}</p>
        <p className="text-[10.5px] text-fg-faint font-mono">{dayTime(addHours(simTime, offset))} MYT</p>
      </div>
    </div>
  );
}

function SystemStrip({ twin, onSelect }) {
  const { respond } = useData();
  const sea = twin.sea;
  const sites = twin.sites;
  const surcharged = sites.filter((s) => s.state.drain_pct >= 80).length;
  const locked = sites.filter((s) => s.state.outfall_state === 'Tide-locked').length;
  const part = sites.filter((s) => s.state.outfall_state === 'Partly tide-locked').length;
  const flooded = sites.filter((s) => s.state.depth_cm >= FLOOD_DEPTH_CM).length;
  const willFlood = sites.filter((s) => s.projection.first_flood_time && s.state.depth_cm < FLOOD_DEPTH_CM).length;
  const closed = sites.filter((s) => s.response.roads_closed).length;
  const pumps = twin.response.pumps;
  const name = (id) => sites.find((s) => s.id === id)?.short;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <ChartCard title={`Sea level ${sea.tide_m.toFixed(2)} m, ${sea.trend}`}
        subtitle={sea.next_high ? `High ${sea.next_high.height_m.toFixed(2)} m at ${hhmm(sea.next_high.time)}${sea.next_high.surge_m ? ` (incl. ${sea.next_high.surge_m.toFixed(2)} m surge)` : ''} · low ${sea.next_low?.height_m.toFixed(2)} m at ${hhmm(sea.next_low?.time)}` : ''}
        height={96} xMaxTicks={5}
        data={{ labels: sea.ahead.time.map((t, i) => (i === 0 ? 'Now' : hhmm(t))), datasets: [{ label: 'Predicted tide (m)', data: sea.ahead.tide, color: 'chart-2' }] }}
        thresholds={[{ value: HIGH_TIDE_M, tone: 'warning' }]} />
      <Card title={`Miri River ${twin.river.level_m.toFixed(2)} m`} subtitle={`${twin.river.change_m >= 0 ? '+' : ''}${twin.river.change_m.toFixed(2)} m in the last hour`}>
        <div className="flex justify-between text-[10.5px] mb-1"><span className="text-fg-faint">Against the {RIVER_ALERT_M} m alert level</span><span className="font-semibold text-fg">{Math.round((twin.river.level_m / RIVER_ALERT_M) * 100)}%</span></div>
        <ProgressBar value={twin.river.level_m} max={RIVER_ALERT_M}
          tone={twin.river.level_m >= RIVER_ALERT_M ? 'danger' : twin.river.level_m >= RIVER_ALERT_M - 0.3 ? 'warning' : 'info'} />
        <p className="text-[10.5px] text-fg-faint mt-2">Banks overtop near {sites.filter((s) => s.river_adjacent).map((s) => `${s.bank.toFixed(1)} m (${s.short})`).join(', ')}.</p>
      </Card>
      <Card title="Mobile pump fleet" subtitle={`${pumps.filter((p) => !p.hotspot_id).length} of ${pumps.length} at the depot · +${twin.response.pump_mmhr} mm/h each`}>
        <div className="grid grid-cols-2 gap-1.5">
          {pumps.map((p) => (
            <div key={p.unit} className={`pump-chip ${p.hotspot_id ? 'is-out' : ''}`}>
              <button type="button" className="flex-1 text-left" disabled={!p.hotspot_id} onClick={() => onSelect(p.hotspot_id)}
                title={p.hotspot_id ? `At ${sites.find((s) => s.id === p.hotspot_id)?.name} since ${hhmm(p.since)}` : 'At the depot'}>
                <span className="font-bold">{p.unit}</span> <span className="text-fg-faint">{p.hotspot_id ? `@ ${name(p.hotspot_id)}` : 'depot'}</span>
              </button>
              {p.hotspot_id && twin.response.available && (
                <button type="button" className="link-btn" onClick={() => respond('recall_pump', p.hotspot_id, p.unit)}>RECALL</button>
              )}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Network status" subtitle={`${sites.length} Smart Drains, ${sites.length} outfalls, ${sites.length} CCTV cameras`}>
        <div className="space-y-1 text-[11.5px]">
          <Row label="Drains at 80% or more" value={surcharged} tone={surcharged ? 'warning' : undefined} />
          <Row label="Outfalls tide-locked / partly" value={`${locked} / ${part}`} tone={locked ? 'danger' : part ? 'warning' : undefined} />
          <Row label="Roads flooded now" value={flooded} tone={flooded ? 'danger' : undefined} />
          <Row label="Projected to flood within 6 h" value={willFlood} tone={willFlood ? 'warning' : undefined} />
          <Row label="Road closures in force" value={closed} />
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex justify-between"><span className="text-fg-faint">{label}</span>
      <b className="tabular-nums" style={tone ? { color: `var(--color-${tone})` } : { color: 'var(--color-text)' }}>{value}</b></div>
  );
}

function Inspector({ site, frame, hist, twin, tab, setTab, onOpenHotspot }) {
  const orbitRef = useRef(null);
  const p = site.projection;
  const r = hist?.sites[site.id];
  // Recorded hours before now, then now, then the projection.
  const base = hist ? hist.time.lastIndexOf(twin.sim_time) : -1;
  const pastN = hist ? (base >= 0 ? base : hist.time.length) : 0;
  const labels = [...(hist ? hist.time.slice(0, pastN).map(hhmm) : []), 'Now', ...p.time.map(hhmm)];
  const now = frameFor(site, twin, null, 0);
  const series = (rec, key, proj) => {
    const past = [...(rec ? rec.slice(0, pastN) : []), now[key]];
    return {
      recorded: [...past, ...proj.map(() => null)],
      projected: [...past.map((v, i) => (i === past.length - 1 ? v : null)), ...proj],
    };
  };
  const depth = series(r?.depth, 'depth', p.depth);
  const drain = series(r?.drain, 'drain', p.drain);
  const opts = site.options || {};
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <Card className="xl:col-span-3" title={<span className="flex items-center gap-2 flex-wrap">{site.name} <FrameTag frame={frame} /></span>}
        subtitle={`${site.area} · ${site.drain} (${site.drain_id}) · outfall invert ${site.outfall.toFixed(2)} m · design capacity ${site.capacity} mm/h`}
        actions={(
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Tabs tabs={VIEW_TABS} value={tab} onChange={setTab} />
            {tab === '3d' && <Button size="sm" variant="ghost" onClick={() => orbitRef.current?.reset()}>Reset view</Button>}
            <Button size="sm" variant="ghost" onClick={onOpenHotspot}>Open hotspot</Button>
          </div>
        )}>
        {tab === '3d' && (
          <>
            <TwinOrbit ref={orbitRef} site={site} state={frameState(frame)} labels={labelsFor(site, frame)} />
            <p className="text-[10.5px] text-fg-faint mt-1.5">Drag to orbit, scroll to zoom. Water levels, the gate, pumps and closures follow the twin; heights are to scale.</p>
          </>
        )}
        {tab === 'camera' && (
          <>
            <CameraFeed site={site} state={frameState(frame)} className="cctv-canvas"
              info={cameraInfo(site, frame.time, {
                source: twin.source,
                banner: frame.kind === 'projected' ? 'TWIN PROJECTION' : frame.kind === 'recorded' ? 'TWIN RECONSTRUCTION' : undefined,
              })} />
            <p className="text-[10.5px] text-fg-faint mt-1.5">
              {site.cctv}, pole-mounted at {site.roads[0]}. {frame.kind === 'now'
                ? 'Simulated from the current sensor readings.'
                : 'What the camera would show at this hour, rendered from the twin.'} The red and white staff is a 1 m flood gauge in 10 cm bands.
            </p>
          </>
        )}
        {tab === 'section' && <TwinSection site={site} frame={frame} large />}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <Stat label="Rain" value={`${frame.rain.toFixed(1)} mm/h`} />
          <Stat label="Inflow now" value={`${site.state.inflow_mmhr} mm/h`} tone={site.state.overloaded ? 'danger' : undefined} />
          <Stat label="Discharge capacity" value={`${Math.round(frame.capacity)} mm/h`} />
          <Stat label="Drain backwater" value={`${Math.round(site.state.backwater_pct)}%`} />
        </div>
        {frame.kind === 'now' && site.state.overloaded && (
          <p className="text-[11px] text-danger mt-2">Inflow is above what the outfall can discharge now, so the drain is filling.</p>
        )}
      </Card>
      <div className="xl:col-span-2 space-y-4">
        <Card title="Projection and options" subtitle="Hydraulic model run forward 6 h with the rain forecast and predicted tide">
          <div className="space-y-2 text-xs">
            <div className={`tile ${site.flooding_now || p.first_flood_time ? 'tone-danger' : 'tone-success'}`}>
              <ProjectionSentence projection={p} flooding={site.flooding_now} depth={site.state.depth_cm} />
            </div>
            {opts.without_pumps && (
              <p className="text-fg-muted">Without the {site.response.pumps.length} pump{site.response.pumps.length === 1 ? '' : 's'} on site the peak would be <b className="text-fg">{opts.without_pumps.peak_depth_cm} cm</b>{opts.without_pumps.first_flood_time ? `, flooding from ${hhmm(opts.without_pumps.first_flood_time)}` : ''}.</p>
            )}
            {opts.one_more_pump && (
              <p className="text-fg-muted">With one more pump the peak would be <b className="text-fg">{opts.one_more_pump.peak_depth_cm} cm</b>
                {opts.one_more_pump.first_flood_time ? `, still flooding from ${hhmm(opts.one_more_pump.first_flood_time)}` : opts.one_more_pump.peak_depth_cm < p.peak_depth_cm && p.first_flood_time ? ', which keeps the road below flood depth' : ''}.</p>
            )}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <LevelWithState assessment={{ level: site.level, flooding_now: site.flooding_now, water_depth_cm: site.state.depth_cm }} />
              <ForecastCells probs={site.probs} compact />
              <MechanismBadge mechanism={site.mechanism} depth={site.state.depth_cm} />
            </div>
            <p className="text-[10.5px] text-fg-faint">The percentages are the ML forecast. The twin is the physics model; when they disagree, check CCTV.</p>
          </div>
        </Card>
        <Card title="Response" subtitle={`${site.pump_point} · ${site.relief_centre.replace(' (relief centre)', '')}`}>
          <ResponsePanel hotspot={site} fleet={twin.response} />
        </Card>
      </div>
      {r && (
        <>
          <ChartCard className="xl:col-span-2" title="Road water" subtitle="cm · recorded, then projected (dashed)" legend height={170} ySuggestedMax={20} xMaxTicks={10}
            data={{ labels, datasets: [
              { label: 'Recorded', data: depth.recorded, color: 'chart-6', fill: false },
              { label: 'Projected', data: depth.projected, color: 'accent', fill: false, borderDash: [5, 3] },
            ] }}
            thresholds={[{ value: FLOOD_DEPTH_CM, tone: 'danger', label: 'Flood depth', description: '10 cm' }]} />
          <ChartCard className="xl:col-span-2" title="Smart Drain level" subtitle="% full · recorded, then projected (dashed)" legend height={170} yMax={100} xMaxTicks={10}
            data={{ labels, datasets: [
              { label: 'Recorded', data: drain.recorded, color: 'chart-4', fill: false },
              { label: 'Projected', data: drain.projected, color: 'accent', fill: false, borderDash: [5, 3] },
            ] }}
            thresholds={[{ value: 80, tone: 'warning', label: 'Backflow threshold', description: '80%' }]} />
          <Card title="Asset register" subtitle="Twin elements for this site">
            <DetailGrid columns={1} items={[
              { label: 'Smart Drain sensor', value: `${site.drain_id} · online · reading ${hhmm(twin.sim_time)}` },
              { label: 'CCTV camera', value: site.cctv_reading ? `${site.cctv} · ${site.cctv_reading.status} at ${hhmm(site.cctv_reading.at)}` : `${site.cctv} · no frame checked` },
              { label: 'Outfall', value: `${site.tidal_outfall ? 'Tidal, flap-gated' : 'Gravity'} · invert ${site.outfall.toFixed(2)} m` },
              { label: 'River bank', value: site.river_adjacent ? `Overtops near ${site.bank.toFixed(2)} m` : 'Not riverside' },
            ]} />
          </Card>
        </>
      )}
    </div>
  );
}

export default function DigitalTwin() {
  const navigate = useNavigate();
  const { online } = useData();
  const { data: twin, error } = usePolled('/api/twin', 2500);
  const [hist, setHist] = useState(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState('pujut-adong');
  const [grid, setGrid] = useState('models');
  const [tab, setTab] = useState('3d');
  const simTime = twin?.sim_time;

  useEffect(() => {
    if (!simTime) return;
    api.get(`/api/twin/history?hours=${PAST_H}`).then(setHist).catch(() => {});
  }, [simTime]);

  const ranked = useMemo(() => (twin ? [...twin.sites].sort((a, b) =>
    (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (b.projection.peak_depth_cm - a.projection.peak_depth_cm)) : []), [twin]);

  if (!twin) {
    return <div className="space-y-4">{(!online || error) && <OfflineBanner />}<p className="text-sm text-fg-faint">Loading the digital twin…</p></div>;
  }
  const sel = twin.sites.find((s) => s.id === selected) || twin.sites[0];
  const frames = Object.fromEntries(twin.sites.map((s) => [s.id, frameFor(s, twin, hist, offset) || frameFor(s, twin, null, 0)]));

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title="Digital Twin"
        subtitle="Live hydraulic replica of the six hotspots: rain → road and Smart Drain → outfall → sea and Miri River. Scrub back through the recorded day or ahead through the 6 h projection."
        actions={<FeedControls compact />}
      />
      <ModeBanner />
      <SystemStrip twin={twin} onSelect={setSelected} />
      <Scrubber offset={offset} setOffset={setOffset} simTime={twin.sim_time} source={twin.source} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs tabs={GRID_TABS} value={grid} onChange={setGrid} />
        <p className="text-[11px] text-fg-faint">
          {grid === 'models'
            ? 'Each site at the selected hour. Click one to inspect it below.'
            : `Street cameras now (${hhmm(twin.sim_time)}). Click one to open it in the inspector.`}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {grid === 'models'
          ? ranked.map((s) => <SiteCard key={s.id} site={s} frame={frames[s.id]} selected={s.id === sel.id} onSelect={setSelected} />)
          : ranked.map((s) => (
            <CameraTile key={s.id} site={s} twin={twin} selected={s.id === sel.id}
              onSelect={(id) => { setSelected(id); setTab('camera'); }} />
          ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-fg-faint flex-wrap">
        <Icon name="info" size={13} />Heights are to scale against chart datum: road, drain, flood wall, outfall invert and tide. Outfall gates:
        <Badge tone="success" plain>FREE-FLOWING</Badge><Badge tone="info" plain>RIVER BACKWATER</Badge>
        <Badge tone="warning" plain>PARTLY TIDE-LOCKED</Badge><Badge tone="danger" plain>TIDE-LOCKED</Badge>
      </div>
      <Inspector site={sel} frame={frames[sel.id]} hist={hist} twin={twin} tab={tab} setTab={setTab}
        onOpenHotspot={() => navigate(`/hotspots/${sel.id}`)} />
    </div>
  );
}
