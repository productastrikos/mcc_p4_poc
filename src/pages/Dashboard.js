import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, PageHeader } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import RiskMap from '../components/flood/RiskMap';
import FeedControls, { ModeBanner } from '../components/flood/FeedControls';
import { ForecastCells, LevelBadge, MechanismBadge, OfflineBanner, SensorTile } from '../components/flood/bits';
import { useData } from '../data/DataProvider';
import { api } from '../services/api';
import { LEVEL_RANK, LEVELS, fmtHours, hhmm, levelFor, pct } from '../utils';

function HotspotRow({ h, selected, onSelect, onOpen }) {
  const a = h.assessment;
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => onSelect(h.id)} onDoubleClick={() => onOpen(h.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(h.id)}
      className={`px-4 py-3 border-b last:border-0 cursor-pointer transition-colors ${selected ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-fg truncate">
            {h.name} {h.pilot && <span className="text-[9px] font-bold text-primary align-middle ml-1">PILOT</span>}
          </p>
          <MechanismBadge mechanism={a?.mechanism} />
        </div>
        <LevelBadge level={a?.level} />
      </div>
      <div className="flex items-center justify-between gap-3 mt-2">
        <ForecastCells probs={a?.probs} compact />
        <div className="text-right text-[10.5px] text-fg-faint leading-tight">
          <div>Drain <b className="text-fg">{Math.round(h.sensors.drain_pct)}%</b></div>
          <div>Rain <b className="text-fg">{h.sensors.rain_mmhr}</b> mm/h</div>
          {h.cctv_reading && <div className="text-accent font-semibold">CCTV: {h.cctv_reading.status}</div>}
        </div>
      </div>
    </div>
  );
}

/** Rows = hotspots, columns = now / +1h / +3h / +6h, coloured by level. */
function ForecastTimeline({ hotspots, onOpen }) {
  return (
    <Card title="Forecast timeline" subtitle="Probability of flooding within each horizon" padded={false}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Hotspot</th><th>Drain now</th><th>+1 h</th><th>+3 h</th><th>+6 h</th><th>Cause</th></tr>
          </thead>
          <tbody>
            {hotspots.map((h) => {
              const a = h.assessment;
              return (
                <tr key={h.id} className="is-clickable" onClick={() => onOpen(h.id)}>
                  <td className="cell-strong whitespace-nowrap">{h.name}</td>
                  <td className="tabular-nums">{Math.round(h.sensors.drain_pct)}%</td>
                  {['1h', '3h', '6h'].map((k) => {
                    const p = a?.probs?.[k] ?? 0;
                    const l = levelFor(p);
                    return (
                      <td key={k}>
                        <span className={`badge tone-${l.tone} tabular-nums`} style={{ minWidth: 64, justifyContent: 'center' }}>
                          {pct(p)} · {l.name}
                        </span>
                      </td>
                    );
                  })}
                  <td><MechanismBadge mechanism={a?.mechanism} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { live, online, pendingAlerts } = useData();
  const [selected, setSelected] = useState('pujut-adong');
  const [hist, setHist] = useState(null);

  // City conditions chart uses the selected hotspot's sensor history.
  const simTime = live?.sim_time;
  useEffect(() => {
    if (!simTime) return;
    api.get(`/api/live/history/${selected}?hours=36`).then(setHist).catch(() => {});
  }, [simTime, selected]);

  if (!live) return <div className="space-y-4">{!online && <OfflineBanner />}<p className="text-sm text-fg-faint">Loading live feed…</p></div>;

  const open = (id) => navigate(`/hotspots/${id}`);
  const ranked = [...live.hotspots].sort((a, b) =>
    (LEVEL_RANK[b.assessment?.level] - LEVEL_RANK[a.assessment?.level]) || ((b.assessment?.probs['6h'] || 0) - (a.assessment?.probs['6h'] || 0)));
  const atWarning = live.hotspots.filter((h) => LEVEL_RANK[h.assessment?.level] >= 2).length;
  const c = live.city;
  const labels = hist?.time.map(hhmm) || [];

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
        <SensorTile icon="rain" label="Rainfall (city)" value={c.rain_mmhr} unit="mm/h"
          sub={`Forecast ${Math.round(Math.max(...live.hotspots.map((h) => h.sensors.rain_fcst_3h)))} mm in 3 h`} />
        <SensorTile icon="waves" label="Tide" value={c.tide_m} unit="m"
          sub={`${c.tide_trend === 'rising' ? '▲' : '▼'} ${c.next_high ? `high ${c.next_high.height_m} m in ${fmtHours(c.next_high.in_h)}` : c.tide_trend}`} />
        <SensorTile icon="layers" label="Miri River" value={c.river_m} unit="m"
          sub={`${c.river_trend >= 0 ? '+' : ''}${c.river_trend} m in the last hour`} tone={c.river_m >= 2.8 ? 'warning' : undefined} />
        <SensorTile icon="drop" label="Highest drain level" value={c.max_drain_pct} unit="%"
          tone={c.max_drain_pct >= 80 ? 'danger' : c.max_drain_pct >= 60 ? 'warning' : undefined}
          sub="Smart Drain sensors" />
        <SensorTile icon="alert" label="Warning or above" value={atWarning} unit={`/ ${live.hotspots.length}`}
          tone={atWarning ? 'danger' : 'success'} sub="any horizon ≥ 50%" />
        <button type="button" className="text-left" onClick={() => navigate('/alerts')}>
          <SensorTile icon="bell" label="Alerts to approve" value={pendingAlerts.length} unit="drafts"
            tone={pendingAlerts.length ? 'warning' : undefined} sub="Open Alert Centre" />
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card overflow-hidden flex flex-col">
          <div className="card-header">
            <div className="flex-1">
              <h3 className="card-title">Flood risk map</h3>
              <p className="card-subtitle">Highest level across +1/+3/+6 h. Click a hotspot for its forecast.</p>
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
        <Card title="Hotspots" subtitle="Ranked by risk" padded={false}
          actions={<Button size="sm" variant="ghost" onClick={() => open(selected)}>Open</Button>}>
          {ranked.map((h) => <HotspotRow key={h.id} h={h} selected={selected === h.id} onSelect={setSelected} onOpen={open} />)}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3"><ForecastTimeline hotspots={ranked} onOpen={open} /></div>
        <Card title="Operations log" subtitle="Level changes, drafts and field reports" className="xl:col-span-2" bodyClassName="max-h-[330px] overflow-y-auto">
          <ul className="space-y-3">
            {live.events.slice(0, 25).map((e) => (
              <li key={e.id} className="flex gap-2.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: `var(--color-${e.tone})` }} />
                <div className="min-w-0">
                  <p className="font-semibold text-fg leading-snug">{e.title}</p>
                  <p className="text-fg-muted leading-snug">{e.message}</p>
                  <p className="text-[10px] text-fg-faint mt-0.5 font-mono">{e.sim_time.replace('T', ' ').slice(0, 16)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {hist && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title={`Rainfall: ${live.hotspots.find((h) => h.id === selected)?.name}`}
            subtitle="mm per hour, last 36 h"
            type="bar" height={180}
            data={{ labels, datasets: [{ label: 'Rain (mm/h)', data: hist.rain, color: 'chart-1' }] }}
          />
          <ChartCard
            title="Tide and Miri River"
            subtitle="metres, last 36 h"
            legend height={180}
            data={{
              labels,
              datasets: [
                { label: 'Tide (m)', data: hist.tide, color: 'chart-2', fill: false },
                { label: 'Miri River (m)', data: hist.river, color: 'chart-3', fill: false },
              ],
            }}
            thresholds={[{ value: 2.0, tone: 'watch', label: 'High tide', description: '≥ 2.0 m' }]}
          />
        </div>
      )}
    </div>
  );
}
