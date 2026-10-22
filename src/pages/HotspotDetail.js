import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, DetailGrid, Icon, PageHeader } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import CausePanel from '../components/flood/CausePanel';
import CCTVCheck from '../components/flood/CCTVCheck';
import ResponsePanel from '../components/flood/ResponsePanel';
import FeedControls, { ModeBanner } from '../components/flood/FeedControls';
import { AiTag, LevelWithState, OfflineBanner, ProjectionSentence } from '../components/flood/bits';
import { useData, useLiveHotspot, usePolled } from '../data/DataProvider';
import { api } from '../services/api';
import { FLOOD_DEPTH_CM, RIVER_ALERT_M, cm, dayTime, fmtHours, hhmm, levelFor, pct } from '../utils';

const LEVEL_LINES = [
  { value: 25, tone: 'info', label: 'Watch', description: '≥ 25%' },
  { value: 50, tone: 'warning', label: 'Warning', description: '≥ 50%' },
  { value: 75, tone: 'danger', label: 'Danger', description: '≥ 75%' },
];

function ForecastTiles({ a, cctv }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {['1h', '3h', '6h'].map((k) => {
        const p = a.probs[k];
        const l = levelFor(p);
        const fused = cctv && a.model_probs && Math.abs(a.model_probs[k] - p) >= 0.01;
        return (
          <div key={k} className={`tile tone-${l.tone} text-center`}>
            <p className="label-caps" style={{ color: 'inherit' }}>Within +{k}</p>
            <p className="text-3xl font-extrabold tabular-nums leading-tight">{pct(p)}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider">{l.name}</p>
            {fused && <p className="text-[10px] text-fg-faint mt-1">model {pct(a.model_probs[k])} + CCTV</p>}
          </div>
        );
      })}
    </div>
  );
}

