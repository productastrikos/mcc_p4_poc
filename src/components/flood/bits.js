import React from 'react';
import { Badge, Icon } from '../ui';
import { levelFor, levelTone, MECHANISMS, pct } from '../../utils';

/** Risk level pill: Normal / Watch / Warning / Danger. */
export function LevelBadge({ level = 'Normal', plain = false, className = '' }) {
  return <Badge tone={levelTone(level)} dot plain={plain} className={className}>{level.toUpperCase()}</Badge>;
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

/** Dominant flood mechanism with an icon. */
export function MechanismBadge({ mechanism, className = '' }) {
  if (!mechanism) return <span className={`text-[11px] text-fg-faint ${className}`}>No significant risk</span>;
  const m = MECHANISMS[mechanism];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent ${className}`} title={m?.blurb}>
      <Icon name={m?.icon || 'alert'} size={13} />{mechanism}
    </span>
  );
}

/** Compact sensor tile for the dashboard strip. */
export function SensorTile({ icon, label, value, unit, sub, tone }) {
  return (
    <div className="card px-4 py-3 flex items-start gap-3 min-w-0">
      <div className="stat-card-icon" style={{ width: 32, height: 32 }}><Icon name={icon} size={17} /></div>
      <div className="min-w-0">
        <p className="label-caps truncate">{label}</p>
        <p className="text-xl font-bold text-fg leading-tight tabular-nums" style={tone ? { color: `var(--color-${tone})` } : undefined}>
          {value}<span className="text-[11px] font-medium text-fg-faint ml-1">{unit}</span>
        </p>
        {sub && <p className="text-[10.5px] text-fg-faint truncate">{sub}</p>}
      </div>
    </div>
  );
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
