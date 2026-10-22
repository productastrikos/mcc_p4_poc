import React from 'react';
import { FLOOD_DEPTH_CM, OUTFALL_TONE } from '../../utils';

/*
 * Hydraulic cross-section of one hotspot for the digital twin, drawn to the
 * same quantities the hydraulic model uses (server/physics.py):
 *   rain on the catchment → road and Smart Drain → outfall (blocked by the tide
 *   above its invert level, or by river backwater) → receiving water.
 * Vertical scales: drain fill is % of drain depth; road water is 0.5 px per cm;
 * the receiving water and the outfall invert share one metre scale (chart datum).
 * Not to scale horizontally.
 */
const W = 360;
const H = 176;
const GROUND = 104;               // road surface (y)
const TRENCH = { x0: 146, x1: 196, bottom: 154 };
const BASIN = { x0: 256, x1: 330, bottom: 168 };
const M_PX = 20;                  // px per metre in the basin
const yOfLevel = (m) => BASIN.bottom - m * M_PX;
const CM_PX = 0.5;

function Drops({ rate }) {
  const n = Math.min(36, Math.round(rate <= 0 ? 0 : 4 + rate * 0.6));
  const drops = [];
  for (let i = 0; i < n; i++) {
    const x = 8 + ((i * 53) % 236);
    const y = 8 + ((i * 29) % 46);
    drops.push(<line key={i} x1={x} y1={y} x2={x - 3} y2={y + 9} className="twin-drop" style={{ animationDelay: `${(i % 7) * 0.13}s` }} />);
  }
  return <g>{drops}</g>;
}

function House({ x }) {
  return (
    <g className="twin-house">
      <rect x={x} y={GROUND - 20} width="22" height="20" />
      <polygon points={`${x - 3},${GROUND - 20} ${x + 11},${GROUND - 31} ${x + 25},${GROUND - 20}`} />
      <rect x={x + 8} y={GROUND - 11} width="6" height="11" className="twin-door" />
    </g>
  );
}

