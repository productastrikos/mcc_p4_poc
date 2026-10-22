import React from 'react';
import { Badge, Icon } from '../ui';
import { FLOOD_DEPTH_CM, cm, hhmm, levelFor, levelTone, MECHANISMS, pct } from '../../utils';

/** Risk level pill: Normal / Watch / Warning / Danger. */
export function LevelBadge({ level = 'Normal', plain = false, className = '' }) {
  return <Badge tone={levelTone(level)} dot plain={plain} className={className}>{level.toUpperCase()}</Badge>;
}

/** Level plus a "flooding now" marker when water is already on the road. */
export function LevelWithState({ assessment, className = '' }) {
  const a = assessment || {};
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
      <LevelBadge level={a.level} />
      {a.flooding_now && <FloodingChip depth={a.water_depth_cm} />}
    </span>
  );
}

export function FloodingChip({ depth }) {
  return (
    <span className="badge tone-danger flooding-chip" title="Water on the road is at or above the 10 cm flood depth">
      <Icon name="waves" size={11} />FLOODING {depth != null ? cm(depth).toUpperCase() : ''}
    </span>
  );
}

/** Flood probability for +1h, +3h and +6h, each coloured by its level. */
export function ForecastCells({ probs, compact = false }) {
  return (
    <div className="flex gap-1">
      {['1h', '3h', '6h'].map((k) => {
        const p = probs?.[k] ?? 0;
        const tone = levelFor(p).tone;
        return (
          <div key={k} className={`fc-cell tone-${tone}`} style={compact ? { minWidth: 40, padding: '3px 4px' } : undefined}
            title={`Flood probability within ${k}: ${pct(p, 1)} (${levelFor(p).name})`}>
            <span className="fc-cell-value">{pct(p)}</span>
            <span className="fc-cell-label">+{k}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Dominant flood mechanism with an icon. `depth` (cm on the road) notes standing water when there is no risk. */
export function MechanismBadge({ mechanism, depth, className = '' }) {
  if (!mechanism) {
    const standing = depth != null && depth >= 2;
    return (
      <span className={`text-[11px] ${standing ? 'text-fg-muted' : 'text-fg-faint'} ${className}`}
        title={standing ? 'Water is on the road but below the 10 cm flood depth and not forecast to reach it' : undefined}>
        {standing ? `${cm(depth)} on road, below flood depth` : 'No significant risk'}
      </span>
    );
  }
  const m = MECHANISMS[mechanism];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent ${className}`} title={m?.blurb}>
      <Icon name={m?.icon || 'alert'} size={13} />{mechanism}
    </span>
  );
}

/** Compact sensor tile for the dashboard strip. With onClick it opens a detail view. */
export function SensorTile({ icon, label, value, unit, sub, tone, onClick, title }) {
  const body = (
    <>
      <div className="stat-card-icon" style={{ width: 32, height: 32 }}><Icon name={icon} size={17} /></div>
      <div className="min-w-0 flex-1">
        <p className="label-caps truncate">{label}</p>
        <p className="text-xl font-bold text-fg leading-tight tabular-nums" style={tone ? { color: `var(--color-${tone})` } : undefined}>
          {value}<span className="text-[11px] font-medium text-fg-faint ml-1">{unit}</span>
        </p>
        {sub && <p className="text-[10.5px] text-fg-faint truncate">{sub}</p>}
      </div>
      {onClick && <Icon name="chevronRight" size={12} className="sensor-tile-chevron" />}
    </>
  );
  if (!onClick) return <div className="card px-4 py-3 flex items-start gap-3 min-w-0">{body}</div>;
  return (
    <button type="button" onClick={onClick} title={title || `Details: ${label}`}
      className="card card-hoverable sensor-tile-btn relative pl-4 pr-5 py-3 flex items-start gap-3 min-w-0 text-left w-full">
      {body}
    </button>
  );
}

/**
 * One sentence for the digital twin's 6 h projection. `flooding` and `depth` are
 * the current state, so a road that is already flooded reads as rising or receding.
 */
export function ProjectionSentence({ projection: p, flooding, depth }) {
  if (flooding) {
    if (p.peak_depth_cm > depth) {
      return <>Flooding now ({cm(depth)}); projected to rise to <b>{p.peak_depth_cm} cm</b> at {hhmm(p.peak_time)}.</>;
    }
    const below = p.depth.findIndex((d) => d < FLOOD_DEPTH_CM);
    return below < 0
      ? <>Flooding now ({cm(depth)}); projected to stay above flood depth for the next 6 h.</>
      : <>Flooding now ({cm(depth)}); projected to fall below flood depth by <b>{hhmm(p.time[below])}</b>.</>;
  }
  if (p.first_flood_time) {
    return (
      <>Projected to reach flood depth at <b>{hhmm(p.first_flood_time)}</b>, peaking near <b>{p.peak_depth_cm} cm</b>
        {p.peak_time !== p.first_flood_time && <> at {hhmm(p.peak_time)}</>}.</>
    );
  }
  return <>No flooding projected in the next 6 h (peak road water {p.peak_depth_cm} cm).</>;
}

/** Small "AI" marker for content generated or scored by a model. */
export function AiTag({ children = 'AI' }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-widest text-accent">
      <Icon name="sparkles" size={11} />{children}
    </span>
  );
}

/** Banner when the backend is unreachable. */
export function OfflineBanner() {
  return (
    <div className="tile tone-danger text-xs font-semibold flex items-center gap-2">
      <Icon name="alert" size={14} />
      Cannot reach the FloodSense API on port 8000. Start it with <code className="font-mono">npm run server</code>.
    </div>
  );
}
