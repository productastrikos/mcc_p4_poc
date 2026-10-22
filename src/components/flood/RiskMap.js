import React from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, Tooltip } from 'react-leaflet';
import { useTheme } from '../../theme/ThemeProvider';
import { resolveColor } from '../charts/chartTheme';
import { cm, levelTone } from '../../utils';
import { ForecastCells, LevelWithState, MechanismBadge } from './bits';
import { Button } from '../ui';

// Covers the six hotspots, from Taman Tunku in the south to Senadin in the north.
const BOUNDS = [[4.300, 113.975], [4.512, 114.05]];

// Standard OpenStreetMap tiles, as on the template's map page (no API key needed).
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Senadin / MCOT and Desa Senadin sit close together, so their labels split left and right.
const LABEL_LEFT = new Set(['senadin-mcot']);

function markerIcon(h, level, selected, color, flooding) {
  const pulse = level === 'Danger' || level === 'Warning'
    ? `<span class="risk-marker-pulse" style="background:${color}"></span>` : '';
  const pumps = h.response?.pumps?.length || 0;
  const extra = (flooding ? '<span class="risk-marker-flag is-flood" title="Flooding now">≈</span>' : '')
    + (pumps ? `<span class="risk-marker-flag is-pump" title="${pumps} mobile pump(s)">P${pumps > 1 ? pumps : ''}</span>` : '');
  return L.divIcon({
    className: '',
    iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14],
    html: `<div class="risk-marker ${selected ? 'is-selected' : ''} ${flooding ? 'is-flooding' : ''}">${pulse}<div class="risk-marker-dot" style="background:${color}">${h.short}</div>${extra}</div>`,
  });
}

/**
 * RiskMap: hotspots coloured by flood risk level.
 *   hotspots   [{ id, name, short, lat, lng, assessment: { level, probs, mechanism } }]
 *   selectedId highlights one marker; onSelect(id) on click; onOpen(id) from the popup
 */
export default function RiskMap({ hotspots, selectedId, onSelect, onOpen, height = 420, labels = true }) {
  const { theme } = useTheme();
  return (
    <MapContainer bounds={BOUNDS} style={{ height, width: '100%' }} scrollWheelZoom={false} zoomSnap={0.25}>
      <TileLayer
        url={OSM_TILES}
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {hotspots.map((h) => {
        const a = h.assessment;
        const level = a?.level || 'Normal';
        const color = resolveColor(levelTone(level));
        return (
          <React.Fragment key={`${h.id}-${theme}`}>
            <Circle center={[h.lat, h.lng]} radius={600}
              pathOptions={{ color, fillColor: color, fillOpacity: level === 'Normal' ? 0.06 : 0.16, weight: 1 }} />
            <Marker position={[h.lat, h.lng]} icon={markerIcon(h, level, selectedId === h.id, color, a?.flooding_now)}
              eventHandlers={{ click: () => onSelect?.(h.id) }}>
              {labels && (
                <Tooltip direction={LABEL_LEFT.has(h.id) ? 'left' : 'right'} offset={LABEL_LEFT.has(h.id) ? [-16, 0] : [16, 0]}
                  className="risk-label" permanent>{h.name}</Tooltip>
              )}
              <Popup>
                <div className="space-y-2" style={{ minWidth: 210 }}>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{h.name}</strong>
                    <LevelWithState assessment={a} />
                  </div>
                  <ForecastCells probs={a?.probs} compact />
                  <MechanismBadge mechanism={a?.mechanism} depth={a?.water_depth_cm} />
                  {a?.headline && <p className="text-[11px] text-fg-muted leading-snug">{a.headline}</p>}
                  {h.sensors && (
                    <p className="text-[10.5px] text-fg-faint">
                      Drain {Math.round(h.sensors.drain_pct)}% · road water {cm(h.sensors.water_depth_cm)} · rain {h.sensors.rain_mmhr} mm/h
                    </p>
                  )}
                  {onOpen && <Button size="sm" block onClick={() => onOpen(h.id)}>Open hotspot</Button>}
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}
