import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, DataTable, PageHeader, Tabs } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import { MechanismBadge, OfflineBanner, SensorTile } from '../components/flood/bits';
import { useData } from '../data/DataProvider';
import { api } from '../services/api';

const H_TABS = [{ value: '1', label: '+1 h' }, { value: '3', label: '+3 h' }, { value: '6', label: '+6 h' }];
const GROUP_COLOR = { Rain: 'chart-1', Tide: 'chart-2', River: 'chart-3', Drain: 'chart-4', Surface: 'chart-6', Site: 'chart-8' };
const num = (v, d = 3) => (v == null ? '–' : Number(v).toFixed(d));

function MetricsTable({ m }) {
  const rows = [
    { id: 'gb', name: 'FloodSense (gradient boosting)', ...m },
    { id: 'rf', name: 'Random forest (comparison)', ...m.random_forest },
    { id: 'base', name: 'Reactive rule: drain ≥ 90%', ...m.baseline_drain90 },
  ];
  return (
    <DataTable rowKey="id" rows={rows} columns={[
      { key: 'name', header: 'Method', strong: true, render: (r) => (r.id === 'gb' ? <span className="text-primary font-semibold">{r.name}</span> : r.name) },
      { key: 'roc_auc', header: 'ROC-AUC', render: (r) => (r.id === 'base' ? '–' : num(r.roc_auc, 4)) },
      { key: 'pr_auc', header: 'PR-AUC', render: (r) => (r.id === 'base' ? '–' : num(r.pr_auc)) },
      { key: 'precision', header: 'Precision', render: (r) => num(r.precision, 2) },
      { key: 'recall', header: 'Recall', render: (r) => num(r.recall, 2) },
      { key: 'f1', header: 'F1', render: (r) => num(r.f1, 2) },
      { key: 'brier', header: 'Brier', render: (r) => (r.id === 'base' ? '–' : num(r.brier, 4)) },
    ]} />
  );
}

