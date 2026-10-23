import React from 'react';
import { Button, Icon, IconButton, ProgressBar } from '../ui';
import { useData } from '../../data/DataProvider';
import { dayTime, hhmm } from '../../utils';

const SPEEDS = [
  { value: 'realtime', label: 'Real time' },
  { value: 'normal', label: 'Sim: 1 h / 20 s' },
  { value: 'fast', label: 'Sim: 1 h / 8 s' },
  { value: 'demo', label: 'Sim: 1 h / 3 s' },
];

const FEED_LABEL = { live: 'Live feed', drill: 'Storm drill', replay: 'Replay' };

/** Clock, play/pause, speed, storm drill and replay controls for the simulated feed. */
export default function FeedControls({ compact = false }) {
  const { live, control } = useData();
  if (!live) return null;
  const synced = live.clock?.synced;
  const offLive = live.source !== 'live' || !synced;
  const title = synced
    ? 'Sensor clock (Malaysia time), synced to the real clock. Readings arrive on the hour.'
    : 'Sensor clock (Malaysia time). This is a simulation: the clock is not the real time.';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="feed-chip" title={title}>
        <span className={`live-dot ${live.playing ? '' : 'is-paused'} ${offLive ? 'is-sim' : ''}`} />
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-fg">{FEED_LABEL[live.source]}{live.source === 'live' && !synced ? ' (sim)' : ''}</span>
        <span className="font-mono text-xs text-fg-muted">{dayTime(live.sim_time)}</span>
      </div>
      <IconButton icon={live.playing ? 'pause' : 'play'} label={live.playing ? 'Pause feed' : 'Play feed'}
        onClick={() => control(live.playing ? 'pause' : 'play')} />
      <IconButton icon="skip" label="Advance one sensor hour (simulation)" onClick={() => control('step')} />
      {!compact && (
        <select className="select select-sm" style={{ height: 34 }} value={live.speed} aria-label="Feed speed"
          onChange={(e) => control('speed', { speed: e.target.value })}>
          {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
      <Button variant="danger" icon="rain" onClick={() => control('drill')}
        title="Exercise: jump to the next big high tide and send a 40 mm/hr storm in with it">
        Storm drill
      </Button>
      {offLive
        ? <Button variant="secondary" icon="refresh" onClick={() => control('reset')} title="Restart the live feed at the current Malaysia time">Back to live</Button>
        : <Button variant="secondary" icon="history" onClick={() => control('replay')} title="Exercise: play back the January 2025 flood (EV-05) hour by hour">Replay 2025 flood</Button>}
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
          <p className="text-xs font-bold text-fg">REPLAY (exercise): {r.event_id}, {r.mechanism} flood of {dayTime(r.event_start)}</p>
          <p className="text-[11px] text-fg-muted">
            Archived sensor data played back hour by hour. Forecasts are what FloodSense would have shown at the time.
            First flooding at {hhmm(r.event_start)}; peak {Math.round(r.peak_depth_cm)} cm.
            {r.truncated ? ' The playback stops after 72 h of the event.' : ''} Alerts drafted now are exercises.
          </p>
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
          <b>STORM DRILL (exercise).</b> A {d.rate} mm/hr storm for {d.duration} h arrives with a {d.high_tide_m.toFixed(2)} m high tide
          at {hhmm(d.high_tide)} on {dayTime(d.high_tide).split(' ').slice(0, 2).join(' ')} ({d.surge_m.toFixed(2)} m storm surge).
          The sensor clock has jumped ahead of real time. Alerts and actions are exercises.
        </p>
      </div>
    );
  }
  if (!live.clock?.synced) {
    const off = live.clock?.offset_h ?? 0;
    return (
      <div className="mode-banner">
        <Icon name="clock" size={16} className="text-warning" />
        <p className="text-xs text-fg flex-1">
          <b>SIMULATION.</b> The sensor clock is {Math.abs(off) < 1 ? 'running faster than' : `${Math.abs(off)} h ${off > 0 ? 'ahead of' : 'behind'}`} real
          Malaysia time{live.speed !== 'realtime' ? ` (1 sensor hour every ${live.tick_seconds} s)` : ''}. Use <b>Back to live</b> to return to the real-time feed.
        </p>
      </div>
    );
  }
  if (!live.playing) {
    return (
      <div className="mode-banner">
        <Icon name="pause" size={16} className="text-warning" />
        <p className="text-xs text-fg flex-1"><b>FEED PAUSED</b> at {hhmm(live.sim_time)}. Press play to catch up with the real-time readings.</p>
      </div>
    );
  }
  return null;
}
