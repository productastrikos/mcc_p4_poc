import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, IconButton } from '../ui';
import { useData, usePolled } from '../../data/DataProvider';
import { api } from '../../services/api';
import CausePanel from '../flood/CausePanel';
import { ForecastCells, LevelWithState, ProjectionSentence } from '../flood/bits';
import { LEVEL_RANK, fmtHours, hhmm } from '../../utils';

/* AI Briefing: every hotspot at Watch or above (or flooded), with the model's
   explanation, what the digital twin projects, and one-click actions. */
export default function InsightsPanel({ onClose }) {
  const navigate = useNavigate();
  const { live, notify, refreshAlerts, respond, alerts } = useData();
  const { data: twin, reload } = usePolled('/api/twin', 4000);
  const [expanded, setExpanded] = useState(null);

  const atRisk = (live?.hotspots || [])
    .filter((h) => LEVEL_RANK[h.assessment?.level] >= 1)
    .sort((a, b) => LEVEL_RANK[b.assessment.level] - LEVEL_RANK[a.assessment.level] || b.assessment.probs['6h'] - a.assessment.probs['6h']);
  const open = expanded ?? atRisk[0]?.id;
  const nh = live?.city.next_high;
  const freePumps = (live?.response?.pumps || []).filter((p) => !p.hotspot_id).length;

  const draft = async (h) => {
    try {
      const a = await api.post('/api/alerts/draft', { hotspot_id: h.id });
      refreshAlerts();
      notify(`Drafting ${a.kind === 'watch' ? 'a Watch advisory' : `a ${h.assessment.level} alert`} for ${h.name} (${a.id}).`);
    } catch (e) { notify(e.message, 'danger'); }
  };

  return (
    <aside className="side-panel is-advisory">
      <div className="panel-header">
        <div>
          <h3 className="panel-title flex items-center gap-1.5 text-accent"><Icon name="sparkles" size={15} />AI Briefing</h3>
          <p className="text-xs text-fg-faint">Sensor time {hhmm(live?.sim_time)} · {atRisk.length} hotspot{atRisk.length === 1 ? '' : 's'} at Watch or above</p>
        </div>
        <IconButton icon="close" label="Close" plain onClick={onClose} />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {atRisk.length === 0 && (
          <div className="tile tone-success text-xs leading-relaxed">
            All six hotspots are at Normal for the next 6 hours.
            {nh && <> Next high tide {nh.height_m.toFixed(2)} m at {hhmm(nh.time)} (in {fmtHours(nh.in_h)}).</>}
          </div>
        )}
        {atRisk.map((h) => {
          const isOpen = open === h.id;
          const site = twin?.sites?.find((s) => s.id === h.id);
          const proj = site?.projection;
          const more = site?.options?.one_more_pump;
          const openDraft = alerts.find((a) => a.hotspot_id === h.id && a.source === live.source && ['pending', 'drafting'].includes(a.status));
          return (
            <div key={h.id} className="card is-advisory">
              <button type="button" className="w-full text-left p-3.5" onClick={() => setExpanded(isOpen ? '' : h.id)}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-[13px] font-semibold text-fg">{h.name}</span>
                  <div className="flex items-center gap-2">
                    <LevelWithState assessment={h.assessment} />
                    <Icon name="chevronDown" size={14} className={`text-fg-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>
                <ForecastCells probs={h.assessment.probs} compact />
              </button>
              {isOpen && (
                <div className="border-t p-3.5 space-y-3">
                  <CausePanel assessment={h.assessment} compact />
                  {proj && (
                    <div className="tile text-[11px] leading-relaxed">
                      <p className="label-caps mb-1">Digital twin, next 6 h</p>
                      <ProjectionSentence projection={proj} flooding={site.flooding_now} depth={site.state.depth_cm} />
                      {more && more.peak_depth_cm < proj.peak_depth_cm && (
                        <> One more pump would cut the peak to <b>{more.peak_depth_cm} cm</b>.</>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {openDraft
                      ? <Button size="sm" variant="accent" icon="bell" onClick={() => { navigate(`/alerts?id=${openDraft.id}`); onClose(); }}>Review draft</Button>
                      : <Button size="sm" variant="accent" icon="sparkles" onClick={() => draft(h)}>{h.assessment.level === 'Watch' ? 'Draft advisory' : 'Draft alert'}</Button>}
                    {live.mode !== 'replay' && LEVEL_RANK[h.assessment.level] >= 2 && (
                      <Button size="sm" variant="soft" icon="truck" disabled={!freePumps}
                        title={freePumps ? `Send a pump to ${h.pump_point}` : 'All pumps are deployed'}
                        onClick={async () => { await respond('deploy_pump', h.id); reload(); }}>
                        Deploy pump{h.response?.pumps?.length ? ` (${h.response.pumps.length} there)` : ''}
                      </Button>
                    )}
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