function TwinSummary({ id, onOpen }) {
  const { data } = usePolled('/api/twin', 5000);
  const site = data?.sites?.find((s) => s.id === id);
  if (!site) return <p className="text-xs text-fg-faint">Loading the twin…</p>;
  const p = site.projection;
  const s = site.state;
  return (
    <div className="space-y-2 text-xs">
      <div className={`tile ${site.flooding_now || p.first_flood_time ? 'tone-danger' : 'tone-success'}`}>
        <ProjectionSentence projection={p} flooding={site.flooding_now} depth={s.depth_cm} />
        {site.options?.one_more_pump && site.options.one_more_pump.peak_depth_cm < p.peak_depth_cm && (
          <> One more pump: peak {site.options.one_more_pump.peak_depth_cm} cm.</>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-fg-faint">Outfall</span><span className="text-right font-semibold text-fg">{s.outfall_state}</span>
        <span className="text-fg-faint">Discharge capacity now</span><span className="text-right font-semibold text-fg">{s.capacity_mmhr} of {s.design_mmhr} mm/h</span>
        <span className="text-fg-faint">Inflow now</span><span className={`text-right font-semibold ${s.overloaded ? 'text-danger' : 'text-fg'}`}>{s.inflow_mmhr} mm/h</span>
      </div>
      <Button size="sm" variant="soft" icon="layers" onClick={onOpen}>Open in the digital twin</Button>
    </div>
  );
}

export default function HotspotDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { live, online, notify, refreshAlerts, alerts } = useData();
  const h = useLiveHotspot(id);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const simTime = live?.sim_time;

  useEffect(() => {
    if (!simTime) return;
    api.get(`/api/live/history/${id}?hours=36`).then(setHist).catch(() => {});
  }, [id, simTime]);

  if (!live) return <div className="space-y-4">{!online && <OfflineBanner />}<p className="text-sm text-fg-faint">Loading…</p></div>;
  if (!h) {
    return (
      <Card title="Unknown hotspot">
        <p className="text-sm text-fg-faint mb-3">There is no hotspot called “{id}”.</p>
        <Button onClick={() => navigate('/hotspots')}>All hotspots</Button>
      </Card>
    );
  }

  const a = h.assessment;
  const s = h.sensors;
  const labels = hist?.time.map(hhmm) || [];
  const openDraft = alerts.find((x) => x.hotspot_id === id && x.source === live.source && ['pending', 'drafting'].includes(x.status));
  const draft = async () => {
    setBusy(true);
    try {
      const x = await api.post('/api/alerts/draft', { hotspot_id: id });
      refreshAlerts();
      notify(`Drafting ${x.kind === 'watch' ? 'a Watch advisory' : `a ${a.level} alert`} for ${h.name} (${x.id}). Review it in the Alert Centre.`);
    } catch (e) { notify(e.message, 'danger'); } finally { setBusy(false); }
  };
  const draftButton = openDraft
    ? <Button variant="accent" icon="bell" onClick={() => navigate(`/alerts?id=${openDraft.id}`)}>Review draft</Button>
    : a.level === 'Normal'
      ? <Button variant="accent" icon="sparkles" disabled title="At Normal there is nothing to warn about">Draft alert</Button>
      : <Button variant="accent" icon="sparkles" onClick={draft} disabled={busy}>{a.level === 'Watch' ? 'Draft advisory' : 'Draft alert'}</Button>;

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title={<span className="flex items-center gap-3 flex-wrap">{h.name} <LevelWithState assessment={a} />{h.pilot && <Badge tone="primary">PILOT SITE</Badge>}</span>}
        subtitle={`${h.area} · ${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`}
        actions={(
          <>
            <Button variant="ghost" icon="arrowLeft" onClick={() => navigate(-1)}>Back</Button>
            <FeedControls compact />
            {draftButton}
          </>
        )}
      />
      <ModeBanner />
      {a.flooding_now && (
        <div className="tile tone-danger text-xs flex items-center gap-2">
          <Icon name="waves" size={15} />
          <span><b>Flooding now:</b> {cm(a.water_depth_cm)} of water on {h.roads[0]} (flood depth {FLOOD_DEPTH_CM} cm).
            {h.incident ? ` Incident ${h.incident.id} open since ${dayTime(h.incident.opened)}.` : ''}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-2" title="Flood forecast" subtitle={`Sensor time ${hhmm(live.sim_time)} · probability of road water ≥ 10 cm within each horizon`}
          actions={<AiTag>Model</AiTag>}>
          <ForecastTiles a={a} cctv={h.cctv_reading} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 text-xs">
            <span className="text-fg-faint">Rain now</span><span className="text-right text-fg font-semibold">{s.rain_mmhr} mm/h ({Math.round(s.rain_3h)} mm in 3 h)</span>
            <span className="text-fg-faint">Forecast rain</span><span className="text-right text-fg font-semibold">{Math.round(s.rain_fcst_3h)} mm / 3 h · {Math.round(s.rain_fcst_6h)} mm / 6 h</span>
            <span className="text-fg-faint">Smart Drain {h.drain_id}</span><span className="text-right text-fg font-semibold">{Math.round(s.drain_pct)}% ({s.drain_rate >= 0 ? '+' : ''}{s.drain_rate}%/h)</span>
            <span className="text-fg-faint">Water on the road</span>
            <span className={`text-right font-semibold ${s.flooding_observed ? 'text-danger' : 'text-fg'}`}>{cm(s.water_depth_cm)}{s.depth_change ? ` (${s.depth_change > 0 ? '+' : ''}${s.depth_change} cm/h)` : ''}</span>
            <span className="text-fg-faint">Tide</span><span className="text-right text-fg font-semibold">{s.tide_m.toFixed(2)} m · high {s.next_high_m.toFixed(2)} m in {fmtHours(s.hours_to_high_tide)}</span>
            <span className="text-fg-faint">Miri River</span><span className="text-right text-fg font-semibold">{s.river_m.toFixed(2)} m {h.river_adjacent ? `(overtops near ${h.bank.toFixed(2)} m)` : `(alert ${RIVER_ALERT_M} m)`}</span>
          </div>
        </Card>
        <Card className="xl:col-span-3" title="Cause explanation" subtitle="Mechanism classifier and model drivers">
          <CausePanel assessment={a} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Response" subtitle="Pumps add drain capacity in the twin; closures and relief centres are logged for JPBD Miri">
          <ResponsePanel hotspot={h} fleet={live.response} />
        </Card>
        <Card title="Digital twin, next 6 h" subtitle="Hydraulic model run forward with the rain forecast and predicted tide">
          <TwinSummary id={id} onOpen={() => navigate('/twin')} />
        </Card>
      </div>

      {hist && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Flood probability" subtitle="Forecast history, % (including any CCTV confirmation)" legend height={210} xMaxTicks={12} yMax={100}
            data={{
              labels,
              datasets: [
                { label: '+1 h', data: hist.p1.map((v) => (v == null ? null : v * 100)), color: 'chart-5', fill: false },
                { label: '+3 h', data: hist.p3.map((v) => (v == null ? null : v * 100)), color: 'primary', fill: false, borderWidth: 2.5 },
                { label: '+6 h', data: hist.p6.map((v) => (v == null ? null : v * 100)), color: 'chart-8', fill: false, borderDash: [5, 3] },
              ],
            }}
            thresholds={LEVEL_LINES}
          />
          <ChartCard title="Water on the road" subtitle={`cm, from the ${h.drain_id} above-rim gauge`} height={210} xMaxTicks={12} ySuggestedMax={20}
            data={{ labels, datasets: [{ label: 'Road water (cm)', data: hist.depth, color: 'chart-6' }] }}
            thresholds={[{ value: FLOOD_DEPTH_CM, tone: 'danger', label: 'Flood depth', description: '10 cm' }]}
          />
          <ChartCard title="Smart Drain level" subtitle={`${h.drain} (${h.drain_id}), % full`} height={190} xMaxTicks={12} yMax={100}
            data={{ labels, datasets: [{ label: 'Drain level (%)', data: hist.drain, color: 'chart-4' }] }}
            thresholds={[
              { value: 80, tone: 'warning', label: 'Backflow risk', description: '> 80%' },
              { value: 100, tone: 'danger', label: 'Surcharging', description: '100%' },
            ]}
          />
          <ChartCard title="Rainfall" subtitle="mm per hour at this hotspot" type="bar" height={190} xMaxTicks={12}
            data={{ labels, datasets: [{ label: 'Rain (mm/h)', data: hist.rain, color: 'chart-1' }] }} />
          <ChartCard className="lg:col-span-2" title="Tide and Miri River" subtitle="metres" legend height={190} xMaxTicks={12}
            data={{
              labels,
              datasets: [
                { label: 'Tide (m)', data: hist.tide, color: 'chart-2', fill: false },
                { label: 'Miri River (m)', data: hist.river, color: 'chart-3', fill: false },
              ],
            }}
            thresholds={[
              { value: 2.0, tone: 'info', label: 'High tide', description: '≥ 2.0 m' },
              { value: h.tidal_outfall ? h.outfall : null, tone: 'neutral', label: h.tidal_outfall ? 'Outfall invert' : null, description: h.tidal_outfall ? `${h.outfall} m: tide above this slows the drain` : null },
            ].filter((t) => t.value != null)}
          />
        </div>
      )}

      <CCTVCheck hotspot={h} />

      <Card title="Site profile" subtitle="From the drainage asset register (prototype values)">
        <DetailGrid columns={3} items={[
          { label: 'Elevation', value: `${h.elevation_m} m above sea level` },
          { label: 'Floods on record before Oct 2024', value: `${h.past_floods} (MCC records)` },
          { label: 'Flood events in the sensor history', value: `${h.history_floods} of 16 (Oct 2024 – Oct 2026)` },
          { label: 'Residents (approx.)', value: h.population.toLocaleString() },
          { label: 'Smart Drain', value: `${h.drain} (${h.drain_id})` },
          { label: 'CCTV camera', value: h.cctv },
          { label: 'Outfall', value: h.tidal_outfall ? `Tidal, invert ${h.outfall.toFixed(2)} m (backflow possible)` : `Gravity, invert ${h.outfall.toFixed(2)} m` },
          { label: 'River bank', value: h.river_adjacent ? `Riverside, overtops near ${h.bank.toFixed(2)} m` : 'Not riverside' },
          { label: 'Design drain capacity', value: `${h.capacity} mm/h of rain` },
          { label: 'Roads at risk', value: h.roads.join(', ') },
          { label: 'Mobile pump point', value: h.pump_point },
          { label: 'Relief centre', value: h.relief_centre },
        ]} />
      </Card>
    </div>
  );
}
