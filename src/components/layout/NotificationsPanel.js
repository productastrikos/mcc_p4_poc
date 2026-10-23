import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Icon, IconButton } from '../ui';
import { useData } from '../../data/DataProvider';
import { hhmm, timeAgo } from '../../utils';

const GROUPS = [
  { tone: 'danger',  label: 'Critical' },
  { tone: 'warning', label: 'Warning' },
  { tone: 'info',    label: 'Info' },
];

/** Unread items from the operations log. An item opens its alert or hotspot. */
export default function NotificationsPanel({ onClose }) {
  const navigate = useNavigate();
  const { notifications, markRead, markAllRead } = useData();
  const unread = notifications.filter((n) => !n.read);

  const open = (n) => {
    markRead(n.id);
    if (n.alertId) navigate(`/alerts?id=${n.alertId}`);
    else if (n.hotspotId) navigate(`/hotspots/${n.hotspotId}`);
    onClose();
  };

  return (
    <aside className="side-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Notifications</h3>
          <p className="text-xs text-fg-faint">{unread.length} unread of {notifications.length} in the operations log</p>
        </div>
        <div className="flex items-center gap-2">
          {unread.length > 0 && <button type="button" className="link-btn" onClick={markAllRead}>MARK ALL READ</button>}
          <IconButton icon="close" label="Close" plain onClick={onClose} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {GROUPS.map(({ tone, label }) => {
          const items = unread.filter((n) => n.tone === tone);
          if (!items.length) return null;
          return (
            <div key={tone} className="space-y-2">
              <Badge tone={tone} plain>{label.toUpperCase()} ({items.length})</Badge>
              {items.map((n) => {
                const target = n.alertId ? 'Open alert' : n.hotspotId ? 'Open hotspot' : null;
                return (
                  <div key={n.id} className={`tile tone-${tone}`}>
                    {target ? (
                      <button type="button" className="text-left text-xs font-semibold text-fg hover:underline flex items-start gap-1" onClick={() => open(n)} title={target}>
                        {n.title}<Icon name="chevronRight" size={12} className="mt-0.5 shrink-0" />
                      </button>
                    ) : <p className="text-xs font-semibold text-fg">{n.title}</p>}
                    <p className="text-[11px] text-fg-muted mt-0.5">{n.message}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-fg-faint">{timeAgo(n.createdAt)} · sensor {hhmm(n.simTime)}</span>
                      <button type="button" className="link-btn" onClick={() => markRead(n.id)}>MARK AS READ</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {unread.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-fg-faint">You're all caught up</p>
            <button type="button" className="link-btn mt-2" onClick={() => { navigate('/'); onClose(); }}>VIEW THE OPERATIONS LOG</button>
          </div>
        )}
      </div>
    </aside>
  );
}
