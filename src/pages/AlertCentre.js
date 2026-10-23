import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, FilterChips, Icon, PageHeader, Tabs } from '../components/ui';
import { AiTag, ForecastCells, LevelBadge, MechanismBadge, OfflineBanner } from '../components/flood/bits';
import { APP } from '../config';
import { useData } from '../data/DataProvider';
import { api } from '../services/api';
import { ALERT_STATUS, KIND_LABEL, SOURCE_LABEL, cm, dayTime, hhmm, longDate, timeAgo } from '../utils';

const MAX_CHARS = 300;   // English + Bahasa Malaysia together (server/llm.py ALERT_MAX_CHARS)
const OPEN = ['pending', 'drafting'];
const DONE = ['sent', 'approved'];
const CLOSED = ['rejected', 'superseded', 'expired'];

function AlertListItem({ a, active, onClick }) {
  const st = ALERT_STATUS[a.status] || ALERT_STATUS.pending;
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b last:border-0 transition-colors ${active ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg truncate">{a.hotspot_name}</span>
        {a.kind === 'all_clear' ? <Badge tone="success">ALL-CLEAR</Badge> : <LevelBadge level={a.level} />}
      </div>
      <p className="text-[11px] text-fg-muted line-clamp-1 mt-0.5">{a.headline}</p>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <Badge tone={st.tone}>{st.label.toUpperCase()}</Badge>
        {a.kind !== 'warning' && <span className="text-[10px] font-semibold text-fg-muted">{KIND_LABEL[a.kind]}</span>}
        <span className="text-[10px] text-fg-faint">{SOURCE_LABEL[a.source] || a.source}</span>
        <span className="text-[10px] text-fg-faint font-mono ml-auto" title={`Drafted ${dayTime(a.created_at)} MYT`}>sensor {dayTime(a.sim_time)}</span>
      </div>
    </button>
  );
}

/** Lock-screen preview at the alert's own sensor time (Malaysia time). */
function PhonePreview({ en, ms, alert }) {
  const t = alert.sim_time;
  const level = alert.kind === 'all_clear' ? 'Normal' : alert.level;
  return (
    <div className="phone">
      <div className="phone-notch" />
      <div className="phone-time">{hhmm(t)}</div>
      <div className="phone-date">{longDate(t)}</div>
      {alert.exercise && <div className="phone-exercise">EXERCISE · not sent to the public</div>}
      <div className="phone-notif">
        <div className="phone-notif-app">
          <img src={APP.logo} alt="" width={14} height={14} className="brand-logo" />
          Miri CARES · now
          <span className={`ml-auto phone-level is-${level.toLowerCase()}`}>{alert.kind === 'all_clear' ? 'ALL CLEAR' : level.toUpperCase()}</span>
        </div>
        <div className="phone-notif-body">{en}{'\n\n'}{ms}</div>
      </div>
    </div>
  );
}

