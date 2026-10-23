import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';

/* Chart.js setup and theme helpers. Chart elements are registered once
   here, so pages don't need to register anything. */

/* Draws horizontal reference lines:
   options.plugins.thresholdLines = { lines: [{ value, color, dash, label }] } */
const thresholdLinesPlugin = {
  id: 'thresholdLines',
  afterDatasetsDraw(chart, _args, opts) {
    const lines = opts?.lines;
    const y = chart.scales.y;
    if (!lines?.length || !y) return;
    const { ctx, chartArea: { left, right } } = chart;
    ctx.save();
    lines.forEach(({ value, color, dash = [4, 3], label }) => {
      if (value == null || value < y.min || value > y.max) return;
      const py = y.getPixelForValue(value);
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.moveTo(left, py);
      ctx.lineTo(right, py);
      ctx.stroke();
      if (label) {
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = '10px Lato, system-ui, sans-serif';
        ctx.fillText(label, right + 4, py + 3);
      }
    });
    ctx.restore();
  },
};

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler, thresholdLinesPlugin);
ChartJS.defaults.interaction.mode = 'index';
ChartJS.defaults.interaction.intersect = false;
ChartJS.defaults.font.family = 'Lato, system-ui, sans-serif';

/* ─── Reading theme tokens ─────────────────────────────────── */
// Read from <body>: that is where data-theme switches the --app-* tokens.
export function cssVar(name) {
  if (typeof document === 'undefined' || !document.body) return '';
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

const NAMED = ['primary', 'accent', 'success', 'warning', 'danger', 'info', 'neutral'];

/** Resolve 'primary' | 'success' | 'chart-3' | '#hex' to a concrete colour. */
export function resolveColor(name) {
  if (!name) return cssVar('--chart-1');
  if (name.startsWith('#') || name.startsWith('rgb')) return name;
  if (NAMED.includes(name)) return cssVar(`--color-${name}`);
  return cssVar(`--${name}`);
}

/** Series palette: --chart-1 … --chart-8 from theme.css. */
export const seriesColor = (i) => cssVar(`--chart-${(i % 8) + 1}`);

/** A hex colour plus an alpha → the same colour as rgba(). Non-hex colours are returned unchanged. */
export function withAlpha(color, alpha) {
  const hex = color?.replace('#', '');
  if (!hex || !/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return color;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ─── Shared option builders ───────────────────────────────── */
export function tooltipOptions(extra = {}) {
  return {
    backgroundColor: cssVar('--chart-tooltip-bg'),
    borderColor: cssVar('--chart-tooltip-border'),
    borderWidth: 1,
    cornerRadius: 8,
    titleColor: cssVar('--app-text'),
    bodyColor: cssVar('--app-text-muted'),
    titleFont: { size: 12, weight: '700' },
    bodyFont: { size: 11 },
    padding: 9,
    ...extra,
  };
}

/** Legend: 10px, top-right, 8px swatches with a 2px radius. */
export function legendOptions(show, position = 'top') {
  if (!show) return { display: false };
  return {
    display: true,
    position,
    align: position === 'top' ? 'end' : 'center',
    labels: {
      color: cssVar('--app-text-muted'), font: { size: 10 },
      usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8, padding: 10,
      generateLabels: solidSwatches,
    },
  };
}

// Line datasets carry a 12% area fill, which would make their legend swatch
// hollow; paint each swatch in the series colour instead.
function solidSwatches(chart) {
  if (chart.config.type === 'doughnut') return ChartJS.overrides.doughnut.plugins.legend.labels.generateLabels(chart);
  return ChartJS.defaults.plugins.legend.labels.generateLabels(chart)
    .map((l) => ({ ...l, fillStyle: l.strokeStyle, lineWidth: 0, lineDash: [] }));
}

/** Axis labels 10px faint, axis line on the border token, horizontal grid only. */
export function axisOptions({ yMax, ySuggestedMax, xMaxTicks, yLabel, stacked = false, grid = true } = {}) {
  const tick = { color: cssVar('--chart-tick'), font: { size: 10 } };
  const border = { color: cssVar('--app-border') };
  const gridCfg = grid ? { color: cssVar('--chart-grid'), lineWidth: 1 } : { display: false };
  const xTick = xMaxTicks ? { ...tick, maxRotation: 0, autoSkip: true, maxTicksLimit: xMaxTicks } : tick;
  return {
    x: { stacked, grid: { display: false }, border, ticks: xTick },
    y: {
      stacked, grid: gridCfg, border: { ...border, display: false }, ticks: tick, beginAtZero: true,
      ...(yMax != null ? { max: yMax } : {}),
      ...(ySuggestedMax != null ? { suggestedMax: ySuggestedMax } : {}),
      ...(yLabel ? { title: { display: true, text: yLabel, color: cssVar('--chart-tick'), font: { size: 10 } } } : {}),
    },
  };
}

/* ─── Timeframes ───────────────────────────────────────────── */
export const TIMEFRAMES = {
  intraday: ['12H', '24H'],
  daily:    ['24H', '7D'],
  trend:    ['7D', '30D'],
  all:      ['12H', '24H', '7D', '30D'],
};

const POINTS = { '12H': 12, '24H': 24, '7D': 7, '30D': 30 };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function timeframeLabels(tf) {
  const n = POINTS[tf] || 24;
  if (tf === '7D') return DAYS.slice();
  if (tf === '30D') return Array.from({ length: n }, (_, i) => `D${i + 1}`);
  return Array.from({ length: n }, (_, i) => `${String(i).padStart(2, '0')}:00`);
}

/** Stretch or squeeze a series to `points` values with linear interpolation. */
export function resample(series, points) {
  if (!Array.isArray(series) || series.length === 0) return [];
  if (series.length === points) return series;
  if (points === 1) return [series[series.length - 1]];
  return Array.from({ length: points }, (_, i) => {
    const pos = (i / (points - 1)) * (series.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(series.length - 1, Math.ceil(pos));
    return +(series[lo] + (series[hi] - series[lo]) * (pos - lo)).toFixed(2);
  });
}

export const timeframePoints = (tf) => POINTS[tf] || 24;
