import React, { useState } from 'react';
import { PageHeader, StatCard, StatGrid, Card, Tabs, DataTable, Badge, Modal, DetailGrid, Button } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import { ITEMS } from '../data/sampleData';

const STATUS = {
  open:     { label: 'Open',        tone: 'danger' },
  progress: { label: 'In progress', tone: 'info' },
  closed:   { label: 'Closed',      tone: 'success' },
};
const PRIORITY = { high: 'danger', medium: 'warning', low: 'neutral' };
const FILTERS = [
  { value: 'all', label: 'All' },
  ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
];

export default function ListDetail() {
  const [items, setItems] = useState(ITEMS);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const count = (s) => items.filter((i) => i.status === s).length;
  const rows = filter === 'all' ? items : items.filter((i) => i.status === filter);
  const categories = [...new Set(items.map((i) => i.category))];

  const closeItem = (id) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, status: 'closed' } : i)));
    setSelected(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="List & Detail"
        subtitle="Filtered list with a detail modal and actions"
        actions={<Button icon="plus">New item</Button>}
      />

      <StatGrid>
        <StatCard label="Total" value={items.length} icon="users" />
        <StatCard label="Open" value={count('open')} icon="phone" status={count('open') > 5 ? 'warning' : 'normal'} />
        <StatCard label="In Progress" value={count('progress')} icon="hourglass" />
        <StatCard label="Closed" value={count('closed')} icon="check" trend={8.3} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title="By Category"
          type="bar"
          legend
          height={240}
          data={{
            labels: categories,
            datasets: Object.entries(STATUS).map(([key, s]) => ({
              label: s.label,
              color: s.tone,
              data: categories.map((c) => items.filter((i) => i.category === c && i.status === key).length),
            })),
          }}
        />

        <Card className="xl:col-span-2" padded={false}>
          <Tabs variant="underline" tabs={FILTERS} value={filter} onChange={setFilter} />
          <DataTable
            rows={rows}
            onRowClick={setSelected}
            emptyText="Nothing here."
            columns={[
              { key: 'id', header: 'ID', mono: true },
              { key: 'subject', header: 'Subject', strong: true },
              { key: 'category', header: 'Category' },
              { key: 'status', header: 'Status', render: (i) => <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge> },
              { key: 'priority', header: 'Priority', render: (i) => <Badge tone={PRIORITY[i.priority]} plain>{i.priority.toUpperCase()}</Badge> },
              { key: 'requester', header: 'Requester' },
              { key: 'created', header: 'Created' },
            ]}
          />
        </Card>
      </div>

      {selected && (
        <Modal
          eyebrow={selected.id}
          title={selected.subject}
          onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Reassign</Button>
              <Button disabled={selected.status === 'closed'} onClick={() => closeItem(selected.id)}>Mark closed</Button>
            </>
          }
        >
          <DetailGrid items={[
            { label: 'Category', value: selected.category },
            { label: 'Status', value: <Badge tone={STATUS[selected.status].tone}>{STATUS[selected.status].label}</Badge> },
            { label: 'Priority', value: <Badge tone={PRIORITY[selected.priority]} plain>{selected.priority.toUpperCase()}</Badge> },
            { label: 'Requester', value: selected.requester },
            { label: 'Created', value: selected.created },
          ]} />
        </Modal>
      )}
    </div>
  );
}
