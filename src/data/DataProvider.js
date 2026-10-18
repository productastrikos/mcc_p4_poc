import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';

/* App-wide data from the FloodSense API. The live feed and the alert list are
   polled; controls (play, drill, replay…) post to the API and refresh at once. */

const DataContext = createContext(null);
const LIVE_POLL_MS = 2000;
const ALERTS_POLL_MS = 3000;

export function DataProvider({ children }) {
  const [live, setLive] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [health, setHealth] = useState(null);
  const [online, setOnline] = useState(true);
  const [readIds, setReadIds] = useState(() => new Set());
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
    toastTimer.current = setTimeout(() => setToast(null), 4000);
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

  const notifications = useMemo(() => (live?.events || []).map((e) => ({
    id: e.id,
    tone: e.tone === 'success' ? 'info' : e.tone,
    title: e.title,
    message: e.message,
    createdAt: e.created_at,
    simTime: e.sim_time,
    hotspotId: e.hotspot_id,
    read: readIds.has(e.id),
  })), [live, readIds]);

  const markRead = useCallback((id) => setReadIds((s) => new Set(s).add(id)), []);
  const markAllRead = useCallback(() => setReadIds((s) => {
    const n = new Set(s);
    (live?.events || []).forEach((e) => n.add(e.id));
    return n;
  }), [live]);

  const pendingAlerts = alerts.filter((a) => a.status === 'pending' || a.status === 'drafting');

  const value = useMemo(() => ({
    live, alerts, pendingAlerts, health, online,
    refreshLive, refreshAlerts, control, notify,
    notifications, markRead, markAllRead,
  }), [live, alerts, pendingAlerts, health, online, refreshLive, refreshAlerts, control, notify, notifications, markRead, markAllRead]);

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