function ContextCard({ alert }) {
  const ctx = alert.context || {};
  const s = ctx.sensors || {};
  return (
    <Card title="Situation when drafted" subtitle={`Sensor time ${dayTime(alert.sim_time)}${ctx.scenario ? ` · scenario: ${ctx.scenario}` : ''}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-1.5">
          <p className="label-caps">Readings</p>
          {s.rain_now_mmhr != null && <Row k="Rain now" v={`${s.rain_now_mmhr} mm/h`} />}
          <Row k="Rain forecast, 3 h" v={`${s.rain_forecast_3h_mm} mm`} />
          <Row k="Smart Drain" v={`${s.drain_pct}%`} />
          {s.water_on_road_cm != null && <Row k="Water on the road" v={cm(s.water_on_road_cm)} />}
          <Row k="Tide" v={`${Number(s.tide_m).toFixed(2)} m`} />
          {ctx.next_high_tide && <Row k="Next high tide" v={`${Number(ctx.next_high_tide.height_m).toFixed(2)} m at ${ctx.next_high_tide.time}${ctx.next_high_tide.surge_m ? ` (incl. ${ctx.next_high_tide.surge_m} m surge)` : ''}`} />}
          <Row k="Miri River" v={`${Number(s.river_m).toFixed(2)} m`} />
          {ctx.cctv_confirmation && <Row k="CCTV" v={`${ctx.cctv_confirmation.status}${ctx.cctv_confirmation.depth_cm ? `, ${Math.round(ctx.cctv_confirmation.depth_cm)} cm` : ''}`} />}
        </div>
        <div className="space-y-1.5">
          <p className="label-caps">Model drivers</p>
          {(ctx.drivers || []).length === 0 && <p className="text-fg-faint">None above the noise.</p>}
          <ul className="space-y-1 list-disc pl-4 text-fg-muted">{(ctx.drivers || []).map((d) => <li key={d}>{d}</li>)}</ul>
          {ctx.incident && <p className="text-fg-faint pt-1">Incident {ctx.incident.id} open since {dayTime(ctx.incident.opened)} ({ctx.incident.mechanism}).</p>}
          {ctx.response && (ctx.response.pumps?.length > 0 || ctx.response.roads_closed || ctx.response.relief_open) && (
            <p className="text-fg-faint">Already in place: {[ctx.response.pumps?.length && `${ctx.response.pumps.join(', ')}`, ctx.response.roads_closed && 'roads closed', ctx.response.relief_open && 'relief centre open'].filter(Boolean).join(', ')}.</p>
          )}
          {ctx.hydraulic && (
            <p className="text-fg-faint">Hydraulic check: {ctx.hydraulic.first_flood_hour != null ? `floods at +${ctx.hydraulic.first_flood_hour} h, peak ${ctx.hydraulic.peak_depth_cm} cm` : `no flooding (peak ${ctx.hydraulic.peak_depth_cm} cm)`}.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

const Row = ({ k, v }) => <div className="flex justify-between gap-3"><span className="text-fg-faint">{k}</span><span className="font-semibold text-fg text-right">{v}</span></div>;

function StatusNote({ alert, onSelect }) {
  const st = ALERT_STATUS[alert.status];
  return (
    <div className={`tile tone-${st.tone} text-xs`}>
      {alert.status === 'sent' && <>Sent to {alert.channels?.join(' and ')} at {dayTime(alert.decided_at)} MYT by {alert.approved_by}.</>}
      {alert.status === 'approved' && <>Exercise approved at {dayTime(alert.decided_at)} MYT by {alert.approved_by}. Nothing was sent to the public.</>}
      {alert.status === 'rejected' && <>Rejected at {dayTime(alert.decided_at)} MYT by {alert.approved_by}.</>}
      {alert.status === 'superseded' && (
        <>Replaced by a newer draft for this hotspot:{' '}
          <button type="button" className="link-btn" onClick={() => onSelect(alert.superseded_by)}>{alert.superseded_by}</button>.</>
      )}
      {alert.status === 'expired' && <>Expired: {alert.expired_reason || 'the situation moved on before a decision'}.</>}
      {alert.operator_note ? ` Note: ${alert.operator_note}` : ''}
    </div>
  );
}

function AlertDetail({ alert, onChanged, onSelect }) {
  const { notify, operatorName, refreshLive } = useData();
  const navigate = useNavigate();
  const [en, setEn] = useState(alert.public_en);
  const [ms, setMs] = useState(alert.public_ms);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Reload the text when a different alert is opened or the draft finishes.
  useEffect(() => { setEn(alert.public_en); setMs(alert.public_ms); setNote(''); }, [alert.id, alert.public_en, alert.public_ms]);

  const len = en.length + 1 + ms.length;
  const pending = alert.status === 'pending';
  const checklistOpen = ['pending', 'sent', 'approved'].includes(alert.status);
  const dirty = en !== alert.public_en || ms !== alert.public_ms;
  const ctx = alert.context || {};
  const template = alert.engine?.startsWith('template');

  const save = async () => {
    try {
      await api.patch(`/api/alerts/${alert.id}`, { public_en: en, public_ms: ms });
      notify('Edits saved.');
      onChanged();
    } catch (e) { notify(e.message, 'danger'); }
  };
  const toggle = async (item) => {
    const checklist = alert.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c));
    try {
      const r = await api.patch(`/api/alerts/${alert.id}`, { checklist, operator: operatorName });
      (r.response_actions || []).forEach((x) => notify(x.ok ? `Done in the twin: ${x.action.replace('_', ' ')} at ${alert.hotspot_name}.` : x.message, x.ok ? 'success' : 'warning'));
      onChanged();
      refreshLive();
    } catch (e) { notify(e.message, 'danger'); }
  };
  const decide = async (approve) => {
    setBusy(true);
    try {
      if (dirty) await api.patch(`/api/alerts/${alert.id}`, { public_en: en, public_ms: ms });
      const r = await api.post(`/api/alerts/${alert.id}/${approve ? 'approve' : 'reject'}`, { operator: operatorName, note });
      notify(!approve ? 'Draft rejected.' : r.status === 'sent' ? `Alert for ${alert.hotspot_name} sent to Miri CARES (simulated).` : `Exercise alert for ${alert.hotspot_name} approved. Nothing was sent to the public.`,
        approve ? 'success' : 'info');
      onChanged();
      refreshLive();
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

  const st = ALERT_STATUS[alert.status];
  return (
    <div className="space-y-4">
      <Card
        title={<span className="flex items-center gap-2 flex-wrap">{alert.hotspot_name}
          {alert.kind === 'all_clear' ? <Badge tone="success">ALL-CLEAR</Badge> : <LevelBadge level={alert.level} />}
          {alert.kind === 'watch' && <Badge tone="info">ADVISORY</Badge>}
          <Badge tone={st.tone}>{st.label.toUpperCase()}</Badge>
          {alert.exercise && <Badge tone="neutral">EXERCISE</Badge>}</span>}
        subtitle={`${alert.id} · ${SOURCE_LABEL[alert.source] || alert.source} · drafted ${timeAgo(alert.created_at)} (${dayTime(alert.created_at)} MYT)`}
        actions={<Button size="sm" variant="ghost" onClick={() => navigate(`/hotspots/${alert.hotspot_id}`)}>Open hotspot</Button>}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5 min-w-0 flex-1">
            <MechanismBadge mechanism={alert.mechanism} />
            <p className="text-sm font-semibold text-fg leading-snug">{alert.headline}</p>
            <p className="text-[11px] text-fg-faint">
              {alert.kind === 'all_clear' ? 'The incident has closed and the flood risk has eased.'
                : ctx.flooding_now ? `Flooding was already under way (${cm(ctx.water_depth_cm)} on the road).`
                  : ctx.expected_by_local ? `Flooding expected by about ${ctx.expected_by_local}.` : ''} {alert.operator_summary}
            </p>
          </div>
          {alert.kind !== 'all_clear' && <ForecastCells probs={alert.probs} />}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3" title="Miri CARES public alert" subtitle="English and Bahasa Malaysia, sent together"
          actions={<AiTag>{template ? 'Template' : 'Gen-AI draft'}</AiTag>}>
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
        <div className="lg:col-span-2"><PhonePreview en={en} ms={ms} alert={alert} /></div>
      </div>

      <Card title="MSCCC action checklist"
        subtitle={checklistOpen
          ? `Tick actions as they are done.${alert.source !== 'simulator' && alert.kind !== 'all_clear' ? ' Pump, road-closure and relief-centre items are also carried out in the digital twin.' : ''}`
          : `Closed: this alert is ${st.label.toLowerCase()}.`}
        actions={<AiTag>{template ? 'Template' : 'Gen-AI draft'}</AiTag>} padded={false}>
        {alert.checklist.map((c) => (
          <label key={c.id} className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 ${checklistOpen ? 'cursor-pointer hover:bg-surface-raised' : 'opacity-70'}`}>
            <input type="checkbox" checked={!!c.done} disabled={!checklistOpen} onChange={() => toggle(c)} className="mt-0.5" style={{ accentColor: 'var(--color-primary)' }} />
            <div className="flex-1 min-w-0">
              <p className={`text-[13px] ${c.done ? 'line-through text-fg-faint' : 'text-fg font-medium'}`}>{c.action}</p>
              <p className="text-[11px] text-fg-faint">{c.owner} · {c.timing}</p>
            </div>
          </label>
        ))}
      </Card>

      <ContextCard alert={alert} />

      {pending ? (
        <Card title="Operator decision"
          subtitle={alert.exercise ? 'Exercise: approving records the decision. Nothing is sent to the public.' : 'Approving sends the public alert to Miri CARES. Sending is simulated in this prototype.'}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <span className="label-caps field-label">Operator</span>
              <p className="input" style={{ background: 'var(--tile-bg)' }}>{operatorName}</p>
            </div>
            <label className="block">
              <span className="label-caps field-label">Note (optional)</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirmed on CCTV" />
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <Button icon="send" onClick={() => decide(true)} disabled={busy || len > MAX_CHARS || !en.trim() || !ms.trim()}>
              {alert.exercise ? 'Approve (exercise)' : 'Approve and send'}
            </Button>
            <Button variant="ghost" onClick={() => decide(false)} disabled={busy}>Reject</Button>
          </div>
        </Card>
      ) : <StatusNote alert={alert} onSelect={onSelect} />}
    </div>
  );
}

