import React, { useState } from 'react';
import { Button, IconButton, Modal } from '../ui';
import { BrandLockup } from './Sidebar';
import { useData } from '../../data/DataProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { APP, ROLES } from '../../config';
import { dayTime, mytClock } from '../../utils';

const nowStamp = () => {
  const d = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuching', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00+08:00`;
};

/** Duty sign-in. The name is recorded on every alert decision and response action. */
export function SignIn() {
  const { setOperator } = useData();
  const { theme, toggleTheme } = useTheme();
  const [name, setName] = useState('');
  const [role, setRole] = useState(ROLES[0]);
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setOperator({ name: name.trim(), role, since: nowStamp() });
  };
  return (
    <div className="signin-page">
      <IconButton className="signin-theme" icon={theme === 'dark' ? 'sun' : 'moon'}
        label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggleTheme} />

      <section className="signin-ink astk-on-ink astk-aurora">
        <BrandLockup size={64} />
        <div className="signin-statement">
          <p className="astk-eyebrow mb-3">{APP.subtitle}</p>
          <h2 className="astk-h2 mb-4">Flood warnings hours ahead, for an operator to approve.</h2>
          <p>
            {APP.name} forecasts flooding 1, 3 and 6 hours ahead at six hotspots across Miri, explains the cause,
            checks the CCTV and drafts bilingual Miri CARES alerts. Nothing goes out until a duty officer approves it.
          </p>
        </div>
        <p className="signin-foot">Miri Smart City Command Centre · {APP.org} ({APP.orgLocal})</p>
      </section>

      <div className="signin-form-wrap">
        <form className="astk-panel signin-card" onSubmit={submit}>
          <p className="astk-eyebrow mb-2">Duty sign-in · MYT {mytClock().slice(0, 5)}</p>
          <h1 className="page-title mb-1">Start your duty shift</h1>
          <p className="text-xs text-fg-muted mb-5">Your name is recorded on every alert you approve and every action you take.</p>
          <label className="app-field mb-3">
            <span className="app-label">Operator name</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nur Aisyah binti Ahmad" />
          </label>
          <label className="app-field mb-5">
            <span className="app-label">Role</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <Button type="submit" block size="lg" disabled={!name.trim()}>Start shift</Button>
          <p className="app-help mt-4">Prototype sign-in kept in this browser only. Replace with MCC single sign-on when integrated.</p>
        </form>
      </div>
    </div>
  );
}

/** Profile with this shift's activity. */
export function ProfileModal({ onClose }) {
  const { operator, alerts, live } = useData();
  const mine = alerts.filter((a) => a.approved_by === operator?.name && a.decided_at && operator?.since && a.decided_at >= operator.since);
  const mineActions = (live?.events || []).filter((e) => e.message.includes(`By ${operator?.name}.`) || e.message.includes(`by ${operator?.name}`));
  const count = (st) => mine.filter((a) => a.status === st).length;
  return (
    <Modal title={operator?.name} eyebrow="Duty operator" subtitle={operator?.role} onClose={onClose} width={420}>
      <div className="grid grid-cols-2 gap-3">
        <div className="tile"><p className="label-caps mb-1">Shift started</p><p className="font-display text-sm font-bold text-fg tabular-nums">{dayTime(operator?.since)} MYT</p></div>
        <div className="tile"><p className="label-caps mb-1">Alerts sent</p><p className="font-display text-sm font-bold text-fg tabular-nums">{count('sent')}</p></div>
        <div className="tile"><p className="label-caps mb-1">Exercise approvals</p><p className="font-display text-sm font-bold text-fg tabular-nums">{count('approved')}</p></div>
        <div className="tile"><p className="label-caps mb-1">Drafts rejected</p><p className="font-display text-sm font-bold text-fg tabular-nums">{count('rejected')}</p></div>
      </div>
      <p className="label-caps mt-4 mb-2">Recent actions in the operations log</p>
      {mineActions.length === 0 && <p className="text-xs text-fg-faint">None yet this session.</p>}
      <ul className="space-y-1.5">
        {mineActions.slice(0, 6).map((e) => (
          <li key={e.id} className="text-xs"><span className="font-mono text-fg-faint mr-2">{e.sim_time.slice(11, 16)}</span>{e.title}</li>
        ))}
      </ul>
    </Modal>
  );
}

/** Confirms ending the shift; signing out returns to the sign-in screen. */
export function SignOutModal({ onClose }) {
  const { setOperator, pendingAlerts, operator } = useData();
  return (
    <Modal title="End your shift?" onClose={onClose} width={420}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" icon="logout" onClick={() => { setOperator(null); onClose(); }}>Sign out</Button>
        </>
      )}>
      <p className="text-xs text-fg-muted leading-relaxed">
        {operator?.name} will be signed out of this console. The live feed keeps running.
        {pendingAlerts.length > 0 && <> <b className="text-warning">{pendingAlerts.length} draft{pendingAlerts.length === 1 ? ' is' : 's are'} still awaiting approval</b>; hand them over to the next duty officer.</>}
      </p>
    </Modal>
  );
}
