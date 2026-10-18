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

export const MECHANISMS = {
  'Tidal Backflow':    { icon: 'route',   blurb: 'High tide blocks drain outfalls, so rainwater backs up onto roads.' },
  'Rainfall Overload': { icon: 'bolt',    blurb: 'Rain falls faster than the drains can carry it away.' },
  'River Overflow':    { icon: 'layers',  blurb: 'The Miri River is high enough to overtop its banks or push back up drains.' },
  'Combined':          { icon: 'alert',   blurb: 'Several mechanisms at once: heavy rain with high tide and/or a high river.' },
};

export const pct = (p, digits = 0) => (p == null ? '–' : `${(p * 100).toFixed(digits)}%`);

/** '2026-10-17T14:00:00' → '14:00' (sensor clock is Malaysia time, stored without a zone). */
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
export const dayTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${iso.slice(11, 16)}`;
};
export const fmtHours = (h) => {
  if (h == null) return '';
  const m = Math.round(h * 60);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm < 8 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')} min`;
};
