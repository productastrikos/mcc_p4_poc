import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Icon } from '../ui';
import { AiTag } from './bits';
import { api, fileToBase64 } from '../../services/api';
import { useData } from '../../data/DataProvider';
import { CameraFeed } from '../../twin3d/lazy';
import { TEST_CONDITIONS, cameraInfo, liveState } from '../../twin3d/state';
import { pct } from '../../utils';

export const CCTV_TONE = { Normal: 'success', Rising: 'info', Overflowing: 'warning', 'Road Flooded': 'danger' };

/**
 * CCTV water-level check for one hotspot. The street camera's current frame
 * (or an uploaded image) is classified by the vision model, or the offline
 * check, and fed back into the live risk.
 */
export default function CCTVCheck({ hotspot }) {
  const { live, refreshLive, notify } = useData();
  const feedRef = useRef(null);
  const fileRef = useRef(null);
  const [condition, setCondition] = useState('live');
  const [still, setStill] = useState(null);   // { src, label }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const active = hotspot.cctv_reading;

  useEffect(() => { setResult(null); setStill(null); setError(null); setCondition('live'); }, [hotspot.id]);

  const test = TEST_CONDITIONS[condition];
  const base = liveState(hotspot, live?.sim_time);
  const state = test ? { ...base, ...test.state } : base;
  const info = cameraInfo(hotspot, live?.sim_time, {
    source: live?.source, banner: test ? `TEST CONDITION: ${test.label.toUpperCase()}` : undefined,
  });

  const analyze = async (b64, label) => {
    setBusy(true); setError(null); setResult(null); setStill({ src: b64, label });
    try {
      const r = await api.post('/api/cctv/analyze', { hotspot_id: hotspot.id, image_base64: b64 });
      setResult(r);
      refreshLive();
      notify(`CCTV at ${hotspot.name}: ${r.reading.status}. +1 h risk ${pct(r.before?.['1h'])} → ${pct(r.after?.['1h'])}`,
        CCTV_TONE[r.reading.status] === 'success' ? 'success' : 'warning');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const checkFrame = () => {
    const shot = feedRef.current?.capture(1280, 720);
    if (!shot) { setError('The camera view is not available in this browser (WebGL is off).'); return; }
    analyze(shot, test ? `${hotspot.cctv} test frame: ${test.label}` : `${hotspot.cctv} frame`);
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setError('Image is larger than 10 MB.'); return; }
    analyze(await fileToBase64(f), `Uploaded: ${f.name}`);
  };

  const reading = result?.reading || active;

  return (
    <Card
      title={<span className="flex items-center gap-2"><Icon name="camera" size={15} />CCTV water-level check</span>}
      subtitle={`${hotspot.cctv} at ${hotspot.roads[0]}. Check the current frame or upload one; the result confirms or tempers the forecast.`}
      actions={<AiTag>Vision</AiTag>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <CameraFeed ref={feedRef} site={hotspot} state={state} info={info} className="cctv-canvas" />
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" icon="camera" onClick={checkFrame} disabled={busy}>Check this frame</Button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
            <Button icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>Upload image</Button>
            {active && (
              <Button variant="ghost" onClick={async () => {
                try { await api.del(`/api/cctv/${hotspot.id}`); setResult(null); setStill(null); refreshLive(); notify(`CCTV reading cleared at ${hotspot.name}.`, 'info'); } catch (e) { notify(e.message, 'danger'); }
              }}>Clear reading</Button>
            )}
          </div>
          <div>
            <p className="label-caps mb-1.5">Camera view</p>
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" className={`chip-btn ${condition === 'live' ? 'is-active' : ''}`} onClick={() => setCondition('live')}>Live</button>
              {Object.entries(TEST_CONDITIONS).map(([k, c]) => (
                <button key={k} type="button" className={`chip-btn ${condition === k ? 'is-active' : ''}`} onClick={() => setCondition(k)}
                  title={`Show the camera under test conditions: ${c.label.toLowerCase()}`}>Test: {c.label}</button>
              ))}
            </div>
            {test && (
              <p className="text-[10.5px] text-fg-faint mt-1.5">
                Test conditions demonstrate the check. A checked test frame is applied to the forecast like a real one; clear the reading afterwards.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {still && (
            <figure className="space-y-1">
              <img src={still.src} alt="Frame sent for checking" className="w-full rounded-md border" />
              <figcaption className="text-[10.5px] text-fg-faint">{still.label}</figcaption>
            </figure>
          )}
          {busy && <div className="tile text-xs text-fg-muted flex items-center gap-2"><Icon name="sparkles" size={14} className="text-accent" />Analysing frame…</div>}
          {error && <div className="tile tone-danger text-xs">{error}</div>}
          {!busy && reading && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={CCTV_TONE[reading.status]} dot>{reading.status.toUpperCase()}</Badge>
                <span className="text-xs text-fg">Water on road ≈ <b>{Math.round(reading.depth_cm)} cm</b></span>
                <span className="text-xs text-fg-faint">confidence {pct(reading.confidence)}</span>
              </div>
              <p className="text-xs text-fg-muted leading-relaxed">{reading.observations}</p>
              {reading.depth_references?.length > 0 && (
                <p className="text-[11px] text-fg-faint">Depth judged from: {reading.depth_references.join(', ')}</p>
              )}
              <p className="text-[10.5px] text-fg-faint">
                Classified by <b>{reading.engine}</b>{reading.at ? ` at ${reading.at.slice(11, 16)} MYT` : ''}
                {reading.llm_error ? ` (vision model unavailable: ${reading.llm_error})` : ''}
              </p>
              {result?.before && (
                <div className="tile space-y-1.5">
                  <p className="label-caps">Effect on forecast</p>
                  {['1h', '3h', '6h'].map((k) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-fg-muted">Flood within {k}</span>
                      <span className="font-semibold text-fg tabular-nums">{pct(result.before[k])} → {pct(result.after[k])}</span>
                    </div>
                  ))}
                </div>
              )}
              {active && <p className="text-[11px] text-fg-faint">Applied to the forecast until the next sensor reading (at most 30 minutes){active.sim_time ? `, from the ${active.sim_time.slice(11, 16)} reading` : ''}.</p>}
            </>
          )}
          {!busy && !reading && !error && (
            <p className="text-xs text-fg-faint leading-relaxed">
              The frame is classified as Normal, Rising, Overflowing or Road Flooded with an estimated depth, read from the
              flood gauge staff when it is in view. The reading is fused with the model forecast as a confirmation signal
              (a Bayesian odds update weighted by confidence).
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