export default function TwinSection({ site, frame, large = false }) {
  const { rain = 0, drain = 0, depth = 0, tide = 0, river = 0, pumps = 0, roadsClosed = false, block, outfall } = frame;
  const tone = OUTFALL_TONE[outfall] || 'success';
  const fill = Math.max(0, Math.min(100, drain)) / 100 * (TRENCH.bottom - GROUND);
  const roadWater = Math.min(48, Math.max(0, depth) * CM_PX);
  const pipeY = Math.min(TRENCH.bottom - 4, Math.max(GROUND + 8, yOfLevel(site.outfall)));
  const tideY = Math.max(yOfLevel(3.6), Math.min(BASIN.bottom, yOfLevel(tide)));
  const flooded = depth >= FLOOD_DEPTH_CM;
  const blocked = block.tide >= 70;
  const flowing = drain > 8 && !blocked;
  const riverPct = Math.max(0, Math.min(1, river / (site.bank + 0.6)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`twin-svg ${large ? 'is-large' : ''}`} role="img"
      aria-label={`${site.name}: drain ${Math.round(drain)}%, road water ${Math.floor(depth)} cm, tide ${tide.toFixed(2)} m, outfall ${outfall}`}>
      <rect x="0" y="0" width={W} height={H} className="twin-sky" />
      <Drops rate={rain} />
      {rain > 0 && <text x="8" y="70" className="twin-label">{rain.toFixed(rain < 10 ? 1 : 0)} mm/h</text>}

      {/* land, road and houses */}
      <polygon className="twin-ground" points={`0,${GROUND} ${TRENCH.x0},${GROUND} ${TRENCH.x0},${TRENCH.bottom} ${TRENCH.x1},${TRENCH.bottom} ${TRENCH.x1},${GROUND} ${BASIN.x0 - 6},${GROUND} ${BASIN.x0 - 6},${H} 0,${H}`} />
      <rect x="0" y={GROUND - 3} width={TRENCH.x0} height="3" className="twin-road" />
      <House x={18} /><House x={60} />
      {roadsClosed && (
        <g className="twin-barrier"><rect x="98" y={GROUND - 14} width="30" height="7" rx="1.5" /><line x1="102" y1={GROUND - 7} x2="102" y2={GROUND - 1} /><line x1="124" y1={GROUND - 7} x2="124" y2={GROUND - 1} /></g>
      )}

      {/* water on the road (surcharge above the drain rim) */}
      {roadWater > 0.3 && (
        <rect x="0" y={GROUND - roadWater} width={TRENCH.x1 + 10} height={roadWater} className={`twin-water ${flooded ? 'is-flood' : ''}`} />
      )}
      <line x1="0" x2={TRENCH.x1 + 10} y1={GROUND - FLOOD_DEPTH_CM * CM_PX} y2={GROUND - FLOOD_DEPTH_CM * CM_PX} className="twin-threshold" />
      {depth >= 1 && <text x="92" y={GROUND - roadWater - 4} className={`twin-label ${flooded ? 'is-danger' : ''}`}>{Math.floor(depth)} cm on road</text>}

      {/* Smart Drain trench */}
      <rect x={TRENCH.x0} y={TRENCH.bottom - fill} width={TRENCH.x1 - TRENCH.x0} height={fill} className="twin-water" />
      <rect x={TRENCH.x0} y={GROUND} width={TRENCH.x1 - TRENCH.x0} height={TRENCH.bottom - GROUND} className="twin-trench" />
      <rect x={TRENCH.x0 + 18} y={GROUND - 9} width="14" height="7" rx="1.5" className="twin-sensor" />
      <text x={TRENCH.x0 + 25} y={TRENCH.bottom + 11} textAnchor="middle" className="twin-label">{site.drain_id} {Math.round(drain)}%</text>

      {/* outfall pipe and gate */}
      <rect x={TRENCH.x1} y={pipeY - 4} width={BASIN.x0 - TRENCH.x1 - 6} height="8" className="twin-pipe" />
      {flowing && <line x1={TRENCH.x1 + 2} x2={BASIN.x0 - 10} y1={pipeY} y2={pipeY} className="twin-flow" />}
      <rect x={BASIN.x0 - 8} y={pipeY - 9} width="7" height="18" rx="1.5" className={`twin-gate tone-fill-${tone}`} />
      {blocked && <text x={BASIN.x0 - 4.5} y={pipeY - 12} textAnchor="middle" className="twin-label is-danger">✕</text>}
      <text x={TRENCH.x1 + 4} y={pipeY + 15} className={`twin-label ${blocked ? 'is-danger' : ''}`}>
        {block.tide > 0 || block.river > 0 ? `${Math.max(block.tide, block.river)}% blocked` : 'free'}
      </text>

      {/* receiving water (tide) and the outfall invert on the same metre scale */}
      <rect x={BASIN.x0} y={tideY} width={BASIN.x1 - BASIN.x0} height={BASIN.bottom - tideY} className="twin-sea" />
      <rect x={BASIN.x0} y={yOfLevel(3.6)} width={BASIN.x1 - BASIN.x0} height={BASIN.bottom - yOfLevel(3.6)} className="twin-basin" />
      <line x1={BASIN.x0} x2={BASIN.x1} y1={yOfLevel(site.outfall)} y2={yOfLevel(site.outfall)} className="twin-invert" />
      <text x={BASIN.x1 - 2} y={yOfLevel(site.outfall) + 9} textAnchor="end" className="twin-label">invert {site.outfall.toFixed(2)}</text>
      <text x={BASIN.x0} y={yOfLevel(3.6) - 4} className="twin-label is-strong">Tide {tide.toFixed(2)} m</text>

      {/* Miri River gauge (own datum) */}
      <g>
        <rect x={BASIN.x1 + 10} y="56" width="10" height="108" rx="2" className="twin-gauge" />
        <rect x={BASIN.x1 + 10} y={164 - 108 * riverPct} width="10" height={108 * riverPct} rx="2"
          className={`twin-river ${river >= site.bank ? 'is-over' : ''}`} />
        <line x1={BASIN.x1 + 7} x2={BASIN.x1 + 23} y1={164 - 108 * (site.bank / (site.bank + 0.6))} y2={164 - 108 * (site.bank / (site.bank + 0.6))} className="twin-invert" />
        <text x={BASIN.x1 + 15} y="50" textAnchor="middle" className="twin-label">River</text>
        <text x={BASIN.x1 + 15} y="174" textAnchor="middle" className="twin-label">{river.toFixed(1)}</text>
      </g>

      {/* mobile pumps */}
      {pumps > 0 && (
        <g className="twin-pump">
          <rect x={TRENCH.x1 + 4} y={GROUND - 30} width="30" height="16" rx="3" />
          <text x={TRENCH.x1 + 19} y={GROUND - 19} textAnchor="middle">P×{pumps}</text>
          <path d={`M ${TRENCH.x1 - 6} ${GROUND + 20} Q ${TRENCH.x1 + 6} ${GROUND - 26} ${TRENCH.x1 + 4} ${GROUND - 22}`} />
          <path d={`M ${TRENCH.x1 + 34} ${GROUND - 22} Q ${BASIN.x0 + 20} ${GROUND - 40} ${BASIN.x0 + 26} ${Math.max(tideY + 2, GROUND - 6)}`} className="twin-flow" />
        </g>
      )}
    </svg>
  );
}
