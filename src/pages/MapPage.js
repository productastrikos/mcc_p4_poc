import React, { useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Circle } from 'react-leaflet';
import { PageHeader, StatCard, StatGrid, Card, Badge, Button } from '../components/ui';
import { MAP_CENTER, MAP_POINTS } from '../data/sampleData';
import { resolveColor } from '../components/charts/chartTheme';
import { useTheme } from '../theme/ThemeProvider';

const STATUS = {
  online:  { label: 'Online',  tone: 'success' },
  warning: { label: 'Warning', tone: 'warning' },
  offline: { label: 'Offline', tone: 'danger' },
};
const LAYERS = [...new Set(MAP_POINTS.map((p) => p.layer))];
// Leaflet needs concrete colour values, so theme tokens are resolved here.
const color = (status) => resolveColor(STATUS[status].tone);

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex items-center gap-3 w-full">
      <span className="w-9 h-5 rounded-full flex items-center px-0.5 border transition-colors" style={{ background: on ? 'var(--color-primary)' : 'var(--color-surface-raised)' }}>
        <span className="w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(16px)' : 'none' }} />
      </span>
      <span className="text-xs font-medium text-fg">{label}</span>
    </button>
  );
}

export default function MapPage() {
  const { theme } = useTheme();
  const [layers, setLayers] = useState([...LAYERS, 'Radius']);
  const [selected, setSelected] = useState(null);
  const toggle = (l) => setLayers((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));

  const visible = MAP_POINTS.filter((p) => layers.includes(p.layer));
  const count = (s) => MAP_POINTS.filter((p) => p.status === s).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Map" subtitle="Points with status colours, layer toggles and a selection panel" />

      <StatGrid>
        <StatCard label="Points" value={MAP_POINTS.length} icon="globe" />
        <StatCard label="Online" value={count('online')} icon="signal" />
        <StatCard label="Warnings" value={count('warning')} icon="pin" status={count('warning') ? 'warning' : 'normal'} />
        <StatCard label="Offline" value={count('offline')} icon="alert" status={count('offline') ? 'critical' : 'normal'} />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card title="Layers" bodyClassName="space-y-3">
          {[...LAYERS, 'Radius'].map((l) => <Toggle key={l} label={l} on={layers.includes(l)} onChange={() => toggle(l)} />)}

          <div className="pt-3 border-t space-y-2">
            <p className="label-caps">Legend</p>
            {Object.values(STATUS).map((s) => <div key={s.label}><Badge tone={s.tone} dot plain>{s.label}</Badge></div>)}
          </div>

          {selected && (
            <div className="pt-3 border-t space-y-1">
              <p className="label-caps">Selected</p>
              <p className="text-sm font-semibold text-fg">{selected.label}</p>
              <p className="text-xs text-fg-faint">{selected.id} · {selected.layer}</p>
              <Badge tone={STATUS[selected.status].tone} dot>{STATUS[selected.status].label}</Badge>
              <div><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Clear</Button></div>
            </div>
          )}
        </Card>

        <div className="lg:col-span-3 card overflow-hidden" style={{ height: 480 }}>
          <MapContainer center={MAP_CENTER} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {layers.includes('Radius') && visible.filter((p) => p.status === 'online').map((p) => (
              <Circle key={`r-${p.id}-${theme}`} center={[p.lat, p.lng]} radius={300}
                pathOptions={{ color: color(p.status), fillColor: color(p.status), fillOpacity: 0.06, weight: 1 }} />
            ))}
            {visible.map((p) => (
              <CircleMarker key={`${p.id}-${theme}`} center={[p.lat, p.lng]} radius={8}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: color(p.status), fillOpacity: 1 }}
                eventHandlers={{ click: () => setSelected(p) }}>
                <Popup><strong>{p.label}</strong><br />{STATUS[p.status].label}{p.value > 0 && <> · {p.value}%</>}</Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
