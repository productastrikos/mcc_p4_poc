import React, { useEffect, useState } from 'react';
import { Button, Icon, Modal } from '../ui';
import { useData } from '../../data/DataProvider';
import { api } from '../../services/api';
import { dayTime } from '../../utils';

/** Situation report built by the server from the same live snapshot the dashboard shows. */
export default function SitrepModal({ onClose }) {
  const { operatorName, notify } = useData();
  const [rep, setRep] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    try { setRep(await api.get(`/api/sitrep?operator=${encodeURIComponent(operatorName)}`)); } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => {
    const blob = new Blob([rep.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MSCCC-SITREP-${rep.sim_time.slice(0, 13).replace(/[-T:]/g, '')}${rep.source !== 'live' ? '-EXERCISE' : ''}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(rep.markdown); notify('SITREP copied to the clipboard.'); } catch (e) { notify('Could not copy: select the text instead.', 'danger'); }
  };

  return (
    <Modal title="Situation report (SITREP)" eyebrow="Shift handover · JPBD Miri" width={760} onClose={onClose}
      subtitle={rep ? `Sensor time ${dayTime(rep.sim_time)} MYT${rep.source !== 'live' ? ' · EXERCISE' : ''}` : 'Building…'}
      footer={(
        <>
          <Button variant="ghost" icon="refresh" onClick={load}>Refresh</Button>
          <Button variant="secondary" icon="clipboard" onClick={copy} disabled={!rep}>Copy</Button>
          <Button icon="download" onClick={download} disabled={!rep}>Download .md</Button>
        </>
      )}>
      {error && <div className="tile tone-danger text-xs">{error}</div>}
      {!rep && !error && <p className="text-xs text-fg-faint flex items-center gap-2"><Icon name="clock" size={14} />Building the report…</p>}
      {rep && <pre className="sitrep">{rep.markdown}</pre>}
    </Modal>
  );
}
