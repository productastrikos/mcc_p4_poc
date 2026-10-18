import React, { useState } from 'react';
import {
  PageHeader, Tabs, StatCard, StatGrid, Card, DataTable, Badge, ProgressBar,
  Modal, DetailGrid, FilterChips, Field, Button,
} from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import { TIMEFRAMES } from '../components/charts/chartTheme';
import { RECORDS, RESOURCES, CONTAINERS } from '../data/sampleData';
import { loadTone } from '../utils';

/* Status value → badge label + tone. Keep one map per data type. */
const RECORD_STATUS = {
  done:    { label: 'Done',        tone: 'success' },
  active:  { label: 'In progress', tone: 'info' },
  pending: { label: 'Pending',     tone: 'warning' },
  blocked: { label: 'Blocked',     tone: 'danger' },
};
const RESOURCE_STATUS = {
  online:      { label: 'Online',      tone: 'success' },
  idle:        { label: 'Idle',        tone: 'neutral' },
  maintenance: { label: 'Maintenance', tone: 'warning' },
  offline:     { label: 'Offline',     tone: 'danger' },
};
const PRIORITY = { high: 'danger', medium: 'warning', low: 'neutral' };

function RecordsTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const rows = RECORDS.filter((r) =>
    (status === 'all' || r.status === status) &&
    (!search || `${r.name} ${r.owner}`.toLowerCase().includes(search.toLowerCase())));
  const count = (s) => RECORDS.filter((r) => r.status === s).length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Total" value={RECORDS.length} icon="clipboard" />
        <StatCard label="Done" value={count('done')} icon="check" trend={5.2} />
        <StatCard label="Open" value={count('active') + count('pending')} icon="calendar" status="warning" />
        <StatCard label="Blocked" value={count('blocked')} icon="alert" status={count('blocked') ? 'critical' : 'normal'} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title="Activity by Category"
          type="bar"
          legend
          stacked
          height={240}
          timeframes={TIMEFRAMES.daily}
          data={{
            labels: [],
            datasets: [
              { label: 'Category A', data: [2, 1, 1, 2, 3, 2, 1], color: 'chart-1' },
              { label: 'Category B', data: [1, 1, 0, 1, 1, 1, 2], color: 'chart-3' },
              { label: 'Category C', data: [1, 0, 1, 1, 0, 1, 1], color: 'chart-4' },
            ],
          }}
        />
        <Card
          className="xl:col-span-2"
          padded={false}
          title="Records"
          actions={
            <>
              <input className="input" style={{ width: 180 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="select select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                {Object.entries(RECORD_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </>
          }
        >
          <DataTable
            rows={rows}
            emptyText="No records match the current filter."
            columns={[
              { key: 'id', header: 'ID', mono: true },
              { key: 'name', header: 'Name', strong: true },
              { key: 'category', header: 'Category' },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={RECORD_STATUS[r.status].tone}>{RECORD_STATUS[r.status].label}</Badge> },
              { key: 'priority', header: 'Priority', render: (r) => <Badge tone={PRIORITY[r.priority]} plain>{r.priority.toUpperCase()}</Badge> },
              { key: 'owner', header: 'Owner' },
              { key: 'updated', header: 'Updated' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function ResourcesTab() {
  const [selected, setSelected] = useState(null);
  const online = RESOURCES.filter((r) => r.status === 'online');
  const count = (s) => RESOURCES.filter((r) => r.status === s).length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Total" value={RESOURCES.length} icon="truck" />
        <StatCard label="Online" value={count('online')} icon="check" trend={2.1} />
        <StatCard label="Maintenance" value={count('maintenance')} icon="wrench" status="warning" />
        <StatCard label="Offline" value={count('offline')} icon="alert" status={count('offline') ? 'critical' : 'normal'} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title="Utilisation (online)"
          type="bar"
          height={240}
          yMax={100}
          data={{
            labels: online.map((r) => r.id),
            datasets: [{ label: 'Utilisation %', data: online.map((r) => r.utilization), color: online.map((r) => loadTone(r.utilization)) }],
          }}
        />
        <Card className="xl:col-span-2" padded={false} title="Resources" subtitle="Click a row for details">
          <DataTable
            rows={RESOURCES}
            onRowClick={setSelected}
            columns={[
              { key: 'id', header: 'ID', mono: true },
              { key: 'name', header: 'Name', strong: true },
              { key: 'type', header: 'Type' },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={RESOURCE_STATUS[r.status].tone} dot>{RESOURCE_STATUS[r.status].label}</Badge> },
              { key: 'location', header: 'Location' },
              {
                key: 'utilization', header: 'Utilisation',
                render: (r) => (r.utilization > 0 ? (
                  <div className="flex items-center gap-2">
                    <ProgressBar value={r.utilization} tone={loadTone(r.utilization)} className="w-16" />
                    <span>{r.utilization}%</span>
                  </div>
                ) : '—'),
              },
              { key: 'lastSeen', header: 'Last seen' },
            ]}
          />
        </Card>
      </div>

      {selected && (
        <Modal
          eyebrow={selected.id}
          title={selected.name}
          onClose={() => setSelected(null)}
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button><Button>Edit</Button></>}
        >
          <DetailGrid items={[
            { label: 'Type', value: selected.type },
            { label: 'Status', value: <Badge tone={RESOURCE_STATUS[selected.status].tone} dot>{RESOURCE_STATUS[selected.status].label}</Badge> },
            { label: 'Location', value: selected.location },
            { label: 'Utilisation', value: selected.utilization ? `${selected.utilization}%` : 'N/A' },
            { label: 'Last seen', value: selected.lastSeen },
          ]} />
        </Modal>
      )}
    </div>
  );
}

function ContainersTab() {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('capacity');

  const withPct = CONTAINERS.map((c) => {
    const pct = (c.used / c.capacity) * 100;
    return { ...c, pct, tone: loadTone(pct, 70, 90) };
  });
  const rows = withPct
    .filter((c) => filter === 'all' || c.tone === filter)
    .sort((a, b) => (sort === 'used' ? b.pct - a.pct : sort === 'daily' ? b.dailyIn - a.dailyIn : b.capacity - a.capacity));

  const totalCap = CONTAINERS.reduce((s, c) => s + c.capacity, 0);
  const totalUsed = CONTAINERS.reduce((s, c) => s + c.used, 0);
  const critical = withPct.filter((c) => c.tone === 'danger').length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Avg Used" value={((totalUsed / totalCap) * 100).toFixed(1)} unit="%" icon="box" trend={1.2} />
        <StatCard label="Daily Intake" value={CONTAINERS.reduce((s, c) => s + c.dailyIn, 0)} unit="items" icon="trendUp" />
        <StatCard label="Containers" value={CONTAINERS.length} icon="layers" />
        <StatCard label="Near Full" value={critical} icon="alert" status={critical ? 'critical' : 'normal'} />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          label="Level"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'success', label: 'Normal' }, { value: 'warning', label: 'Warning' }, { value: 'danger', label: 'Critical' }]}
        />
        <label className="ml-auto flex items-center gap-2">
          <span className="label-caps">Sort</span>
          <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="capacity">Capacity</option>
            <option value="used">% used</option>
            <option value="daily">Daily intake</option>
          </select>
        </label>
      </div>

      {/* Card grid example */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((c) => (
          <Card key={c.id} hoverable>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="label-caps">{c.id} · {c.category}</p>
                <p className="text-sm font-bold text-fg mt-0.5">{c.name}</p>
              </div>
              <Badge tone={c.tone}>{c.pct.toFixed(0)}%</Badge>
            </div>
            <ProgressBar value={c.pct} tone={c.tone} />
            <div className="flex justify-between text-[10px] text-fg-faint mt-1 mb-3">
              <span>{c.used} used</span><span>{c.capacity} total</span>
            </div>
            <div className="pt-2 border-t space-y-1">
              <Field label="Daily intake">{c.dailyIn} items</Field>
              <Field label="Updated">{c.updated}</Field>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const TABS = { Records: RecordsTab, Resources: ResourcesTab, Containers: ContainersTab };

export default function Tables() {
  const [tab, setTab] = useState('Records');
  const Tab = TABS[tab];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tables"
        subtitle="Filterable tables, clickable rows with a detail modal, and a card grid"
        actions={<Tabs tabs={Object.keys(TABS)} value={tab} onChange={setTab} />}
      />
      <Tab />
    </div>
  );
}