export default function AlertCentre() {
  const { alerts, online, refreshAlerts } = useData();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('pending');
  const [source, setSource] = useState('all');
  const selectedId = params.get('id');

  const filtered = useMemo(() => alerts.filter((a) => source === 'all' || (source === 'live' ? a.source === 'live' : a.source !== 'live')), [alerts, source]);
  const groups = useMemo(() => ({
    pending: filtered.filter((a) => OPEN.includes(a.status)),
    done: filtered.filter((a) => DONE.includes(a.status)),
    closed: filtered.filter((a) => CLOSED.includes(a.status)),
    history: filtered,
  }), [filtered]);
  const list = groups[tab];
  const linked = alerts.find((a) => a.id === selectedId);
  const selected = linked || list[0];
  const select = (id) => setParams(id ? { id } : {});

  // A deep link opens the tab that holds the alert.
  useEffect(() => {
    if (!linked) return;
    const t = OPEN.includes(linked.status) ? 'pending' : DONE.includes(linked.status) ? 'done' : 'closed';
    if (!groups[tab].some((a) => a.id === linked.id)) setTab(t);
    if (source !== 'all' && !filtered.some((a) => a.id === linked.id)) setSource('all');
  }, [linked?.id, linked?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {!online && <OfflineBanner />}
      <PageHeader
        title="Alert Centre"
        subtitle="AI-drafted bilingual Miri CARES alerts and MSCCC action checklists. Nothing goes out until an operator approves it."
        actions={<Tabs value={tab} onChange={(v) => { setTab(v); select(null); }} tabs={[
          { value: 'pending', label: `Awaiting approval (${groups.pending.length})` },
          { value: 'done', label: `Sent / approved (${groups.done.length})` },
          { value: 'closed', label: `Closed (${groups.closed.length})` },
          { value: 'history', label: `All (${filtered.length})` },
        ]} />}
      />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Card padded={false} title="Drafts and alerts" subtitle="Drafted automatically at Warning or Danger; expire after 6 sensor-hours without a decision"
          actions={<FilterChips value={source} onChange={(v) => { setSource(v); select(null); }} options={[
            { value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'exercise', label: 'Exercises' },
          ]} />}>
          {list.length === 0 && (
            <p className="text-xs text-fg-faint p-6 text-center">
              {tab === 'pending' ? 'No drafts waiting. Run a storm drill on the dashboard, or draft from the simulator.' : 'Nothing here yet.'}
            </p>
          )}
          <div className="max-h-[70vh] overflow-y-auto">
            {list.map((a) => <AlertListItem key={a.id} a={a} active={selected?.id === a.id} onClick={() => select(a.id)} />)}
          </div>
        </Card>
        <div className="xl:col-span-2">
          {selected ? <AlertDetail alert={selected} onChanged={refreshAlerts} onSelect={select} /> : (
            <Card><EmptyState icon="bell" title="No draft selected">Select a draft from the list to review its text and checklist, then approve or reject it.</EmptyState></Card>
          )}
        </div>
      </div>
    </div>
  );
}
