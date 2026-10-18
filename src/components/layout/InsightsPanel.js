import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, IconButton } from '../ui';
import { useData } from '../../data/DataProvider';
import { api } from '../../services/api';
import CausePanel from '../flood/CausePanel';
import { ForecastCells, LevelBadge } from '../flood/bits';
import { LEVEL_RANK, fmtHours, hhmm } from '../../utils';

/* AI Briefing: every hotspot at Watch or above, with the model's explanation
   and one-click actions. */
export default function InsightsPanel({ onClose }) {
  const navigate = useNavigate();
  const { live, notify, refreshAlerts } = useData();
  const [expanded, setExpanded] = useState(null);

  const atRisk = (live?.hotspots || [])
    .filter((h) => LEVEL_RANK[h.assessment?.level] >= 1)
    .sort((a, b) => LEVEL_RANK[b.assessment.level] - LEVEL_RANK[a.assessment.level] || b.assessment.probs['6h'] - a.assessment.probs['6h']);
  const open = expanded ?? atRisk[0]?.id;
  const nh = live?.city.next_high;

  const draft = async (h) => {
    try {
      await api.post('/api/alerts/draft', { hotspot_id: h.id });
      refreshAlerts();
      notify(`Drafting a ${h.assessment.level} alert for ${h.name}.`);
    } catch (e) { notify(e.message, 'danger'); }
  };

  return (
    <aside className="side-panel w-96 max-w-full" style={{ borderLeft: '2px solid var(--color-accent-border)' }}>
      <div className="panel-header">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-accent"><Icon name="sparkles" size={15} />AI Briefing</h3>
          <p className="text-xs text-fg-faint">Sensor time {hhmm(live?.sim_time)} · {atRisk.length} hotspot{atRisk.length === 1 ? '' : 's'} at Watch or above</p>
        </div>
        <IconButton icon="close" label="Close" plain onClick={onClose} />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {atRisk.length === 0 && (
          <div className="tile tone-success text-xs leading-relaxed">
            All six hotspots are at Normal for the next 6 hours.
            {nh && <> Next high tide {nh.height_m} m in {fmtHours(nh.in_h)}.</>}
          </div>
        )}
        {atRisk.map((h) => {
          const isOpen = open === h.id;
          return (
            <div key={h.id} className="card overflow-hidden" style={{ borderColor: 'var(--color-accent-border)' }}>
              <button type="button" className="w-full text-left p-3.5" onClick={() => setExpanded(isOpen ? '' : h.id)}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-semibold text-fg">{h.name}</span>
                  <div className="flex items-center gap-2">
                    <LevelBadge level={h.assessment.level} />
                    <Icon name="chevronDown" size={14} className={`text-fg-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>
                <ForecastCells probs={h.assessment.probs} compact />
              </button>
              {isOpen && (
                <div className="border-t p-3.5 space-y-3">
                  <CausePanel assessment={h.assessment} compact />
                  <div className="flex gap-2">
                    <Button size="sm" variant="accent" icon="sparkles" onClick={() => draft(h)}>Draft alert</Button>
                    <Button size="sm" variant="secondary" onClick={() => { navigate(`/hotspots/${h.id}`); onClose(); }}>Open hotspot</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
