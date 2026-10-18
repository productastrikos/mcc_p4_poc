import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, DetailGrid, PageHeader } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import CausePanel from '../components/flood/CausePanel';
import CCTVCheck from '../components/flood/CCTVCheck';
import FeedControls, { ModeBanner } from '../components/flood/FeedControls';
import { AiTag, LevelBadge, OfflineBanner } from '../components/flood/bits';
import { useData, useLiveHotspot } from '../data/DataProvider';
import { api } from '../services/api';
import { fmtHours, hhmm, levelFor, pct } from '../utils';

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

export default function HotspotDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { live, online, notify, refreshAlerts } = useData();
  const h = useLiveHotspot(id);
  const [hist, setHist] = useState(null);
  const simTime = live?.sim_time;

  useEffect(() => {
    if (!simTime) return;
    api.get(`/api/live/history/${id}?hours=36`).then(setHist).catch(() => {});
  }, [id, simTime]);

  if (!live) return <div className="space-y-4">{!online && <OfflineBanner />}<p className="text-sm text-fg-faint">Loading…</p></div>;
  if (!h) return <p className="text-sm text-fg-faint">Unknown hotspot.</p>;

  const a = h.assessment;
  const s = h.sensors;
  const labels = hist?.time.map(hhmm) || [];
  const draft = async () => {
    try {
      await api.post('/api/alerts/draft', { hotspot_id: id });
      refreshAlerts();
      notify(`Drafting a ${a.level} alert for ${h.name}. Review it in the Alert Centre.`);
    } catch (e) { notify(e.message, 'danger'); }
  };

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title={<span className="flex items-center gap-3 flex-wrap">{h.name} <LevelBadge level={a.level} />{h.pilot && <Badge tone="primary">PILOT SITE</Badge>}</span>}
        subtitle={`${h.area} · ${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`}
        actions={(
          <>
            <Button variant="ghost" icon="arrowLeft" onClick={() => navigate(-1)}>Back</Button>
            <FeedControls compact />
            <Button variant="accent" icon="sparkles" onClick={draft}>Draft alert</Button>
          </>
        )}
      />
      <ModeBanner />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-2" title="Flood forecast" subtitle={`Sensor time ${hhmm(live.sim_time)} · probability of flooding within each horizon`}
          actions={<AiTag>Model</AiTag>}>
          <ForecastTiles a={a} cctv={h.cctv_reading} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 text-xs">
            <span className="text-fg-faint">Rain now</span><span className="text-right text-fg font-semibold">{s.rain_mmhr} mm/h ({s.rain_3h} mm in 3 h)</span>
            <span className="text-fg-faint">Forecast rain</span><span className="text-right text-fg font-semibold">{Math.round(s.rain_fcst_3h)} mm / 3 h · {Math.round(s.rain_fcst_6h)} mm / 6 h</span>
            <span className="text-fg-faint">Smart Drain</span><span className="text-right text-fg font-semibold">{Math.round(s.drain_pct)}% ({s.drain_rate >= 0 ? '+' : ''}{s.drain_rate}%/h)</span>
            <span className="text-fg-faint">Tide</span><span className="text-right text-fg font-semibold">{s.tide_m} m · high {s.next_high_m} m in {fmtHours(s.hours_to_high_tide)}</span>
            <span className="text-fg-faint">Miri River</span><span className="text-right text-fg font-semibold">{s.river_m} m (overtops near {h.bank} m)</span>
            {s.flooding_observed && (<><span className="text-danger font-semibold">Field report</span><span className="text-right text-danger font-semibold">road flooded ≈ {s.water_depth_cm} cm</span></>)}
          </div>
        </Card>
        <Card className="xl:col-span-3" title="Cause explanation" subtitle="Mechanism classifier and model drivers">
          <CausePanel assessment={a} />
        </Card>
      </div>

      {hist && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Flood probability" subtitle="Forecast history, % (including any CCTV confirmation)" legend height={210} yMax={100}
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
          <ChartCard title="Smart Drain level" subtitle={`${h.drain}, % full`} height={210} yMax={100}
            data={{ labels, datasets: [{ label: 'Drain level (%)', data: hist.drain, color: 'chart-4' }] }}
            thresholds={[
              { value: 80, tone: 'warning', label: 'Backflow risk', description: '> 80%' },
              { value: 100, tone: 'danger', label: 'Surcharging', description: '100%' },
            ]}
          />
          <ChartCard title="Rainfall" subtitle="mm per hour at this hotspot" type="bar" height={190}
            data={{ labels, datasets: [{ label: 'Rain (mm/h)', data: hist.rain, color: 'chart-1' }] }} />
          <ChartCard title="Tide and Miri River" subtitle="metres" legend height={190}
            data={{
              labels,
              datasets: [
                { label: 'Tide (m)', data: hist.tide, color: 'chart-2', fill: false },
                { label: 'Miri River (m)', data: hist.river, color: 'chart-3', fill: false },
              ],
            }}
            thresholds={[{ value: 2.0, tone: 'info', label: 'High tide', description: '≥ 2.0 m' }]}
          />
        </div>
      )}

      <CCTVCheck hotspot={h} />

      <Card title="Site profile" subtitle="From the drainage asset register (prototype values)">
        <DetailGrid columns={3} items={[
          { label: 'Elevation', value: `${h.elevation_m} m above sea level` },
          { label: 'Past floods recorded', value: h.past_floods },
          { label: 'Residents (approx.)', value: h.population.toLocaleString() },
          { label: 'Smart Drain', value: h.drain },
          { label: 'CCTV camera', value: h.cctv },
          { label: 'Outfall', value: h.tidal_outfall ? 'Tidal (backflow possible)' : 'Not tidal' },
          { label: 'Roads at risk', value: h.roads.join(', ') },
          { label: 'Mobile pump point', value: h.pump_point },
          { label: 'Relief centre', value: h.relief_centre },
        ]} />
      </Card>
    </div>
  );
}
