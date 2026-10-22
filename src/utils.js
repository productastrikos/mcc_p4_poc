/* Small shared helpers. */

// Health status used by stat cards, charts and KPI details.
// `tone` maps to the colour classes in theme/components.css (.tone-*).
export const STATUS = {
  normal:   { label: 'Normal',   tone: 'success' },
  warning:  { label: 'Warning',  tone: 'warning' },
  critical: { label: 'Critical', tone: 'danger'  },
};

/**
 * Status for a value against thresholds.
 *   thresholds = { good, warn }
 *   inverted = false: higher is better (>= good is normal, >= warn is warning)
 *   inverted = true:  lower is better  (<= good is normal, <= warn is warning)
 */
export function getStatus(value, thresholds, inverted = false) {
  if (!thresholds) return 'normal';
  const v = parseFloat(value) || 0;
  const { good, warn } = thresholds;
  if (!inverted) return v >= good ? 'normal' : v >= warn ? 'warning' : 'critical';
  return v <= good ? 'normal' : v <= warn ? 'warning' : 'critical';
}

// Tone for a 0–100 utilisation-style value (higher is worse).
export function loadTone(pct, warnAt = 60, dangerAt = 85) {
  return pct > dangerAt ? 'danger' : pct > warnAt ? 'warning' : 'success';
}

export function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export const titleCase = (s = '') => s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

/* ─── Flood risk levels ─────────────────────────────────────────────────
   Thresholds on flood probability, from MCC's brief. `tone` is the colour
   name used by Badge, tone-* classes and charts. */
export const LEVELS = [
  { name: 'Normal',  min: 0,    tone: 'success' },
  { name: 'Watch',   min: 0.25, tone: 'info' },
  { name: 'Warning', min: 0.5,  tone: 'warning' },
  { name: 'Danger',  min: 0.75, tone: 'danger' },
];
export const LEVEL_RANK = { Normal: 0, Watch: 1, Warning: 2, Danger: 3 };

export const levelFor = (p) => [...LEVELS].reverse().find((l) => (p ?? 0) >= l.min) || LEVELS[0];
export const levelTone = (name) => (LEVELS.find((l) => l.name === name) || LEVELS[0]).tone;

/** Level the operator sees, with the reason when flooding is observed rather than forecast. */
export const levelReason = (a) => (a?.flooding_now ? 'Flooding now' : null);

export const MECHANISMS = {
  'Tidal Backflow':    { icon: 'route',   blurb: 'High tide blocks drain outfalls, so rainwater backs up onto roads.' },
  'Rainfall Overload': { icon: 'bolt',    blurb: 'Rain falls faster than the drains can carry it away.' },
  'River Overflow':    { icon: 'layers',  blurb: 'The Miri River is high enough to overtop its banks or push back up drains.' },
  'Combined':          { icon: 'alert',   blurb: 'Several mechanisms at once: heavy rain with high tide and/or a high river.' },
};

/** Probability or share as a percent. Whole percents round down, so 49.6% shows as 49%
    and never looks like the next level up. */
export const pct = (p, digits = 0) => {
  if (p == null) return '–';
  if (digits === 0) return `${Math.floor(p * 100 + 1e-9)}%`;
  return `${(p * 100).toFixed(digits)}%`;
};

/* ─── Time ──────────────────────────────────────────────────────────────
   Sensor times are Malaysia time (MYT, UTC+8) stored without a zone, so they
   are shown as written. Wall-clock stamps from the server carry +08:00 and
   are shown in MYT whatever the browser's own time zone is. */
export const TZ = 'Asia/Kuching';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** '2026-10-17T14:00:00' or '…T14:00:00+08:00' → '14:00'. */
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
/** '2026-10-17T14:00:00' → '17 Oct 14:00'. */
export const dayTime = (iso) => {
  if (!iso) return '';
  return `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(11, 16)}`;
};
/** '2026-10-17T14:00:00' → 'Saturday 17 October' (date part only, no time-zone shift). */
export const longDate = (iso) => {
  if (!iso) return '';
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
};
/** Current Malaysia time as 'HH:MM:SS'. */
export const mytClock = (date = new Date()) => date.toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false });
/** Hours from sensor time `a` to `b` (both naive MYT ISO strings). */
export const hoursBetween = (a, b) => (Date.parse(`${b.slice(0, 19)}Z`) - Date.parse(`${a.slice(0, 19)}Z`)) / 3600000;
/** Sensor time plus h hours, as a naive ISO string. */
export const addHours = (iso, h) => new Date(Date.parse(`${iso.slice(0, 19)}Z`) + h * 3600000).toISOString().slice(0, 19);

/** Feed sources: live data and the three kinds of exercise. */
export const SOURCE_LABEL = { live: 'Live', drill: 'Exercise: storm drill', replay: 'Exercise: event replay', simulator: 'Exercise: simulator' };
export const KIND_LABEL = { warning: 'Warning', watch: 'Watch advisory', all_clear: 'All-clear' };
export const ALERT_STATUS = {
  drafting:   { tone: 'accent',  label: 'Drafting' },
  pending:    { tone: 'warning', label: 'Awaiting approval' },
  sent:       { tone: 'success', label: 'Sent' },
  approved:   { tone: 'success', label: 'Approved (exercise)' },
  rejected:   { tone: 'neutral', label: 'Rejected' },
  superseded: { tone: 'neutral', label: 'Superseded' },
  expired:    { tone: 'neutral', label: 'Expired' },
};

/** Water depth in whole cm, rounded down so 9.6 cm never reads as the 10 cm flood depth. */
export const cm = (v) => (v == null ? '–' : `${Math.floor(v + 1e-9)} cm`);
export const FLOOD_DEPTH_CM = 10;
export const RIVER_ALERT_M = 2.8;
export const HIGH_TIDE_M = 2.0;

/* Outfall blocking, the same formula as server/physics.py outfall_factors. */
const clip01 = (v) => Math.min(1, Math.max(0, v));
export function outfallBlocking(h, tide, river) {
  const tideBlock = h.tide_sens * clip01((tide - h.outfall) / 0.8);
  const riverBlock = h.river_sens * clip01((river - (h.bank - 1.3)) / 1.3);
  return { tide: Math.round(tideBlock * 100), river: Math.round(riverBlock * 100) };
}
export function outfallState(block) {
  if (block.tide >= 70) return 'Tide-locked';
  if (block.tide >= 10) return 'Partly tide-locked';
  if (block.river >= 10) return 'River backwater';
  return 'Free-flowing';
}
export const OUTFALL_TONE = { 'Free-flowing': 'success', 'River backwater': 'info', 'Partly tide-locked': 'warning', 'Tide-locked': 'danger' };
export const fmtHours = (h) => {
  if (h == null) return '';
  const m = Math.round(h * 60);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm < 8 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')} min`;
};
