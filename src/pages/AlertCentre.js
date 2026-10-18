import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Icon, PageHeader, Tabs } from '../components/ui';
import { AiTag, ForecastCells, LevelBadge, MechanismBadge, OfflineBanner } from '../components/flood/bits';
import { useData } from '../data/DataProvider';
import { api } from '../services/api';
import { dayTime } from '../utils';

const MAX_CHARS = 300;   // English + Bahasa Malaysia together (server/llm.py ALERT_MAX_CHARS)
const STATUS_TONE = { drafting: 'accent', pending: 'warning', sent: 'success', rejected: 'neutral', superseded: 'neutral' };
const SOURCE_LABEL = { live: 'Live', simulator: 'Exercise: simulator', replay: 'Exercise: replay' };

function AlertListItem({ a, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b last:border-0 transition-colors ${active ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg truncate">{a.hotspot_name}</span>
        <LevelBadge level={a.level} />
      </div>
      <p className="text-[11px] text-fg-muted line-clamp-1 mt-0.5">{a.headline}</p>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <Badge tone={STATUS_TONE[a.status]}>{a.status.toUpperCase()}</Badge>
        <span className="text-[10px] text-fg-faint">{SOURCE_LABEL[a.source] || a.source}</span>
        <span className="text-[10px] text-fg-faint font-mono ml-auto">{dayTime(a.created_at)}</span>
      </div>
    </button>
  );
}

function PhonePreview({ en, ms, level }) {
  const now = new Date();
  return (
    <div className="phone">
      <div className="phone-notch" />
      <div className="phone-time">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="phone-date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div className="phone-notif">
        <div className="phone-notif-app">
          <img src="/floodsense.svg" alt="" width={14} height={14} style={{ borderRadius: 3 }} />
          Miri CARES · now
          <span className="ml-auto" style={{ color: level === 'Danger' ? '#b91c1c' : '#b45309' }}>{level.toUpperCase()}</span>
        </div>
        <div className="phone-notif-body">{en}{'\n\n'}{ms}</div>
      </div>
    </div>
  );
}

function AlertDetail({ alert, onChanged }) {
  const { notify } = useData();
  const navigate = useNavigate();
  const [en, setEn] = useState(alert.public_en);
  const [ms, setMs] = useState(alert.public_ms);
  const [operator, setOperator] = useState('MSCCC Duty Officer');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Reload the text when a different alert is opened or the draft finishes.
  useEffect(() => { setEn(alert.public_en); setMs(alert.public_ms); }, [alert.id, alert.public_en, alert.public_ms]);

  const len = en.length + 1 + ms.length;
  const pending = alert.status === 'pending';
  const dirty = en !== alert.public_en || ms !== alert.public_ms;
  const ctx = alert.context || {};

  const save = async () => {
    await api.patch(`/api/alerts/${alert.id}`, { public_en: en, public_ms: ms });
    onChanged();
  };
  const toggle = async (item) => {
    const checklist = alert.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c));
    await api.patch(`/api/alerts/${alert.id}`, { checklist });
    onChanged();
  };
  const decide = async (approve) => {
    setBusy(true);
    try {
      if (dirty) await save();
      await api.post(`/api/alerts/${alert.id}/${approve ? 'approve' : 'reject'}`, { operator, note });
      notify(approve ? `Alert for ${alert.hotspot_name} sent to Miri CARES (simulated).` : 'Draft rejected.', approve ? 'success' : 'info');
      onChanged();
    } catch (e) {
      notify(e.message, 'danger');
    } finally { setBusy(false); }
  };

  if (alert.status === 'drafting') {
    return (
      <Card title={alert.hotspot_name}>
        <div className="flex items-center gap-3 text-sm text-fg-muted py-10 justify-center">
          <Icon name="sparkles" size={18} className="text-accent animate-pulse" /> Drafting the bilingual alert and action checklist…
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title={<span className="flex items-center gap-2 flex-wrap">{alert.hotspot_name} <LevelBadge level={alert.level} />
          <Badge tone={STATUS_TONE[alert.status]}>{alert.status.toUpperCase()}</Badge>
          {alert.source !== 'live' && <Badge tone="neutral">EXERCISE</Badge>}</span>}
        subtitle={`${alert.id} · ${SOURCE_LABEL[alert.source] || alert.source} · sensor time ${dayTime(alert.sim_time)}${ctx.scenario ? ` · ${ctx.scenario}` : ''}`}
        actions={<Button size="sm" variant="ghost" onClick={() => navigate(`/hotspots/${alert.hotspot_id}`)}>Open hotspot</Button>}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5 min-w-0 flex-1">
            <MechanismBadge mechanism={alert.mechanism} />
            <p className="text-sm font-semibold text-fg leading-snug">{alert.headline}</p>
            {ctx.expected_by_local && <p className="text-[11px] text-fg-faint">Flooding expected by about {ctx.expected_by_local}. {alert.operator_summary}</p>}
          </div>
          <ForecastCells probs={alert.probs} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3" title="Miri CARES public alert" subtitle="English and Bahasa Malaysia, sent together"
          actions={<AiTag>{alert.engine?.startsWith('template') ? 'Template' : 'Gen-AI draft'}</AiTag>}>
          <div className="space-y-3">
            <label className="block">
              <span className="label-caps field-label">English</span>
              <textarea className="textarea" rows={3} value={en} onChange={(e) => setEn(e.target.value)} disabled={!pending} />
            </label>
            <label className="block">
              <span className="label-caps field-label">Bahasa Malaysia</span>
              <textarea className="textarea" rows={3} value={ms} onChange={(e) => setMs(e.target.value)} disabled={!pending} />
            </label>
            <div className="flex items-center justify-between text-[11px]">
              <span className={len > MAX_CHARS ? 'text-danger font-bold' : 'text-fg-faint'}>
                {len} / {MAX_CHARS} characters{len > MAX_CHARS ? ': shorten before sending' : ''}
              </span>
              {pending && dirty && <Button size="sm" variant="secondary" icon="edit" onClick={save}>Save edits</Button>}
            </div>
            <p className="text-[10.5px] text-fg-faint">
              Drafted by <b>{alert.engine}</b>{alert.llm_error ? ` (LLM unavailable: ${alert.llm_error})` : ''}{alert.edited ? ' · edited by operator' : ''}
            </p>
          </div>
        </Card>
        <div className="lg:col-span-2"><PhonePreview en={en} ms={ms} level={alert.level} /></div>
      </div>

      <Card title="MSCCC action checklist" subtitle="Tick actions as they are done" actions={<AiTag>{alert.engine?.startsWith('template') ? 'Template' : 'Gen-AI draft'}</AiTag>} padded={false}>
        {alert.checklist.map((c) => (
          <label key={c.id} className="flex items-start gap-3 px-4 py-3 border-b last:border-0 cursor-pointer hover:bg-surface-raised">
            <input type="checkbox" checked={!!c.done} onChange={() => toggle(c)} className="mt-0.5" style={{ accentColor: 'var(--color-primary)' }} />
            <div className="flex-1 min-w-0">
              <p className={`text-[13px] ${c.done ? 'line-through text-fg-faint' : 'text-fg font-medium'}`}>{c.action}</p>
              <p className="text-[11px] text-fg-faint">{c.owner} · {c.timing}</p>
            </div>
          </label>
        ))}
      </Card>

      {pending ? (
        <Card title="Operator decision" subtitle="Approving sends the public alert to Miri CARES. Sending is simulated in this prototype.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="label-caps field-label">Operator</span>
              <input className="input" value={operator} onChange={(e) => setOperator(e.target.value)} />
            </label>
            <label className="block">
              <span className="label-caps field-label">Note (optional)</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirmed on CCTV" />
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <Button icon="send" onClick={() => decide(true)} disabled={busy || len > MAX_CHARS || !en.trim() || !ms.trim()}>Approve and send</Button>
            <Button variant="ghost" onClick={() => decide(false)} disabled={busy}>Reject</Button>
          </div>
        </Card>
      ) : (
        <div className={`tile tone-${STATUS_TONE[alert.status]} text-xs`}>
          {alert.status === 'sent' && <>Sent to {alert.channels?.join(' and ')} at {dayTime(alert.decided_at)} by {alert.approved_by}.</>}
          {alert.status === 'rejected' && <>Rejected at {dayTime(alert.decided_at)} by {alert.approved_by}.</>}
          {alert.status === 'superseded' && <>Replaced by a newer draft ({alert.superseded_by}).</>}
          {alert.operator_note ? ` Note: ${alert.operator_note}` : ''}
        </div>
      )}
    </div>
  );
}

