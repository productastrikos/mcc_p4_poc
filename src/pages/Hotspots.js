import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Field, Loading, PageHeader } from '../components/ui';
import { ForecastCells, LevelWithState, MechanismBadge, OfflineBanner } from '../components/flood/bits';
import { useData } from '../data/DataProvider';
import { LEVEL_RANK, cm } from '../utils';

export default function Hotspots() {
  const navigate = useNavigate();
  const { live, online } = useData();
  if (!live) return <div className="space-y-4">{!online && <OfflineBanner />}<Loading>Loading the live feed…</Loading></div>;
  const ranked = [...live.hotspots].sort((a, b) =>
    (LEVEL_RANK[b.assessment.level] - LEVEL_RANK[a.assessment.level]) || (b.assessment.probs['6h'] - a.assessment.probs['6h']));

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader title="Flood Hotspots" subtitle="The six flood-prone areas in MCC's brief, highest risk first. Pilot sites are marked." />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ranked.map((h) => {
          const a = h.assessment;
          return (
            <button key={h.id} type="button" className="text-left" onClick={() => navigate(`/hotspots/${h.id}`)}>
              <Card hoverable className="h-full"
                title={<span className="flex items-center gap-2">{h.name}{h.pilot && <Badge tone="primary">PILOT</Badge>}</span>}
                subtitle={h.area}
                actions={<LevelWithState assessment={a} />}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <ForecastCells probs={a?.probs} />
                    <MechanismBadge mechanism={a?.mechanism} depth={a?.water_depth_cm} />
                  </div>
                  <div className="space-y-1.5">
                    <Field label={`Smart Drain ${h.drain_id}`}>{Math.round(h.sensors.drain_pct)}%</Field>
                    <Field label="Water on the road">{cm(h.sensors.water_depth_cm)}</Field>
                    <Field label="Rain now / next 3 h">{h.sensors.rain_mmhr} mm/h · {Math.round(h.sensors.rain_fcst_3h)} mm</Field>
                    <Field label="Elevation">{h.elevation_m} m above sea level</Field>
                    <Field label="Floods on record (pre Oct 2024)">{h.past_floods}</Field>
                    <Field label="Flood events, sensor history">{h.history_floods}</Field>
                    <Field label="Typical mechanisms">{h.known_mechanisms.join(', ')}</Field>
                    {(h.response.pumps.length > 0 || h.response.roads_closed || h.response.relief_open) && (
                      <Field label="Response">
                        {[h.response.pumps.length && `${h.response.pumps.length} pump${h.response.pumps.length > 1 ? 's' : ''}`,
                          h.response.roads_closed && 'roads closed', h.response.relief_open && 'relief centre open'].filter(Boolean).join(' · ')}
                      </Field>
                    )}
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
