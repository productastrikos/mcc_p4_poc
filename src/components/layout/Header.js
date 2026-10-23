import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Icon, IconButton, Button } from '../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { useData } from '../../data/DataProvider';
import { NAV_SECTIONS, ROUTES, SEARCH_EXTRAS } from '../../routes';
import { APP, USER } from '../../config';
import { initials, mytClock } from '../../utils';
import SitrepModal from './SitrepModal';
import { ProfileModal, SignOutModal } from './OperatorGate';

// Closes a popup when clicking outside `ref` or pressing Escape.
function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

// The search index is built from routes.js.
const SEARCH_INDEX = [
  ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label }))),
  ...SEARCH_EXTRAS,
].map((i) => ({ ...i, haystack: `${i.label} ${i.section} ${i.keywords || ''}`.toLowerCase() }));

function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);
  useDismiss(ref, open, () => { setOpen(false); setQuery(''); });

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return SEARCH_INDEX
      .map((item) => ({ item, score: words.filter((w) => item.haystack.includes(w)).length }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((r) => r.item);
  }, [query]);

  const go = (path) => { navigate(path); setOpen(false); setQuery(''); inputRef.current?.blur(); };

  return (
    <div className="search hidden sm:flex" ref={ref}>
      <Icon name="search" size={14} className="text-fg-faint" />
      <input
        ref={inputRef}
        value={query}
        placeholder="Search… (Ctrl+K)"
        aria-label="Search"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0].path); }}
      />
      {open && query.trim() && (
        <div className="menu left-0 right-0">
          <div className="menu-section">
            {results.length === 0 && <p className="menu-empty">No results for “{query}”. Try a page or hotspot name.</p>}
            {results.map((r) => (
              <button key={r.path} type="button" className="menu-item" onMouseDown={(e) => { e.preventDefault(); go(r.path); }}>
                <Icon name={r.icon} size={15} />
                <span className="flex-1">
                  <span className="block font-semibold text-fg">{r.label}</span>
                  <span className="block text-[10px] text-fg-faint">{r.section}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Real Malaysia time (the command centre's clock), whatever the browser's time zone. */
function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="header-clock hidden md:inline-flex" title="Real time in Miri (Malaysia time, UTC+8)">
      {mytClock(now)}<span className="astk-eyebrow">MYT</span>
    </span>
  );
}

function ProfileMenu({ onOpenNotifications, onProfile, onSignOut, onSitrep }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { toggleTheme } = useTheme();
  const { operator } = useData();
  const user = operator || USER;
  useDismiss(ref, open, () => setOpen(false));

  const item = (icon, label, onClick, danger = false) => (
    <button type="button" className={`menu-item ${danger ? 'is-danger' : ''}`} role="menuitem" onClick={() => { setOpen(false); onClick?.(); }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={user.name}>
        {initials(user.name)}
      </button>
      {open && (
        <div className="menu right-0" role="menu">
          <div className="menu-header">
            <div className="avatar">{initials(user.name)}</div>
            <div className="min-w-0">
              <p className="name truncate">{user.name}</p>
              <p className="text-[10px] text-fg-faint truncate">{user.role}</p>
              {operator && <span className="status">On shift</span>}
            </div>
          </div>
          <div className="menu-section">
            {item('user', 'Profile and shift', onProfile)}
            {item('clipboard', 'Situation report (SITREP)', onSitrep)}
            {item('bell', 'Notifications', onOpenNotifications)}
            {item('settings', 'Toggle theme', toggleTheme)}
          </div>
          <div className="menu-section">
            {item('logout', 'Sign out', onSignOut, true)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Header({ onToggleSidebar, activePanel, onTogglePanel }) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { notifications } = useData();
  const [modal, setModal] = useState(null);   // 'profile' | 'signout' | 'sitrep'
  const f = APP.features;

  const unread = notifications.filter((n) => !n.read);
  const hasDanger = unread.some((n) => n.tone === 'danger');
  const pageTitle = ROUTES.find((r) => matchPath(r.path, pathname))?.label || '';

  return (
    <header className="header">
      <IconButton icon="menu" label="Toggle sidebar" onClick={onToggleSidebar} />

      <div className="header-context hidden sm:flex">
        <span className="astk-eyebrow">{APP.subtitle}</span>
        <span className="font-display text-[13px] font-bold text-fg truncate">{pageTitle}</span>
      </div>

      {f.search && <Search />}
      <div className="flex-1" />
      {f.clock && <Clock />}

      {f.themeToggle && (
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggleTheme} />
      )}

      <Button variant="secondary" icon="clipboard" onClick={() => setModal('sitrep')} title="Situation report for handover and JPBD Miri">
        <span className="hidden lg:inline">SITREP</span>
      </Button>

      {f.insights && (
        <Button variant="advisory" icon="sparkles" onClick={() => onTogglePanel('insights')} aria-pressed={activePanel === 'insights'} aria-label="AI Briefing">
          <span className="hidden md:inline">AI Briefing</span>
        </Button>
      )}

      {f.notifications && (
        <IconButton icon="bell" label="Notifications" active={activePanel === 'notifications'} onClick={() => onTogglePanel('notifications')}>
          {unread.length > 0 && (
            <span className={`notify-count ${hasDanger ? 'is-danger' : 'is-warning'}`}>{unread.length}</span>
          )}
        </IconButton>
      )}

      <ProfileMenu
        onOpenNotifications={() => activePanel !== 'notifications' && onTogglePanel('notifications')}
        onProfile={() => setModal('profile')} onSignOut={() => setModal('signout')} onSitrep={() => setModal('sitrep')}
      />
      {modal === 'sitrep' && <SitrepModal onClose={() => setModal(null)} />}
      {modal === 'profile' && <ProfileModal onClose={() => setModal(null)} />}
      {modal === 'signout' && <SignOutModal onClose={() => setModal(null)} />}
    </header>
  );
}