export default function AlertCentre() {
  const { alerts, online, refreshAlerts } = useData();
  const [tab, setTab] = useState('pending');
  const [selectedId, setSelectedId] = useState(null);

  const groups = useMemo(() => ({
    pending: alerts.filter((a) => a.status === 'pending' || a.status === 'drafting'),
    sent: alerts.filter((a) => a.status === 'sent'),
    history: alerts,
  }), [alerts]);
  const list = groups[tab];
  const selected = alerts.find((a) => a.id === selectedId) || list[0];

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title="Alert Centre"
        subtitle="AI-drafted bilingual Miri CARES alerts and MSCCC action checklists. Nothing goes out until an operator approves it."
        actions={<Tabs value={tab} onChange={(v) => { setTab(v); setSelectedId(null); }} tabs={[
          { value: 'pending', label: `Awaiting approval (${groups.pending.length})` },
          { value: 'sent', label: `Sent (${groups.sent.length})` },
          { value: 'history', label: `All (${alerts.length})` },
        ]} />}
      />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card padded={false} title="Drafts and alerts" subtitle="Drafted automatically when a hotspot reaches Warning or Danger">
          {list.length === 0 && (
            <p className="text-xs text-fg-faint p-6 text-center">
              {tab === 'pending' ? 'No drafts waiting. Run a storm drill on the dashboard, or draft from the simulator.' : 'Nothing here yet.'}
            </p>
          )}
          <div className="max-h-[70vh] overflow-y-auto">
            {list.map((a) => <AlertListItem key={a.id} a={a} active={selected?.id === a.id} onClick={() => setSelectedId(a.id)} />)}
          </div>
        </Card>
        <div className="xl:col-span-2">
          {selected ? <AlertDetail alert={selected} onChanged={refreshAlerts} /> : (
            <Card><p className="text-sm text-fg-faint text-center py-10">Select a draft to review it.</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}
