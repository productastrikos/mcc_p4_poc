import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui';
import { NAV_SECTIONS } from '../../routes';
import { APP, USER } from '../../config';
import { initials } from '../../utils';
import { useData } from '../../data/DataProvider';

export function BrandMark({ size = 32 }) {
  return APP.logo
    ? <img src={APP.logo} alt={APP.org || APP.name} width={size} height={size} className="brand-logo" />
    : <div className="brand-mark">{APP.logoInitials || initials(APP.name)}</div>;
}

/** Logo lockup: the council crest, a hairline rule, then the product and council names. */
export function BrandLockup({ size = 38 }) {
  return (
    <span className="astk-lockup">
      <BrandMark size={size} />
      <span className="astk-lockup-rule" />
      <span className="astk-lockup-text">
        <span className="astk-lockup-name">{APP.short}</span>
        <span className="astk-lockup-product">{APP.org}</span>
        <span className="astk-lockup-descriptor">{APP.orgLocal}</span>
      </span>
    </span>
  );
}

/** collapsed: icon rail (desktop). open: the off-canvas drawer is showing (below 1024px). */
export default function Sidebar({ collapsed, open = false }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { operator, pendingAlerts, live } = useData();
  const user = operator || USER;
  const badges = {
    '/alerts': pendingAlerts.length || null,
    '/twin': live?.incidents?.open?.length || null,
  };
  collapsed = collapsed && !open;

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${open ? 'is-open' : ''}`}>
      <div className="sidebar-brand" onClick={() => navigate('/')} title={`${APP.name} · ${APP.org} (${APP.orgLocal})`}>
        {collapsed ? <BrandMark size={32} /> : <BrandLockup />}
      </div>

      <nav className="nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            {collapsed ? <div className="h-3" /> : <p className="nav-section-label">{section.label}</p>}
            {section.items.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`nav-item ${pathname === item.path || (item.path !== '/' && pathname.startsWith(`${item.path}/`)) ? 'is-active' : ''}`}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} size={18} />
                {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                {badges[item.path] && <span className={`nav-badge ${collapsed ? 'is-dot' : ''}`}>{collapsed ? '' : badges[item.path]}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="sidebar-user">
          <div className="avatar avatar-sm">{initials(user.name)}</div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-fg truncate">{user.name}</p>
            <p className="text-[10px] text-fg-faint truncate">{user.role}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
