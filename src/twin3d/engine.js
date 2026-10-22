import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildSiteScene, RIG } from './siteScene';
import { noiseCanvas, rng } from './textures';

/*
 * One WebGL renderer shared by every 3D view on the page (twin cards, the
 * inspector and CCTV feeds). Each view renders into the shared canvas on its
 * own schedule and is copied into the view's 2D canvas, so the page never
 * holds more than one GL context. CCTV views get a camera look on the copy:
 * sensor noise, softer colour, vignette, lens drops and the on-screen text.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

class Engine {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setScissorTest(true);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.size = { w: 0, h: 0 };
    this.scenes = new Map();
    this.views = new Set();
    this.noise = [1, 2, 3].map((s) => noiseCanvas(s));
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  ensureSize(w, h) {
    if (w <= this.size.w && h <= this.size.h) return;
    this.size = { w: Math.max(w, this.size.w), h: Math.max(h, this.size.h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
  }

  site(site) {
    let s = this.scenes.get(site.id);
    if (!s) {
      s = buildSiteScene(site);
      this.scenes.set(site.id, s);
    }
    return s;
  }

  add(view) { this.views.add(view); }

  remove(view) { this.views.delete(view); }

  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) return;
    const due = [];
    this.views.forEach((v) => {
      if (!v.visible || !v.width) return;
      const fps = this.reducedMotion ? Math.min(v.fps, 2) : v.fps;
      if (now - v.last >= 1000 / fps) due.push(v);
    });
    // Interactive views first, then whichever has waited longest; at most 3 per frame.
    due.sort((a, b) => (b.interactive - a.interactive) || (a.last - b.last));
    const start = performance.now();
    for (let i = 0; i < due.length && i < 3; i++) {
      if (i > 0 && performance.now() - start > 12) break;
      this.render(due[i], now);
    }
  }

  /** Render a view into the shared canvas, then copy it out. */
  draw(view, now, w, h) {
    const s = this.site(view.site);
    const st = view.stateAt(now);
    const t = this.reducedMotion ? 0 : now / 1000;
    s.apply(st, t, this.pmrem);
    this.ensureSize(w, h);
    const cam = view.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    this.renderer.toneMappingExposure = s.look.exposure;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.render(s.scene, cam);
    return { s, st, srcY: this.size.h - h };
  }

  render(view, now) {
    view.last = now;
    if (view.controls) view.controls.update();
    const { width: w, height: h } = view;
    const { s, st, srcY } = this.draw(view, now, w, h);
    const ctx = view.ctx;
    if (view.kind === 'cctv') {
      cctvLook(ctx, this.canvas, srcY, w, h, s.look.dark, st, view.overlay?.(), now, this.noise);
    } else {
      ctx.drawImage(this.canvas, 0, srcY, w, h, 0, 0, w, h);
    }
    view.afterRender?.(view.camera, w, h, s);
  }

  /**
   * A still at a fixed size (for the vision check), as a JPEG data URL. The
   * on-screen banner (e.g. "TEST CONDITION") is left out so the classifier
   * judges the scene, not the caption.
   */
  capture(view, w = 1280, h = 720) {
    const now = performance.now();
    const { s, st, srcY } = this.draw(view, now, w, h);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    const info = { ...(view.overlay?.() || {}), banner: undefined };
    if (view.kind === 'cctv') cctvLook(ctx, this.canvas, srcY, w, h, s.look.dark, st, info, now, this.noise);
    else ctx.drawImage(this.canvas, 0, srcY, w, h, 0, 0, w, h);
    return out.toDataURL('image/jpeg', 0.9);
  }
}

