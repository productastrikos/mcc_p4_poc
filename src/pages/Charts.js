import React, { useEffect, useState } from 'react';
import { PageHeader, Tabs, StatCard, StatGrid, Card, Badge, ProgressBar, Field, Icon } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import { TIMEFRAMES } from '../components/charts/chartTheme';
import { MONTHLY_SERIES, CATEGORY_SPLIT, GOALS, PIPELINE, UNITS } from '../data/sampleData';
import { STATUS, loadTone } from '../utils';

const GOAL_STATUS = {
  'on-track':  { label: 'On track',  tone: 'success' },
  'at-risk':   { label: 'At risk',   tone: 'warning' },
  'completed': { label: 'Completed', tone: 'primary' },
};
const UNIT_STATUS = {
  online:  { label: 'Online',  tone: 'success' },
  warning: { label: 'Warning', tone: 'warning' },
  offline: { label: 'Offline', tone: 'danger' },
};

function TrendsTab() {
  const [view, setView] = useState('Trend');
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Overall Score" value={84} unit="/ 100" icon="leaf" trend={6.2} />
        <StatCard label="Year on Year" value={12.4} unit="%" icon="trendUp" />
        <StatCard label="Gap to Target" value={1} unit="pts" icon="shield" status="warning" />
        <StatCard label="Active Goals" value={GOALS.filter((g) => g.status !== 'completed').length} icon="globe" />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          {view === 'Trend' ? (
            <ChartCard
              title="Performance Trend"
              legend
              height={260}
              yMax={100}
              actions={<Tabs size="sm" tabs={['Trend', 'Breakdown']} value={view} onChange={setView} />}
              data={{
                labels: MONTHLY_SERIES.labels,
                datasets: [
                  { label: 'Series A', data: MONTHLY_SERIES.seriesA, color: 'success' },
                  { label: 'Series B', data: MONTHLY_SERIES.seriesB, color: 'danger' },
                ],
              }}
              thresholds={[{ value: 85, tone: 'warning', label: 'Target', description: '85' }]}
            />
          ) : (
            <ChartCard
              title="Category Breakdown"
              type="doughnut"
              legend
              height={260}
              actions={<Tabs size="sm" tabs={['Trend', 'Breakdown']} value={view} onChange={setView} />}
              data={{ labels: CATEGORY_SPLIT.labels, datasets: [{ data: CATEGORY_SPLIT.values }] }}
            />
          )}
        </div>

        <Card title="Goals" padded={false}>
          {GOALS.map((g) => {
            const s = GOAL_STATUS[g.status];
            return (
              <div key={g.name} className="px-4 py-3 border-b last:border-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-fg">{g.name}</span>
                  <Badge tone={s.tone} plain>{s.label.toUpperCase()}</Badge>
                </div>
                <ProgressBar value={g.progress} tone={s.tone} />
                <div className="flex justify-between text-[10px] text-fg-faint mt-1">
                  <span>{g.progress}% of target {g.target}</span><span>Due {g.due}</span>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

function PipelineTab() {
  const first = PIPELINE[0].items;
  const last = PIPELINE[PIPELINE.length - 1].items;
  const avg = Math.round(PIPELINE.reduce((s, p) => s + p.throughput, 0) / PIPELINE.length);

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Items In" value={first} icon="barChart" />
        <StatCard label="Items Out" value={last} icon="check" trend={4.1} />
        <StatCard label="Backlog" value={first - last} icon="hourglass" status="warning" />
        <StatCard label="Avg Throughput" value={avg} unit="%" icon="gauge" status={avg < 80 ? 'warning' : 'normal'} />
      </StatGrid>

      {/* Step cards with connectors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {PIPELINE.map((step, i) => {
          const s = STATUS[step.status];
          return (
            <Card key={step.id} className="relative overflow-visible">
              {i < PIPELINE.length - 1 && (
                <Icon name="chevronRight" size={16} className="hidden lg:block absolute -right-[18px] top-1/2 -translate-y-1/2 text-fg-faint" />
              )}
              <div className="flex items-center justify-between mb-2">
                <span className="label-caps">{step.id}</span>
                <Badge tone={s.tone} dot plain>{s.label}</Badge>
              </div>
              <p className="text-sm font-bold text-fg mb-3">{step.name}</p>
              <div className="space-y-2">
                <Field label="Items">{step.items}</Field>
                <ProgressBar value={step.items} max={first} tone={s.tone} />
                <Field label="Throughput">{step.throughput}%</Field>
                <Field label="Avg time">{step.avgTime}</Field>
              </div>
            </Card>
          );
        })}
      </div>

      <ChartCard
        title="Items per Step"
        type="bar"
        height={220}
        data={{ labels: PIPELINE.map((p) => p.name), datasets: [{ label: 'Items', data: PIPELINE.map((p) => p.items), color: PIPELINE.map((p) => STATUS[p.status].tone) }] }}
      />
    </div>
  );
}

function makeSeries(base, variance, length) {
  return Array.from({ length }, (_, i) => +(base + Math.sin(i * 0.4) * variance + (Math.random() - 0.5) * variance * 0.5).toFixed(1));
}

function LiveTab() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000); // simulated refresh
    return () => clearInterval(id);
  }, []);

  const output = UNITS.reduce((s, u) => s + u.output, 0);
  const capacity = UNITS.reduce((s, u) => s + u.capacity, 0);
  const online = UNITS.filter((u) => u.status === 'online');
  const avgUptime = (online.reduce((s, u) => s + u.uptime, 0) / Math.max(online.length, 1)).toFixed(1);
  const warnings = UNITS.filter((u) => u.status === 'warning').length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Total Output" value={output} unit="units" icon="bolt" trend={3.4} />
        <StatCard label="Online" value={`${online.length}/${UNITS.length}`} icon="check" />
        <StatCard label="Avg Uptime" value={avgUptime} unit="%" icon="signal" />
        <StatCard label="Warnings" value={warnings} icon="thermometer" status={warnings ? 'warning' : 'normal'} />
      </StatGrid>

      <ChartCard
        title="Output vs Capacity"
        actions={<Badge tone="success" dot>LIVE</Badge>}
        legend
        height={220}
        timeframes={TIMEFRAMES.intraday}
        data={{ labels: [], datasets: [{ label: 'Output', data: makeSeries(output, 8, 24), color: 'chart-5' }] }}
        thresholds={[{ value: capacity, tone: 'warning', label: 'Capacity', description: `${capacity} units` }]}
        yMax={capacity + 10}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {UNITS.map((u) => {
          const s = UNIT_STATUS[u.status];
          const pct = (u.output / u.capacity) * 100;
          return (
            <Card key={u.id}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="label-caps">{u.id}</p>
                  <p className="text-sm font-bold text-fg mt-0.5">{u.name}</p>
                </div>
                <Badge tone={s.tone} dot>{s.label}</Badge>
              </div>
              <div className="space-y-2">
                <Field label="Output">{u.output} / {u.capacity}</Field>
                <ProgressBar value={pct} tone={loadTone(pct, 60, 80)} />
                <Field label="Uptime">{u.uptime ? `${u.uptime}%` : '—'}</Field>
                <Field label="Temperature">
                  <span className={u.temp > 90 ? 'text-danger' : u.temp > 80 ? 'text-warning' : 'text-success'}>{u.temp}°</span>
                </Field>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const TABS = { Trends: TrendsTab, Pipeline: PipelineTab, Live: LiveTab };

export default function Charts() {
  const [tab, setTab] = useState('Trends');
  const Tab = TABS[tab];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Charts"
        subtitle="Line, bar and doughnut charts, progress lists, step cards and a live-refresh view"
        actions={<Tabs tabs={Object.keys(TABS)} value={tab} onChange={setTab} />}
      />
      <Tab />
    </div>
  );
}
