import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, FilterChips, PageHeader } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import RiskMap from '../components/flood/RiskMap';
import CausePanel from '../components/flood/CausePanel';
import { AiTag, ForecastCells, LevelBadge, MechanismBadge, OfflineBanner } from '../components/flood/bits';
import { useData } from '../data/DataProvider';
import { api } from '../services/api';
import { LEVEL_RANK, LEVELS } from '../utils';

function HydraulicLine({ hyd }) {
  if (!hyd) return null;
  const at = (k) => (k === 0 ? 'now' : `+${k} h`);
  return hyd.first_flood_hour != null
    ? <p className="text-[10.5px] text-danger">Twin: floods {at(hyd.first_flood_hour)}, peak {hyd.peak_depth_cm} cm at {at(hyd.peak_hour)}</p>
    : <p className="text-[10.5px] text-fg-faint">Twin: no flooding (peak {hyd.peak_depth_cm} cm)</p>;
}

const PRESETS = {
  'high-tide-storm': { label: 'Storm at high tide', rain_mmhr: 40, duration_h: 3, tide_m: 2.5, hours_to_high: 1.5, antecedent_mm: 0 },
  cloudburst: { label: 'Cloudburst at low tide', rain_mmhr: 90, duration_h: 2, tide_m: 1.3, hours_to_high: 6.5, antecedent_mm: 0 },
  monsoon: { label: 'Monsoon soak', rain_mmhr: 18, duration_h: 12, tide_m: 2.2, hours_to_high: 3, antecedent_mm: 200 },
  'king-tide': { label: 'King tide, light rain', rain_mmhr: 8, duration_h: 3, tide_m: 2.9, hours_to_high: 1, antecedent_mm: 0 },
  calm: { label: 'Calm', rain_mmhr: 0, duration_h: 0, tide_m: 1.8, hours_to_high: 4, antecedent_mm: 0 },
};

function Slider({ label, value, onChange, min, max, step, unit, hint, format = (v) => v }) {
  return (
    <label className="block space-y-1.5">
      <div className="slider-row">
        <span className="label-caps">{label}</span>
        <span className="slider-value">{format(value)}<span className="text-[11px] font-medium text-fg-faint ml-1">{unit}</span></span>
      </div>
      <input type="range" className="slider" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={label} />
      {hint && <p className="text-[10.5px] text-fg-faint">{hint}</p>}
    </label>
  );
}