/** Copy a rendered frame with a CCTV look and burn in the camera text. */
function cctvLook(ctx, src, srcY, w, h, dark, st, info = {}, now, noise) {
  // Cameras raise the gain at night: brighter, noisier, flatter colour.
  const gain = 1 + dark * 0.55;
  ctx.filter = `saturate(${0.82 - dark * 0.12}) contrast(1.06) brightness(${gain.toFixed(2)}) blur(${(0.35 + dark * 0.25).toFixed(2)}px)`;
  ctx.drawImage(src, 0, srcY, w, h, 0, 0, w, h);
  ctx.filter = 'none';

  // Sensor noise.
  const tile = noise[Math.floor(now / 90) % noise.length];
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16 + dark * 0.14;
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.translate(-((now * 0.37) % 256), -((now * 0.21) % 256));
  ctx.fillRect(0, 0, w + 256, h + 256);
  ctx.restore();

  // Raindrops on the lens dome.
  if ((st.rain || 0) > 0.5) {
    const r = rng(Math.floor(now / 4000));
    const n = Math.min(14, Math.round(2 + st.rain / 4));
    ctx.save();
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = (0.012 + r() * 0.03) * w;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
    }
    ctx.restore();
  }

  // Vignette.
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${0.42 + dark * 0.1})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // On-screen text.
  const fs = Math.max(10, Math.round(h * 0.034));
  ctx.font = `600 ${fs}px Consolas, "Courier New", monospace`;
  ctx.textBaseline = 'top';
  const pad = Math.round(fs * 0.6);
  const text = (s, x, y, align = 'left', color = 'rgba(240,240,240,0.95)') => {
    ctx.textAlign = align;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };
  text(`${info.camera || 'CAM'}  ${info.place || ''}`.trim(), pad, pad);
  text(info.clock || '', w - pad, pad, 'right');
  if (info.sub) text(info.sub, pad, pad + fs * 1.3, 'left', 'rgba(220,220,220,0.85)');
  const blink = Math.floor(now / 600) % 2 === 0;
  text(`${blink ? '●' : ' '} REC`, pad, h - pad - fs, 'left', 'rgba(255,90,90,0.95)');
  if (info.banner) {
    ctx.font = `800 ${fs}px Consolas, "Courier New", monospace`;
    const bw = ctx.measureText(info.banner).width + pad * 2;
    ctx.fillStyle = 'rgba(180,20,30,0.82)';
    ctx.fillRect(w / 2 - bw / 2, h - pad - fs * 1.25, bw, fs * 1.5);
    text(info.banner, w / 2, h - pad - fs * 1.05, 'center', '#fff');
    ctx.font = `600 ${fs}px Consolas, "Courier New", monospace`;
  }
  ctx.font = `600 ${Math.round(fs * 0.8)}px Consolas, "Courier New", monospace`;
  text('SIMULATED FEED', w - pad, h - pad - fs * 0.8, 'right', 'rgba(230,230,230,0.7)');
}

let engine = null;
let failed = null;

/** The shared engine, or null when WebGL is not available. */
export function getEngine() {
  if (engine || failed) return engine;
  try {
    engine = new Engine();
  } catch (e) {
    failed = e;
    engine = null;
  }
  return engine;
}

/**
 * A view of one site. `kind` is 'aerial' (fixed oblique), 'orbit' (user
 * controlled) or 'cctv' (the site's street camera). `getState()` returns the
 * state to show; levels glide to new values rather than jumping.
 */
export class View {
  constructor({ site, kind, canvas, getState, fps, overlay, afterRender }) {
    this.site = site;
    this.kind = kind;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getState = getState;
    this.overlay = overlay;
    this.afterRender = afterRender;
    this.fps = fps || (kind === 'orbit' ? 40 : kind === 'cctv' ? 12 : 6);
    this.interactive = kind === 'orbit' ? 1 : 0;
    this.visible = true;
    this.last = -1e9;
    this.width = 0;
    this.height = 0;
    this.shown = null;
    this.prevNow = null;
    const rig = RIG[kind] || RIG.aerial;
    const R = (site.elevation_m ?? 2) + 1.35;
    this.camera = new THREE.PerspectiveCamera(rig.fov, 16 / 9, 0.3, 2000);
    this.camera.position.set(rig.pos[0], R + rig.pos[1], rig.pos[2]);
    this.target = new THREE.Vector3(rig.look[0], R + rig.look[1], rig.look[2]);
    this.camera.lookAt(this.target);
    if (kind === 'orbit') {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.target.copy(this.target);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 8;
      this.controls.maxDistance = 140;
      this.controls.maxPolarAngle = Math.PI * 0.47;
      this.controls.update();
    }
  }

  resize(w, h) {
    this.width = Math.max(1, Math.round(w));
    this.height = Math.max(1, Math.round(h));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.last = -1e9;
  }

  /** Smoothly approach the target state (about a second to settle). */
  stateAt(now) {
    const target = this.getState() || {};
    const dt = this.prevNow == null ? 1 : Math.min(1, (now - this.prevNow) / 1000);
    this.prevNow = now;
    if (!this.shown) this.shown = { ...target };
    const k = clamp01(dt * 2.5);
    const out = { ...target, view: this.kind };
    ['drain', 'depth', 'tide', 'rain'].forEach((key) => {
      const a = this.shown[key] ?? target[key] ?? 0;
      const b = target[key] ?? 0;
      out[key] = Math.abs(b - a) < 0.01 ? b : a + (b - a) * k;
    });
    this.shown = out;
    return out;
  }

  resetView() {
    if (!this.controls) return;
    const rig = RIG.orbit;
    const R = (this.site.elevation_m ?? 2) + 1.35;
    this.camera.position.set(rig.pos[0], R + rig.pos[1], rig.pos[2]);
    this.controls.target.set(rig.look[0], R + rig.look[1], rig.look[2]);
    this.controls.update();
  }

  dispose() {
    this.controls?.dispose();
  }
}
