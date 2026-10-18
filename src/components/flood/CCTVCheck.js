import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Icon } from '../ui';
import { AiTag } from './bits';
import { api, fileToBase64, urlToBase64 } from '../../services/api';
import { useData } from '../../data/DataProvider';
import { pct } from '../../utils';

export const CCTV_TONE = { Normal: 'success', Rising: 'watch', Overflowing: 'warning', 'Road Flooded': 'danger' };

/**
 * CCTV water-level check for one hotspot. The frame is classified by the
 * vision model (or the offline heuristic) and fed back into the live risk.
 */
export default function CCTVCheck({ hotspot }) {
  const { refreshLive, notify } = useData();
  const [samples, setSamples] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const active = hotspot.cctv_reading;

  useEffect(() => { api.get('/api/cctv/samples').then(setSamples).catch(() => {}); }, []);
  useEffect(() => { setResult(null); setPreview(null); setError(null); }, [hotspot.id]);

  const analyze = async (b64, src) => {
    setBusy(true); setError(null); setResult(null); setPreview(src);
    try {
      const r = await api.post('/api/cctv/analyze', { hotspot_id: hotspot.id, image_base64: b64 });
      setResult(r);
      refreshLive();
      notify(`CCTV at ${hotspot.name}: ${r.reading.status}. +1h risk ${pct(r.before?.['1h'])} → ${pct(r.after?.['1h'])}`,
        CCTV_TONE[r.reading.status] === 'success' ? 'success' : 'warning');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setError('Image is larger than 10 MB.'); return; }
    analyze(await fileToBase64(f), URL.createObjectURL(f));
  };

  const reading = result?.reading || active;

  return (
    <Card
      title={<span className="flex items-center gap-2"><Icon name="camera" size={15} />CCTV water-level check</span>}
      subtitle={`${hotspot.cctv} · upload a frame or pick a sample. The result confirms or tempers the forecast.`}
      actions={<AiTag>Vision</AiTag>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="tile p-0 overflow-hidden flex items-center justify-center" style={{ aspectRatio: '16 / 9' }}>
            {preview
              ? <img src={preview} alt="CCTV frame being checked" className="w-full h-full object-cover" />
              : <span className="text-xs text-fg-faint flex items-center gap-2"><Icon name="camera" size={16} />No frame selected</span>}
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
            <Button icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>Upload CCTV image</Button>
            {active && <Button variant="ghost" onClick={async () => { await api.del(`/api/cctv/${hotspot.id}`); setResult(null); refreshLive(); }}>Clear reading</Button>}
          </div>
          {samples.length > 0 && (
            <div>
              <p className="label-caps mb-1.5">Sample frames (synthetic)</p>
              <div className="grid grid-cols-4 gap-2">
                {samples.map((s) => (
                  <button key={s.key} type="button" className={`thumb ${preview === s.url ? 'is-active' : ''}`} disabled={busy}
                    title={s.label} onClick={async () => analyze(await urlToBase64(s.url), s.url)}>
                    <img src={s.url} alt={s.label} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
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
                Classified by <b>{reading.engine}</b>{reading.at ? ` at ${reading.at.slice(11, 16)}` : ''}
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
              {!result && active && <p className="text-[11px] text-fg-faint">This reading is applied to the live forecast for 30 minutes.</p>}
            </>
          )}
          {!busy && !reading && !error && (
            <p className="text-xs text-fg-faint leading-relaxed">
              The frame is classified as Normal, Rising, Overflowing or Road Flooded with an estimated depth. The reading
              is fused with the model forecast as a confirmation signal (a Bayesian odds update weighted by confidence).
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
