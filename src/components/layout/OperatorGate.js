import React, { useState } from 'react';
import { Button, Modal } from '../ui';
import { useData } from '../../data/DataProvider';
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
  const [name, setName] = useState('');
  const [role, setRole] = useState(ROLES[0]);
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setOperator({ name: name.trim(), role, since: nowStamp() });
  };
  return (
    <div className="signin-page">
      <form className="card signin-card" onSubmit={submit}>
        <div className="flex items-center gap-3 mb-5">
          <img src={APP.logo} alt="" style={{ height: 36 }} />
          <div>
            <p className="text-sm font-bold text-fg">{APP.name}</p>
            <p className="text-[11px] text-fg-faint">{APP.subtitle}</p>
          </div>
        </div>
        <h1 className="page-title mb-1">Start your duty shift</h1>
        <p className="text-xs text-fg-faint mb-5">Your name is recorded on every alert you approve and every action you take. MYT {mytClock().slice(0, 5)}.</p>
        <label className="block mb-3">
          <span className="label-caps field-label">Operator name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nur Aisyah binti Ahmad" />
        </label>
        <label className="block mb-5">
          <span className="label-caps field-label">Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <Button type="submit" block size="lg" disabled={!name.trim()}>Start shift</Button>
        <p className="text-[10.5px] text-fg-faint mt-4">Prototype sign-in kept in this browser only. Replace with MCC single sign-on when integrated.</p>
      </form>
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
    <Modal title={operator?.name} eyebrow="Duty operator" subtitle={operator?.role} onClose={onClose} width={460}>
      <div className="grid grid-cols-2 gap-3">
        <div className="tile"><p className="label-caps mb-1">Shift started</p><p className="text-sm font-semibold text-fg">{dayTime(operator?.since)} MYT</p></div>
        <div className="tile"><p className="label-caps mb-1">Alerts sent</p><p className="text-sm font-semibold text-fg">{count('sent')}</p></div>
        <div className="tile"><p className="label-caps mb-1">Exercise approvals</p><p className="text-sm font-semibold text-fg">{count('approved')}</p></div>
        <div className="tile"><p className="label-caps mb-1">Drafts rejected</p><p className="text-sm font-semibold text-fg">{count('rejected')}</p></div>
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
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