export default function Simulator() {
  const navigate = useNavigate();
  const { online, notify, refreshAlerts } = useData();
  const [params, setParams] = useState(() => {
    const { label, ...p } = PRESETS['high-tide-storm'];
    return p;
  });
  const [preset, setPreset] = useState('high-tide-storm');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState('pujut-adong');
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  // Re-forecast on every change (debounced); ignore out-of-order responses.
  useEffect(() => {
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/api/simulate', params);
        if (id === reqId.current) setResult(r);
      } catch (e) { /* offline banner covers it */ }
    }, 120);
    return () => clearTimeout(t);
  }, [params]);

  const set = (k) => (v) => { setPreset(null); setParams((p) => ({ ...p, [k]: v })); };
  const applyPreset = (key) => { const { label, ...p } = PRESETS[key]; setPreset(key); setParams(p); };

  const hotspots = result?.hotspots || [];
  const sel = hotspots.find((h) => h.id === selected);
  const counts = LEVELS.map((l) => ({ ...l, n: hotspots.filter((h) => h.assessment.level === l.name).length }));
  const warnPlus = hotspots.filter((h) => LEVEL_RANK[h.assessment.level] >= 2);

  const draft = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/simulate/draft', params);
      refreshAlerts();
      notify(r.created.length ? `${r.created.length} exercise alert draft(s) created. Review them in the Alert Centre.` : 'No hotspot is at Warning or above in this scenario.',
        r.created.length ? 'success' : 'info');
      if (r.created.length) navigate('/alerts');
    } catch (e) { notify(e.message, 'danger'); } finally { setBusy(false); }
  };

  const city = result?.city;
  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title="Scenario Simulator"
        subtitle="Plan before the storm: set rainfall, tide and duration, and the model re-forecasts all six hotspots at once"
        actions={<Button variant="accent" icon="sparkles" onClick={draft} disabled={busy || !warnPlus.length}>
          Draft alerts for {warnPlus.length} hotspot{warnPlus.length === 1 ? '' : 's'}
        </Button>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        <Card title="Storm scenario" subtitle="The storm starts in the next hour" className="xl:sticky xl:top-0">
          <div className="space-y-5">
            <FilterChips options={Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))} value={preset} onChange={applyPreset} />
            <Slider label="Rainfall intensity" value={params.rain_mmhr} onChange={set('rain_mmhr')} min={0} max={120} step={1} unit="mm/hr"
              hint="City average; local rates vary by hotspot" />
            <Slider label="Storm duration" value={params.duration_h} onChange={set('duration_h')} min={0} max={12} step={1} unit="h" />
            <Slider label="High tide level" value={params.tide_m} onChange={set('tide_m')} min={0} max={3} step={0.05} unit="m"
              format={(v) => v.toFixed(2)} hint="Spring tides in Miri reach about 2.4 m; storm surge adds more" />
            <Slider label="High tide arrives in" value={params.hours_to_high} onChange={set('hours_to_high')} min={-3} max={9} step={0.5} unit="h"
              format={(v) => (v < 0 ? `${-v} h ago` : v)} hint="Negative = high tide has just passed" />
            <Slider label="Rain in the past day" value={params.antecedent_mm} onChange={set('antecedent_mm')} min={0} max={250} step={5} unit="mm"
              hint="Fills the Miri River before the storm (riverside sites)" />
            <div className="tile text-[11px] text-fg-muted leading-relaxed">
              Total storm rain ≈ <b className="text-fg">{Math.round(params.rain_mmhr * params.duration_h)} mm</b> (city average; local
              rates are 0–20% higher). Readings at storm onset come from the hydraulic model; the forecasts come from the trained ML model.
            </div>
          </div>
        </Card>

        <div className="xl:col-span-3 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {counts.map((l) => (
              <span key={l.name} className={`badge tone-${l.tone}`} style={{ fontSize: 11, padding: '4px 10px' }}>{l.name}: {l.n}</span>
            ))}
            <span className="text-[11px] text-fg-faint ml-1">{result ? 'Levels are the ML forecast at storm onset; “Twin” is the hydraulic model run through the storm' : 'Calculating…'}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 card overflow-hidden">
              <RiskMap hotspots={hotspots} selectedId={selected} onSelect={setSelected} height={360} labels={false} />
            </div>
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {hotspots.map((h) => (
                <button key={h.id} type="button" onClick={() => setSelected(h.id)}
                  className={`card text-left p-3 space-y-2 transition-colors ${selected === h.id ? 'border-primary' : ''}`}
                  style={selected === h.id ? { borderColor: 'var(--color-primary)' } : undefined}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-fg truncate">{h.name}</span>
                    <LevelBadge level={h.assessment.level} />
                  </div>
                  <ForecastCells probs={h.assessment.probs} compact />
                  <MechanismBadge mechanism={h.assessment.mechanism} depth={h.assessment.water_depth_cm} />
                  <HydraulicLine hyd={h.hydraulic} />
                </button>
              ))}
            </div>
          </div>

          {sel && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title={sel.name} subtitle="Why the model expects this" actions={<LevelBadge level={sel.assessment.level} />}>
                <CausePanel assessment={sel.assessment} />
              </Card>
              <ChartCard
                title="Risk through the storm"
                subtitle={`${sel.name}: the forecast re-run each hour as the scenario unfolds (hour 0 = now)`}
                legend height={250} yMax={100}
                actions={<AiTag>Model</AiTag>}
                data={{
                  labels: sel.timeline.hour.map((x) => (x === 0 ? 'Now' : `+${x}h`)),
                  datasets: [
                    { label: 'Flood within 1 h', data: sel.timeline.p1.map((v) => v * 100), color: 'chart-5', fill: false },
                    { label: 'Flood within 3 h', data: sel.timeline.p3.map((v) => v * 100), color: 'primary', fill: false, borderWidth: 2.5 },
                    { label: 'Flood within 6 h', data: sel.timeline.p6.map((v) => v * 100), color: 'chart-8', fill: false, borderDash: [5, 3] },
                  ],
                }}
                thresholds={[
                  { value: 25, tone: 'info', label: 'Watch' },
                  { value: 50, tone: 'warning', label: 'Warning' },
                  { value: 75, tone: 'danger', label: 'Danger' },
                ]}
              />
            </div>
          )}

          {city && sel && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ChartCard title="Scenario rainfall" subtitle="City average, mm/hr" type="bar" height={170}
                data={{ labels: city.hour.map((x) => (x === 0 ? 'Now' : x > 0 ? `+${x}h` : `${x}h`)), datasets: [{ label: 'Rain (mm/h)', data: city.rain, color: 'chart-1' }] }} />
              <ChartCard title="Scenario tide and river" subtitle="metres" legend height={170}
                data={{
                  labels: city.hour.map((x) => (x === 0 ? 'Now' : x > 0 ? `+${x}h` : `${x}h`)),
                  datasets: [
                    { label: 'Tide', data: city.tide, color: 'chart-2', fill: false },
                    { label: 'Miri River', data: city.river, color: 'chart-3', fill: false },
                  ],
                }} />
              <ChartCard title="Hydraulic check (twin)" subtitle={`${sel.name}: simulated road water depth, cm`} height={170}
                data={{
                  labels: sel.timeline.hour.map((x) => (x === 0 ? 'Now' : `+${x}h`)),
                  datasets: [{ label: 'Road water (cm)', data: sel.timeline.depth, color: 'danger' }],
                }}
                thresholds={[{ value: 10, tone: 'danger', label: 'Flooded', description: '≥ 10 cm' }]} />
            </div>
          )}
          {warnPlus.length > 0 && (
            <div className="tile tone-accent text-xs flex items-center gap-2 flex-wrap">
              <Badge tone="accent">Gen-AI</Badge>
              {warnPlus.length} hotspot{warnPlus.length === 1 ? ' is' : 's are'} at Warning or above. Draft bilingual Miri CARES alerts and
              MSCCC checklists for them, marked as exercises.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
