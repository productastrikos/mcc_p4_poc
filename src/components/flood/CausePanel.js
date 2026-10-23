import React from 'react';
import { Icon } from '../ui';
import { AiTag, MechanismBadge } from './bits';
import { MECHANISMS, pct } from '../../utils';

const GROUP_COLOR = { Rain: 'chart-1', Tide: 'chart-2', River: 'chart-3', Drain: 'chart-4', Surface: 'chart-6' };

/**
 * Cause explanation for one hotspot assessment: mechanism, headline,
 * driver weights (Shapley shares) and "what if this factor were normal" checks.
 */
export default function CausePanel({ assessment, compact = false }) {
  if (!assessment) return null;
  const a = assessment;
  const k = a.alert_horizon;
  const base = a.model_probs?.[k];
  const cf = a.counterfactual || {};
  const checks = [
    ['If the tide were low', cf.low_tide],
    ['With no rain forecast', cf.no_rain_forecast],
    ['If the river were normal', cf.normal_river],
  ].filter(([, v]) => v != null && base != null && Math.abs(base - v) >= 0.05);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <MechanismBadge mechanism={a.mechanism} depth={a.water_depth_cm} className="text-[13px]" />
        <AiTag>Explained</AiTag>
      </div>
      <p className="text-sm font-semibold text-fg leading-snug">{a.headline}</p>
      {a.flooding_now && (
        <p className="text-[11px] text-danger">
          Level is Danger because the road is flooded now ({a.water_depth_cm} cm, flood depth 10 cm). The percentages are the chance
          it is still flooded within each horizon{a.forecast_level !== 'Danger' ? `: the forecast alone is ${a.forecast_level}` : ''}.
        </p>
      )}
      {a.mechanism && !compact && <p className="text-[11px] text-fg-faint">{MECHANISMS[a.mechanism]?.blurb}</p>}

      {a.drivers?.length > 0 && (
        <div className="space-y-2">
          <p className="label-caps">Top drivers (share of +{k} risk, model forecast)</p>
          {a.drivers.map((d) => (
            <div key={d.key}>
              <div className="flex justify-between gap-2 text-xs mb-1">
                <span className="text-fg">{d.text}</span>
                <span className="text-fg-faint tabular-nums">{pct(d.weight)}</span>
              </div>
              <div className="driver-bar"><span style={{ width: `${d.weight * 100}%`, background: `var(--${GROUP_COLOR[d.group]})` }} /></div>
            </div>
          ))}
        </div>
      )}

      {!compact && checks.length > 0 && (
        <div className="tile space-y-1.5">
          <p className="label-caps">What-if checks (+{k} risk now {pct(base)})</p>
          {checks.map(([label, v]) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-fg-muted">{label}</span>
              <span className="font-semibold text-fg tabular-nums">{pct(base)} <Icon name="chevronRight" size={11} className="inline text-fg-faint" /> {pct(v)}</span>
            </div>
          ))}
        </div>
      )}
      {!compact && a.mechanism === 'Tidal Backflow' && !a.flooding_now && (
        <p className="text-[11px] text-fg-faint">Tidal backflow: high tide (2.0 m or more) within the forecast window and the drain projected at {a.projected_drain_pct}% (above 80%).</p>
      )}
    </div>
  );
}
