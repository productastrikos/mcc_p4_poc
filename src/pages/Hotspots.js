import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Field, PageHeader } from '../components/ui';
import { ForecastCells, LevelBadge, MechanismBadge, OfflineBanner } from '../components/flood/bits';
import { useData } from '../data/DataProvider';

export default function Hotspots() {
  const navigate = useNavigate();
  const { live, online } = useData();
  if (!live) return <div className="space-y-4">{!online && <OfflineBanner />}<p className="text-sm text-fg-faint">Loading…</p></div>;

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader title="Flood Hotspots" subtitle="The six flood-prone areas in MCC's brief. Pilot sites are marked." />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {live.hotspots.map((h) => {
          const a = h.assessment;
          return (
            <button key={h.id} type="button" className="text-left" onClick={() => navigate(`/hotspots/${h.id}`)}>
              <Card hoverable className="h-full"
                title={<span className="flex items-center gap-2">{h.name}{h.pilot && <Badge tone="primary">PILOT</Badge>}</span>}
                subtitle={h.area}
                actions={<LevelBadge level={a?.level} />}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <ForecastCells probs={a?.probs} />
                    <MechanismBadge mechanism={a?.mechanism} />
                  </div>
                  <div className="space-y-1.5">
                    <Field label="Smart Drain">{Math.round(h.sensors.drain_pct)}%</Field>
                    <Field label="Rain now / next 3 h">{h.sensors.rain_mmhr} mm/h · {Math.round(h.sensors.rain_fcst_3h)} mm</Field>
                    <Field label="Elevation">{h.elevation_m} m above sea level</Field>
                    <Field label="Past floods recorded">{h.past_floods}</Field>
                    <Field label="Typical mechanisms">{h.known_mechanisms.join(', ')}</Field>
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
