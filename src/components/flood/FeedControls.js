import React from 'react';
import { Button, Icon, IconButton, ProgressBar } from '../ui';
import { useData } from '../../data/DataProvider';
import { dayTime, hhmm } from '../../utils';

const SPEEDS = [
  { value: 'realtime', label: 'Real time' },
  { value: 'normal', label: '1 h every 20 s' },
  { value: 'fast', label: '1 h every 8 s' },
  { value: 'demo', label: '1 h every 3 s' },
];

/** Clock, play/pause, speed, storm drill and replay controls for the simulated feed. */
export default function FeedControls({ compact = false }) {
  const { live, control } = useData();
  if (!live) return null;
  const replay = live.mode === 'replay';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 px-3 h-[34px] rounded-lg border bg-surface" title="Sensor clock (simulated feed, Malaysia time)">
        <span className={`live-dot ${live.playing ? '' : 'is-paused'}`} />
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-fg">{replay ? 'Replay' : 'Sensor feed'}</span>
        <span className="font-mono text-xs text-fg-muted">{dayTime(live.sim_time)}</span>
      </div>
      <IconButton icon={live.playing ? 'pause' : 'play'} label={live.playing ? 'Pause feed' : 'Play feed'}
        onClick={() => control(live.playing ? 'pause' : 'play')} />
      <IconButton icon="skip" label="Advance one hour" onClick={() => control('step')} />
      {!compact && (
        <select className="select select-sm" style={{ height: 34 }} value={live.speed} aria-label="Feed speed"
          onChange={(e) => control('speed', { speed: e.target.value })}>
          {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
      <Button variant="danger" icon="rain" onClick={() => control('drill')}
        title="Jump to the next big high tide and send a 40 mm/hr storm in with it">
        Storm drill
      </Button>
      {replay || live.drill
        ? <Button variant="secondary" icon="refresh" onClick={() => control('reset')}>Back to live</Button>
        : <Button variant="secondary" icon="history" onClick={() => control('replay')}>Replay 2025 flood</Button>}
    </div>
  );
}

/** Explains when the feed is not ordinary live data. */
export function ModeBanner() {
  const { live } = useData();
  if (!live) return null;
  if (live.mode === 'replay' && live.replay) {
    const r = live.replay;
    return (
      <div className="mode-banner">
        <Icon name="history" size={16} className="text-warning" />
        <div className="flex-1 min-w-[220px]">
          <p className="text-xs font-bold text-fg">REPLAY: {r.event_id}, {r.mechanism} flood of {dayTime(r.event_start)}</p>
          <p className="text-[11px] text-fg-muted">Historical sensor data played back hour by hour. Forecasts are what FloodSense would have shown at the time; first flooding at {hhmm(r.event_start)}.</p>
        </div>
        <div className="w-40"><ProgressBar value={r.progress * 100} tone="warning" /></div>
      </div>
    );
  }
  if (live.drill) {
    const d = live.drill;
    return (
      <div className="mode-banner">
        <Icon name="rain" size={16} className="text-warning" />
        <p className="text-xs text-fg flex-1">
          <b>STORM DRILL (exercise).</b> A {d.rate} mm/hr storm for {d.duration} h arrives with a {d.high_tide_m} m high tide
          at {hhmm(d.high_tide)} ({d.surge_m} m storm surge). Watch the forecasts escalate before the water does.
        </p>
      </div>
    );
  }
  return null;
}