export default function ModelPage() {
  const navigate = useNavigate();
  const { online, control } = useData();
  const [m, setM] = useState(null);
  const [h, setH] = useState('3');

  useEffect(() => { api.get('/api/model').then(setM).catch(() => {}); }, []);
  if (!m) return <div className="space-y-4">{!online && <OfflineBanner />}<p className="text-sm text-fg-faint">Loading model report…</p></div>;

  const hm = m.horizons[h];
  const imp = Object.entries(m.importance[h]).sort((a, b) => b[1] - a[1]);
  const lead = m.lead_time;
  const fa = m.false_alarms;
  const calib = m.calibration_3h;
  const testStart = new Date(m.test_period[0]);

  const replay = async (eventId) => {
    await control('replay', { event_id: eventId });
    navigate('/');
  };

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title="Model Performance"
        subtitle={`Flood forecasts scored on a held-out year (${m.test_period[0].slice(0, 10)} to ${m.test_period[1].slice(0, 10)}) that the model never saw in training`}
        actions={<Tabs tabs={H_TABS} value={h} onChange={setH} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <SensorTile icon="analytics" label={`PR-AUC +${h}h`} value={num(hm.pr_auc, 2)} unit="" sub={`ROC-AUC ${num(hm.roc_auc, 4)}`} />
        <SensorTile icon="check" label={`Recall +${h}h`} value={Math.round(hm.recall * 100)} unit="%" sub={`Precision ${Math.round(hm.precision * 100)}%`} />
        <SensorTile icon="clock" label="Warning lead time" value={lead.ai_warning.mean_lead_h} unit="h"
          sub={`Reactive rule: ${lead.baseline_drain90.mean_lead_h} h`} tone="success" />
        <SensorTile icon="shield" label="Onsets warned" value={`${lead.ai_warning.warned}/${lead.ai_warning.onsets}`} unit=""
          sub={`Reactive rule: ${lead.baseline_drain90.warned}/${lead.baseline_drain90.onsets}`} />
        <SensorTile icon="bell" label="False alarms" value={fa.ai_warning.false_alarms_per_month} unit="/ month"
          sub={`Reactive rule: ${fa.baseline_drain90.false_alarms_per_month}/mo`} />
        <SensorTile icon="history" label="Flood events" value={m.events.total} unit="" sub={`${m.events.train} train · ${m.events.test} test`} />
      </div>

      <Card title={`Accuracy at +${h} h`} subtitle="Hotspot-hours in the test year. Precision, recall and F1 at the Warning threshold (50%)." padded={false}>
        <MetricsTable m={hm} />
        <div className="px-4 py-3 border-t text-[11px] text-fg-faint flex flex-wrap gap-x-6 gap-y-1">
          <span>True positives <b className="text-fg">{hm.confusion.tp}</b></span>
          <span>False positives <b className="text-fg">{hm.confusion.fp}</b></span>
          <span>Missed <b className="text-fg">{hm.confusion.fn}</b></span>
          <span>True negatives <b className="text-fg">{hm.confusion.tn.toLocaleString()}</b></span>
          <span>Accuracy <b className="text-fg">{(hm.accuracy * 100).toFixed(2)}%</b> (floods are rare, so accuracy alone flatters any model)</span>
          <span className="basis-full">These scores include hours when the road is already flooded, which are easy to call from the water-on-road reading. The fair test of early warning is the lead time and onsets warned above, which only count the hours before each flood began.</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title={`Feature importance, +${h} h`}
          subtitle="Permutation importance on the test year: how much PR-AUC drops when a feature is shuffled"
          type="bar" height={340}
          options={{ indexAxis: 'y' }}
          data={{
            labels: imp.map(([f]) => m.feature_labels[f]),
            datasets: [{ label: 'Share of importance', data: imp.map(([, v]) => +(v * 100).toFixed(1)), color: imp.map(([f]) => GROUP_COLOR[m.feature_groups[f]]) }],
          }}
          actions={<div className="hidden md:flex gap-3">{Object.entries(GROUP_COLOR).map(([g, c]) => (
            <span key={g} className="flex items-center gap-1 text-[10px] text-fg-muted"><span className="w-2 h-2 rounded-sm" style={{ background: `var(--${c})` }} />{g}</span>
          ))}</div>}
        />
        <div className="space-y-4">
          <ChartCard
            title="Warning lead time"
            subtitle={`Mean hours of warning before flooding began, over ${lead.ai_warning.onsets} flood onsets in the test year`}
            type="bar" height={150}
            options={{ indexAxis: 'y' }}
            data={{
              labels: ['FloodSense: Warning', 'FloodSense: Watch', 'Reactive: drain ≥ 90%'],
              datasets: [{ label: 'Mean lead time (h)', data: [lead.ai_warning.mean_lead_h, lead.ai_watch.mean_lead_h, lead.baseline_drain90.mean_lead_h], color: ['primary', 'info', 'neutral'] }],
            }}
          />
          <ChartCard
            title="Calibration, +3 h"
            subtitle="Observed flood rate against forecast probability (closer to the diagonal is better)"
            legend height={170} yMax={100}
            data={{
              labels: calib.map((c) => `${Math.round(c.pred * 100)}%`),
              datasets: [
                { label: 'Observed %', data: calib.map((c) => +(c.obs * 100).toFixed(1)), color: 'primary', fill: false, pointRadius: 3 },
                { label: 'Perfect calibration', data: calib.map((c) => +(c.pred * 100).toFixed(1)), color: 'neutral', fill: false, borderDash: [4, 4] },
              ],
            }}
          />
        </div>
      </div>

      <Card title="Flood event catalogue" subtitle="Events in the synthetic two-year history. Replay one to see what the dashboard would have shown." padded={false}>
        <DataTable rowKey="event_id" rows={m.flood_events} columns={[
          { key: 'event_id', header: 'Event', strong: true },
          { key: 'start', header: 'Start', render: (r) => r.start.replace('T', ' ').slice(0, 16) },
          { key: 'split', header: 'Set', render: (r) => (new Date(r.start) >= testStart ? <Badge tone="info">TEST</Badge> : <Badge tone="neutral">TRAIN</Badge>) },
          { key: 'duration_h', header: 'Hours', render: (r) => r.duration_h },
          { key: 'n_hotspots', header: 'Hotspots', render: (r) => r.n_hotspots },
          { key: 'mechanism', header: 'Mechanism', render: (r) => <MechanismBadge mechanism={r.mechanism} /> },
          { key: 'peak_rain_mmhr', header: 'Peak rain', render: (r) => `${r.peak_rain_mmhr} mm/h` },
          { key: 'max_tide_m', header: 'Max tide', render: (r) => `${r.max_tide_m} m` },
          { key: 'max_river_m', header: 'Max river', render: (r) => `${r.max_river_m} m` },
          { key: 'peak_depth_cm', header: 'Peak depth', render: (r) => `${Math.round(r.peak_depth_cm)} cm` },
          { key: 'replay', header: '', render: (r) => <Button size="sm" variant="soft" icon="history" onClick={() => replay(r.event_id)}>Replay</Button> },
        ]} />
      </Card>

      <Card title="How the models work" subtitle={`Trained ${m.trained_at.replace('T', ' ')} in ${m.train_seconds} s`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs text-fg-muted leading-relaxed">
          <p><b className="text-fg">Data.</b> Two years of hourly synthetic readings for six hotspots ({m.rows.history_train.toLocaleString()} training and {m.rows.test.toLocaleString()} test rows) from a hydrology model of tides, the Miri River, Smart Drains and surface ponding, with {m.events.total} flood events including the large January 2025 event. Training adds {m.rows.design_storm_episodes.toLocaleString()} simulated design storms ({m.rows.design_storms.toLocaleString()} rows) so the simulator's full slider range is covered.</p>
          <p><b className="text-fg">Forecasting.</b> {m.algorithm}. One model per horizon predicts the probability that a hotspot floods (road water ≥ 10 cm) within 1, 3 or 6 hours, from {m.features.length} inputs including the water already on the road (Smart Drain above-rim gauge). Risk only rises with forecast rain, tide, drain level and road water. A road that is flooded now is always shown at Danger.</p>
          <p><b className="text-fg">Explanations.</b> For each forecast, exact Shapley values over six factor groups (rain now, rain forecast, tide, river, drain, road water) show what drives the risk, and what-if checks re-run the model with one factor set to normal.</p>
          <p><b className="text-fg">Mechanism.</b> Tidal Backflow when a tidal-outfall site has high tide (≥ 2.0 m) within the horizon and the drain is projected above 80%; River Overflow when a riverside site has the Miri River at its 2.8 m alert level or forecast to pass it; Combined when both apply or rain is extreme; otherwise Rainfall Overload. Water still standing after the rain keeps the cause of the event that put it there.</p>
          <p><b className="text-fg">CCTV.</b> A vision model classifies frames as Normal, Rising, Overflowing or Road Flooded. The reading updates the forecast odds, weighted by its confidence, for 30 minutes.</p>
          <p><b className="text-fg">Limits.</b> All data is synthetic, so these scores show the pipeline works, not how it will perform in Miri. Retrain and re-validate on MCC's Smart Drain, tide gauge and rainfall records before operational use.</p>
        </div>
      </Card>
    </div>
  );
}
