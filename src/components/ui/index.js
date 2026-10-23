import React from 'react';
import Icon from './Icon';

// UI kit. Import from here: import { Card, Button, Badge } from '../components/ui';
export { default as Icon } from './Icon';
export { default as Card } from './Card';
export { default as Button, IconButton } from './Button';
export { default as Badge } from './Badge';
export { default as StatCard } from './StatCard';
export { default as Tabs, FilterChips } from './Tabs';
export { default as Modal, Drawer, DetailGrid } from './Modal';
export { default as DataTable } from './DataTable';

/** ProgressBar: tone is a status colour name (success, warning, danger, primary…). */
export function ProgressBar({ value, max = 100, tone = 'primary', className = '' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`progress ${className}`}>
      <div className="progress-bar" style={{ width: `${pct}%`, background: `var(--color-${tone})` }} />
    </div>
  );
}

/** PageHeader: every page opens with it. Title and subtitle left, page actions right. */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header-block">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** StatGrid: responsive grid for a row of StatCards. */
export function StatGrid({ children, cols = 4 }) {
  const lg = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[cols] || 'lg:grid-cols-4';
  return <div className={`grid grid-cols-1 sm:grid-cols-2 ${lg} gap-4`}>{children}</div>;
}

/** Field: a label and value row inside cards. */
export function Field({ label, children }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-fg-faint">{label}</span>
      <span className="text-fg font-bold tabular-nums">{children}</span>
    </div>
  );
}

/** EmptyState: what is missing and the next action (ASTRIKOS-UI-THEME §7.19). */
export function EmptyState({ icon = 'info', title, children, action }) {
  return (
    <div className="app-empty">
      <Icon name={icon} size={44} className="app-empty-icon" />
      {title && <p className="app-empty-title">{title}</p>}
      {children && <p className="app-empty-text">{children}</p>}
      {action}
    </div>
  );
}

/** Loading: the spinner and a line saying what is loading. */
export function Loading({ children = 'Loading…' }) {
  return (
    <div className="app-loading py-12" role="status">
      <div className="app-loading-orbit" />
      <p className="app-loading-text">{children}</p>
    </div>
  );
}
