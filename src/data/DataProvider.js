import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';

/* App-wide data from the FloodSense API. The live feed and the alert list are
   polled; controls (play, drill, replay…) and response actions post to the API
   and refresh at once. The signed-in operator and which notifications have
   been read are kept in this browser. */

const DataContext = createContext(null);
const LIVE_POLL_MS = 2000;
const ALERTS_POLL_MS = 3000;
const OPERATOR_KEY = 'floodsense_operator';
const READ_KEY = 'floodsense_read_notifications';

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch (e) { return fallback; }
}
function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage unavailable */ }
}

const RESPONSE_DONE = {
  deploy_pump: 'Mobile pump deployed',
  recall_pump: 'Mobile pump recalled',
  close_roads: 'Roads closed',
  reopen_roads: 'Roads reopened',
  open_relief: 'Relief centre opened',
  close_relief: 'Relief centre stood down',
};

export function DataProvider({ children }) {
  const [live, setLive] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [health, setHealth] = useState(null);
  const [online, setOnline] = useState(true);
  const [readIds, setReadIds] = useState(() => new Set(load(READ_KEY, [])));
  const [operator, setOperatorState] = useState(() => load(OPERATOR_KEY, null));
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const refreshLive = useCallback(async () => {
    try {
      setLive(await api.get('/api/live'));
      setOnline(true);
    } catch (e) {
      setOnline(false);
    }
  }, []);

  const refreshAlerts = useCallback(async () => {
    try { setAlerts(await api.get('/api/alerts')); } catch (e) { /* shown via `online` */ }
  }, []);

  useEffect(() => {
    api.get('/api/health').then(setHealth).catch(() => setOnline(false));
    refreshLive();
    refreshAlerts();
    const a = setInterval(refreshLive, LIVE_POLL_MS);
    const b = setInterval(refreshAlerts, ALERTS_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [refreshLive, refreshAlerts]);

  const notify = useCallback((text, tone = 'success') => {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const control = useCallback(async (action, extra = {}) => {
    try {
      const s = await api.post('/api/live/control', { action, ...extra });
      setLive(s);
      refreshAlerts();
      return s;
    } catch (e) {
      notify(e.message, 'danger');
      return null;
    }
  }, [refreshAlerts, notify]);

  const operatorName = operator?.name || 'MSCCC duty officer';

  /** Deploy/recall a pump, close/reopen roads, open/stand down a relief centre. */
  const respond = useCallback(async (action, hotspotId, unit) => {
    try {
      const state = await api.post('/api/respond', { action, hotspot_id: hotspotId, unit, operator: operatorName });
      await refreshLive();
      notify(RESPONSE_DONE[action] || 'Done', action.startsWith('deploy') || action.startsWith('close_r') || action === 'open_relief' ? 'warning' : 'success');
      return state;
    } catch (e) {
      notify(e.message, 'danger');
      return null;
    }
  }, [operatorName, refreshLive, notify]);

  const setOperator = useCallback((op) => { setOperatorState(op); save(OPERATOR_KEY, op); }, []);

  const notifications = useMemo(() => (live?.events || []).map((e) => ({
    id: e.id,
    tone: e.tone === 'success' ? 'info' : e.tone,
    title: e.title,
    message: e.message,
    createdAt: e.created_at,
    simTime: e.sim_time,
    hotspotId: e.hotspot_id,
    alertId: e.alert_id,
    read: readIds.has(e.id),
  })), [live, readIds]);

  const updateRead = useCallback((fn) => setReadIds((s) => {
    const n = fn(new Set(s));
    save(READ_KEY, [...n].slice(-400));
    return n;
  }), []);
  const markRead = useCallback((id) => updateRead((s) => s.add(id)), [updateRead]);
  const markAllRead = useCallback(() => updateRead((s) => {
    (live?.events || []).forEach((e) => s.add(e.id));
    return s;
  }), [live, updateRead]);

  const pendingAlerts = useMemo(() => alerts.filter((a) => a.status === 'pending' || a.status === 'drafting'), [alerts]);

  const value = useMemo(() => ({
    live, alerts, pendingAlerts, health, online,
    refreshLive, refreshAlerts, control, respond, notify,
    notifications, markRead, markAllRead,
    operator, operatorName, setOperator,
  }), [live, alerts, pendingAlerts, health, online, refreshLive, refreshAlerts, control, respond, notify,
    notifications, markRead, markAllRead, operator, operatorName, setOperator]);

  return (
    <DataContext.Provider value={value}>
      {children}
      {toast && (
        <div className={`toast tile tone-${toast.tone} text-xs font-semibold shadow-lg`} role="status">{toast.text}</div>
      )}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);

/** One hotspot from the live feed, or undefined while loading. */
export function useLiveHotspot(id) {
  const { live } = useData();
  return live?.hotspots.find((h) => h.id === id);
}

/** Poll an API path while the component is mounted (e.g. the digital twin). */
export function usePolled(path, ms = 2500, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    try { setData(await api.get(path)); setError(null); } catch (e) { setError(e.message); }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    reload();
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}
