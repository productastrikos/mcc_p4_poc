import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { getEngine, View } from './engine';

/*
 * React wrappers for engine views. These are lazy-loaded (React.lazy) so
 * three.js only downloads on pages that show a 3D view or a camera feed.
 */

/** Register a View for a canvas; keeps its size, visibility and state current. */
function useView(canvasRef, opts) {
  const viewRef = useRef(null);
  const stateRef = useRef(opts.state);
  const overlayRef = useRef(opts.overlay);
  const afterRef = useRef(opts.afterRender);
  const [failed, setFailed] = useState(false);
  stateRef.current = opts.state;
  overlayRef.current = opts.overlay;
  afterRef.current = opts.afterRender;

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = getEngine();
    if (!canvas || !engine) { setFailed(true); return undefined; }
    const view = new View({
      site: opts.site, kind: opts.kind, canvas, fps: opts.fps,
      getState: () => stateRef.current,
      overlay: () => (typeof overlayRef.current === 'function' ? overlayRef.current() : overlayRef.current),
      afterRender: (...a) => afterRef.current?.(...a),
    });
    viewRef.current = view;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) view.resize(width * dpr, height * dpr);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { view.visible = e.isIntersecting; }, { rootMargin: '100px' });
    io.observe(canvas);
    engine.add(view);
    return () => {
      ro.disconnect();
      io.disconnect();
      engine.remove(view);
      view.dispose();
      viewRef.current = null;
    };
    // The site and kind fix the view; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.site.id, opts.kind]);

  return { viewRef, failed };
}

/** Fixed oblique view of a site, for the twin cards. */
export function TwinThumb({ site, state, className = '' }) {
  const canvasRef = useRef(null);
  const { failed } = useView(canvasRef, { site, kind: 'aerial', state });
  if (failed) return <div className={`twin3d-fallback ${className}`}>3D view needs WebGL</div>;
  return <canvas ref={canvasRef} className={`twin3d-canvas ${className}`} aria-label={`${site.name} digital twin`} />;
}

const LABELS = [
  { key: 'sensor', icon: '▮' },
  { key: 'gauge', icon: '┃' },
  { key: 'gate', icon: '◧' },
  { key: 'creek', icon: '≈' },
  { key: 'pump', icon: 'P' },
  { key: 'barrier', icon: '✕' },
];

/**
 * Interactive 3D view (drag to orbit, scroll to zoom) with labels pinned to
 * the twin's elements. `labels` maps an anchor key to { text, tone } or null.
 */
export const TwinOrbit = forwardRef(function TwinOrbit({ site, state, labels = {}, className = '' }, ref) {
  const canvasRef = useRef(null);
  const tagRefs = useRef({});
  const v = new THREE.Vector3();
  const { viewRef, failed } = useView(canvasRef, {
    site, kind: 'orbit', state,
    afterRender: (camera, w, h, s) => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const placed = [];
      LABELS.forEach(({ key }) => {
        const el = tagRefs.current[key];
        if (!el) return;
        v.copy(s.anchors[key]).project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        const x = ((v.x + 1) / 2) * (w / dpr);
        let y = ((1 - v.y) / 2) * (h / dpr);
        const bw = el.offsetWidth;
        const bh = el.offsetHeight;
        // Stack labels upwards instead of letting them overlap.
        const overlaps = (yy) => placed.some((p) => Math.abs(p.x - x) < (p.w + bw) / 2 + 4 && Math.abs(p.y - yy) < bh + 2);
        for (let k = 0; k < 6 && overlaps(y); k++) y -= bh + 3;
        if (visible) placed.push({ x, y, w: bw });
        el.style.opacity = visible ? '1' : '0';
        el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      });
    },
  });
  useImperativeHandle(ref, () => ({ reset: () => viewRef.current?.resetView() }), [viewRef]);
  if (failed) return <div className={`twin3d-fallback ${className}`}>3D view needs WebGL</div>;
  return (
    <div className={`twin3d-orbit ${className}`}>
      <canvas ref={canvasRef} className="twin3d-canvas is-interactive" aria-label={`${site.name} 3D digital twin. Drag to orbit, scroll to zoom.`} />
      {LABELS.map(({ key }) => (labels[key] ? (
        <div key={key} ref={(el) => { tagRefs.current[key] = el; }} className={`twin3d-tag tone-${labels[key].tone || 'neutral'}`}>
          {labels[key].text}
        </div>
      ) : null))}
    </div>
  );
});

/**
 * A site's street camera. `info` is the burned-in text: { camera, place, clock, sub, banner }.
 * The ref exposes capture() for the vision check.
 */
export const CameraFeed = forwardRef(function CameraFeed({ site, state, info, className = '', fps }, ref) {
  const canvasRef = useRef(null);
  const { viewRef, failed } = useView(canvasRef, { site, kind: 'cctv', state, overlay: info, fps });
  useImperativeHandle(ref, () => ({
    capture: (w, h) => {
      const engine = getEngine();
      return engine && viewRef.current ? engine.capture(viewRef.current, w, h) : null;
    },
  }), [viewRef]);
  if (failed) return <div className={`twin3d-fallback ${className}`}>Camera feed needs WebGL</div>;
  return <canvas ref={canvasRef} className={`twin3d-canvas ${className}`} aria-label={`${site.cctv} camera at ${site.name}`} />;
});

export default TwinThumb;
