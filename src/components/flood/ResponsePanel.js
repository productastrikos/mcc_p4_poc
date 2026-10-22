import React, { useState } from 'react';
import { Badge, Button, Icon } from '../ui';
import { useData } from '../../data/DataProvider';

/**
 * Response actions for one hotspot: mobile pumps, road closures and the relief
 * centre. Pumps add drain capacity in the hydraulic model, so the digital twin
 * and the next sensor readings show their effect.
 *   hotspot  live hotspot (with .response) or twin site
 *   fleet    live.response (pump fleet state)
 */
export default function ResponsePanel({ hotspot, fleet, compact = false }) {
  const { respond, live } = useData();
  const [busy, setBusy] = useState(null);
  const r = hotspot.response || { pumps: [], roads_closed: false, relief_open: false };
  const free = (fleet?.pumps || []).filter((p) => !p.hotspot_id).length;
  const replay = live?.mode === 'replay';
  const run = async (action) => {
    setBusy(action);
    await respond(action, hotspot.id);
    setBusy(null);
  };
  const disabledWhy = replay ? 'Response actions are not recorded during an event replay' : undefined;

  return (
    <div className="space-y-2.5">
      {!compact && live?.source === 'drill' && (
        <p className="text-[10.5px] text-warning">Storm drill: actions are exercises. Live deployments come back with Back to live.</p>
      )}
      {replay && <p className="text-[10.5px] text-fg-faint">Event replay: the archive cannot be changed, so response actions are off.</p>}
      <div className="response-row">
        <Icon name="truck" size={15} className="text-fg-faint" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-fg">Mobile pumps</p>
          <p className="text-[10.5px] text-fg-faint truncate">
            {r.pumps.length ? `${r.pumps.join(', ')} at ${hotspot.pump_point} (+${r.pump_mmhr} mm/h)` : `None here · ${free} of ${fleet?.pumps?.length ?? 4} at the depot`}
          </p>
        </div>
        {r.pumps.length > 0 && (
          <Button size="sm" variant="ghost" disabled={!!busy || replay} title={disabledWhy} onClick={() => run('recall_pump')}>Recall</Button>
        )}
        <Button size="sm" variant="soft" disabled={!!busy || replay || free === 0}
          title={disabledWhy || (free === 0 ? 'All pumps are deployed' : `Send ${fleet?.pumps?.find((p) => !p.hotspot_id)?.unit} to ${hotspot.pump_point}`)}
          onClick={() => run('deploy_pump')}>{busy === 'deploy_pump' ? 'Sending…' : 'Deploy'}</Button>
      </div>
      <div className="response-row">
        <Icon name="route" size={15} className="text-fg-faint" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-fg flex items-center gap-2">Roads {r.roads_closed && <Badge tone="warning">CLOSED</Badge>}</p>
          <p className="text-[10.5px] text-fg-faint truncate">{hotspot.roads.join(', ')}</p>
        </div>
        <Button size="sm" variant={r.roads_closed ? 'ghost' : 'soft'} disabled={!!busy || replay} title={disabledWhy}
          onClick={() => run(r.roads_closed ? 'reopen_roads' : 'close_roads')}>{r.roads_closed ? 'Reopen' : 'Close'}</Button>
      </div>
      <div className="response-row">
        <Icon name="shield" size={15} className="text-fg-faint" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-fg flex items-center gap-2">Relief centre {r.relief_open && <Badge tone="warning">OPEN</Badge>}</p>
          <p className="text-[10.5px] text-fg-faint truncate">{hotspot.relief_centre.replace(' (relief centre)', '')}</p>
        </div>
        <Button size="sm" variant={r.relief_open ? 'ghost' : 'soft'} disabled={!!busy || replay} title={disabledWhy}
          onClick={() => run(r.relief_open ? 'close_relief' : 'open_relief')}>{r.relief_open ? 'Stand down' : 'Open'}</Button>
      </div>
    </div>
  );
}
