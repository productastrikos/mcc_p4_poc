import * as THREE from 'three';

/*
 * Procedural canvas textures for the 3D twin, so the app ships no image assets.
 *
 * Palette rule: nothing a camera can see near the road is brown, tan, orange or
 * yellow. Those hues are reserved for sediment-laden flood water, which the
 * offline CCTV check looks for (server/cctv.py).
 */

const cache = new Map();

/** Seeded random numbers (mulberry32), so each site always looks the same. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(key, w, h, draw, { srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h);
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

/** A copy that shares the image but has its own repeat. */
export function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function speckle(g, w, h, n, colors, rMin, rMax, alpha, rand) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.4 + 0.6 * rand());
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    const r = rMin + (rMax - rMin) * rand();
    g.fillRect(rand() * w, rand() * h, r, r);
  }
  g.globalAlpha = 1;
}

function blotches(g, w, h, n, color, rMin, rMax, alpha, rand) {
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rMin + (rMax - rMin) * rand();
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = alpha * (0.5 + 0.5 * rand());
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.globalAlpha = 1;
}

/** Asphalt, 512 px for 8 m: aggregate, patch repairs and tyre polish. */
export function asphalt() {
  return texture('asphalt', 512, 512, (g, w, h) => {
    const rand = rng(7);
    g.fillStyle = '#505357';
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 30, '#3c3f43', 30, 110, 0.5, rand);
    blotches(g, w, h, 18, '#5d6064', 30, 90, 0.35, rand);
    speckle(g, w, h, 9000, ['#2f3236', '#6a6d71', '#45484c', '#7a7d80'], 1, 2.4, 0.7, rand);
    g.globalAlpha = 0.18;   // tyre tracks (the texture runs along the road)
    g.fillStyle = '#34373b';
    [0.27, 0.42, 0.58, 0.73].forEach((v) => g.fillRect(0, v * h - 10, w, 20));
    g.globalAlpha = 1;
  });
}

export function concrete(key = 'concrete', base = '#a6a6a2') {
  return texture(key, 512, 512, (g, w, h) => {
    const rand = rng(11);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 40, '#8a8a86', 20, 90, 0.35, rand);
    blotches(g, w, h, 20, '#bdbdb8', 20, 70, 0.3, rand);
    speckle(g, w, h, 6000, ['#7d7d79', '#c4c4bf', '#94948f'], 1, 2, 0.5, rand);
    g.strokeStyle = 'rgba(70,70,68,0.45)';   // expansion joints
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  });
}

/** Dark weathered concrete for the inside of drains (algae, silt lines). */
export function drainWall() {
  return texture('drainwall', 256, 256, (g, w, h) => {
    const rand = rng(13);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#8f918c');
    grad.addColorStop(0.55, '#6b6f69');
    grad.addColorStop(1, '#3f4641');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 30, '#3a4a3c', 10, 50, 0.35, rand);
    speckle(g, w, h, 3000, ['#555a55', '#9a9c97'], 1, 2, 0.5, rand);
  });
}

export function paving() {
  return texture('paving', 256, 256, (g, w, h) => {
    const rand = rng(17);
    g.fillStyle = '#9fa7aa';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      for (let x = 0; x < w; x += 32) {
        const v = 150 + Math.floor(rand() * 18);
        g.fillStyle = `rgb(${v - 6},${v + 2},${v + 6})`;
        g.fillRect(x + 1, y + 1, 30, 30);
      }
    }
    speckle(g, w, h, 1200, ['#7d8689', '#b9c1c4'], 1, 2, 0.4, rand);
  });
}

export function grass() {
  return texture('grass', 256, 256, (g, w, h) => {
    const rand = rng(19);
    g.fillStyle = '#5b7047';
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 25, '#4a5e3a', 10, 40, 0.5, rand);
    blotches(g, w, h, 25, '#6a7f55', 10, 40, 0.4, rand);
    blotches(g, w, h, 8, '#7b7f6a', 8, 24, 0.25, rand);
    for (let i = 0; i < 2500; i++) {
      g.strokeStyle = rand() > 0.5 ? '#66794f' : '#435537';
      g.globalAlpha = 0.6;
      const x = rand() * w;
      const y = rand() * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4); g.stroke();
    }
    g.globalAlpha = 1;
  });
}

/** Tidal mud on the creek bed and banks (only seen from the air). */
export function mud() {
  return texture('mud', 256, 256, (g, w, h) => {
    const rand = rng(23);
    g.fillStyle = '#5a5246';
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 40, '#4a443a', 10, 40, 0.5, rand);
    blotches(g, w, h, 20, '#6d6556', 10, 30, 0.4, rand);
    speckle(g, w, h, 2000, ['#3e3a33', '#777061'], 1, 2, 0.4, rand);
  });
}

/** Corrugated zinc roof, blue-grey. */
export function roofMetal(key = 'roof', base = [88, 102, 114]) {
  return texture(key, 256, 256, (g, w, h) => {
    const [r, gr, b] = base;
    for (let x = 0; x < w; x += 8) {
      const k = Math.sin((x / 8) * Math.PI) * 0.5 + 0.5;
      g.fillStyle = `rgb(${r - 14 * k},${gr - 14 * k},${b - 14 * k})`;
      g.fillRect(x, 0, 4, h);
      g.fillStyle = `rgb(${r + 8},${gr + 8},${b + 8})`;
      g.fillRect(x + 4, 0, 4, h);
    }
    const rand = rng(29);
    blotches(g, w, h, 12, '#3d4650', 10, 50, 0.3, rand);
  });
}

/** Steel drain grating. */
export function grating() {
  return texture('grating', 128, 128, (g, w, h) => {
    g.fillStyle = '#1d1f21';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5b6064';
    for (let x = 0; x < w; x += 12) g.fillRect(x, 0, 5, h);
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 4);
  });
}

const WALLS = ['#dcdcd6', '#ccd7dd', '#c3d4c8', '#d9ccd0', '#d0d5d9', '#bccadb', '#d6d9cf', '#e2e2dc'];

/** Weathering common on tropical buildings: grime at the base and streaks under ledges. */
function weather(g, w, h, rand, streaks) {
  const base = g.createLinearGradient(0, h * 0.82, 0, h);
  base.addColorStop(0, 'rgba(40,46,46,0)');
  base.addColorStop(1, 'rgba(40,46,46,0.35)');
  g.fillStyle = base;
  g.fillRect(0, h * 0.82, w, h * 0.18);
  for (let i = 0; i < streaks; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.7;
    const len = h * (0.08 + rand() * 0.25);
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, 'rgba(45,52,52,0.22)');
    gr.addColorStop(1, 'rgba(45,52,52,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, 2 + rand() * 6, len);
  }
}
const BOARDS = [
  ['#b3202a', '#ffffff'], ['#1e4f9a', '#ffffff'], ['#1f7a46', '#ffffff'], ['#ffffff', '#b3202a'],
  ['#ffffff', '#1e4f9a'], ['#262a30', '#ffffff'],
];
const TRADES = ['KEDAI RUNCIT', 'RESTORAN', 'FARMASI', 'KEDAI MOTOSIKAL', 'KEDAI GUNTING', 'KEDAI KOPI',
  'PERKAKASAN', 'KLINIK', 'KEDAI TAYAR', 'DOBI', 'KEDAI EMAS', 'BAKERI', 'KEDAI TELEFON', 'BENGKEL'];
const NAMES = ['SRI', 'MIRI', 'JAYA', 'BARU', 'MAJU', 'SENTOSA', 'KASIH', 'MESRA', 'ADONG', 'PUJUT', 'SEJAHTERA', 'INDAH'];

/**
 * Upper floors of one 6 m shophouse bay: windows, AC units and the shop's
 * signboard along the bottom (mounted above the five-foot way).
 * Returns { map, emissive } (lit windows at night).
 */
export function shopUpper(seed, floors) {
  const key = `shopU-${seed}-${floors}`;
  if (cache.has(key)) return cache.get(key);
  const W = 384;
  const H = Math.round(W * ((floors * 3.4 + 1.0) / 6));   // upper floors plus parapet
  const plan = rng(seed);
  const wall = WALLS[Math.floor(plan() * WALLS.length)];
  const board = BOARDS[Math.floor(plan() * BOARDS.length)];
  const name = `${TRADES[Math.floor(plan() * TRADES.length)]} ${NAMES[Math.floor(plan() * NAMES.length)]}`;
  const choices = Array.from({ length: floors * 2 * 3 }, () => plan());
  const draw = (g, mask) => {
    let ci = 0;
    const rand = () => choices[ci++];
    g.fillStyle = mask ? '#000' : wall;
    g.fillRect(0, 0, W, H);
    const px = W / 6;   // px per metre
    if (!mask) {
      const r2 = rng(seed + 1);
      blotches(g, W, H, 14, 'rgba(60,66,70,0.6)', 10, 50, 0.2, r2);
      weather(g, W, H, r2, 16);
      g.fillStyle = 'rgba(0,0,0,0.12)';   // pilasters
      g.fillRect(0, 0, 0.35 * px, H);
      g.fillRect(W - 0.35 * px, 0, 0.35 * px, H);
      g.fillStyle = 'rgba(255,255,255,0.35)';   // parapet cornice
      g.fillRect(0, 0.8 * px, W, 0.12 * px);
    }
    for (let f = 0; f < floors; f++) {
      const top = H - (f + 1) * 3.4 * px;
      for (let k = 0; k < 2; k++) {
        const x = (0.8 + k * 2.6) * px;
        const y = top + 0.7 * px;
        const ww = 1.8 * px;
        const wh = 1.5 * px;
        const on = rand() > 0.45;
        const louvre = rand() > 0.5;
        const ac = rand() > 0.55;
        if (mask) {
          if (on) { g.fillStyle = '#fbeedd'; g.fillRect(x + 4, y + 4, ww - 8, wh - 8); }
          continue;
        }
        g.fillStyle = '#f4f4f0';
        g.fillRect(x - 4, y - 4, ww + 8, wh + 8);
        const glass = g.createLinearGradient(x, y, x + ww, y + wh);
        glass.addColorStop(0, '#5d7484');
        glass.addColorStop(1, '#2f3f4b');
        g.fillStyle = glass;
        g.fillRect(x, y, ww, wh);
        g.strokeStyle = '#e8e8e4';
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(x + ww / 2, y); g.lineTo(x + ww / 2, y + wh); g.stroke();
        if (louvre) {   // louvred upper panes
          g.strokeStyle = 'rgba(230,230,226,0.8)';
          g.lineWidth = 1.5;
          for (let yy = y + 4; yy < y + wh * 0.35; yy += 5) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + ww, yy); g.stroke(); }
        }
        if (ac) {   // AC condenser under the window
          g.fillStyle = '#d7d9d6';
          g.fillRect(x + ww * 0.2, y + wh + 0.18 * px, 0.75 * px, 0.5 * px);
          g.fillStyle = '#9ea1a0';
          g.beginPath(); g.arc(x + ww * 0.2 + 0.37 * px, y + wh + 0.43 * px, 0.17 * px, 0, Math.PI * 2); g.fill();
        }
      }
    }
    // Signboard band at the bottom of the upper facade. At night it glows in
    // its own colours (the mask is the sign, dimmed) so the lettering stays readable.
    const by = H - 1.05 * px;
    g.fillStyle = board[0];
    g.fillRect(0.3 * px, by, W - 0.6 * px, 0.95 * px);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 3;
    g.strokeRect(0.3 * px, by, W - 0.6 * px, 0.95 * px);
    g.fillStyle = board[1];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 0.5 * px;
    g.font = `800 ${size}px Arial, sans-serif`;
    while (g.measureText(name).width > W - 1.2 * px && size > 10) { size -= 2; g.font = `800 ${size}px Arial, sans-serif`; }
    g.fillText(name, W / 2, by + 0.48 * px);
    if (mask) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0.3 * px, by, W - 0.6 * px, 0.95 * px);
    }
  };
  const c = canvas(W, H);
  draw(c.getContext('2d'), false);
  const m = canvas(W, H);
  draw(m.getContext('2d'), true);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(m);
  emissive.colorSpace = THREE.SRGBColorSpace;
  const out = { map, emissive };
  cache.set(key, out);
  return out;
}

/** Ground-floor shopfront: roller shutter, glazing and goods inside. */
export function shopFront(seed) {
  const key = `shopF-${seed}`;
  if (cache.has(key)) return cache.get(key);
  const W = 384;
  const H = Math.round(W * (3.2 / 6));
  const plan = rng(seed * 3 + 5);
  const open = plan() > 0.25;
  const goods = Array.from({ length: 9 * 5 }, () => plan());
  const px = W / 6;
  const drawIt = (g, mask) => {
    let ci = 0;
    const rand = () => goods[ci++];
    g.fillStyle = mask ? '#000' : '#d8dbd8';
    g.fillRect(0, 0, W, H);
    const sx = 0.5 * px;
    const sw = W - px;
    if (mask && !open) return;
    if (open) {
      // The night mask is the shop interior itself: fluorescent tubes at the
      // ceiling, light falling off towards the floor, goods glowing in their colours.
      const inner = g.createLinearGradient(0, 0, 0, H);
      inner.addColorStop(0, mask ? '#a3aaa6' : '#3c4247');
      inner.addColorStop(1, mask ? '#3a3e3c' : '#1f2326');
      g.fillStyle = inner;
      g.fillRect(sx, 0.3 * px, sw, H - 0.3 * px);
      for (let i = 0; i < 9; i++) {   // shelves and goods
        g.fillStyle = ['#c8ccd0', '#8aa0b4', '#b84a4a', '#5f8f6a', '#e8e8e8'][Math.floor(rand() * 5)];
        g.globalAlpha = 0.55;
        g.fillRect(sx + rand() * sw * 0.9, 0.8 * px + rand() * (H - 1.6 * px), 0.3 * px + rand() * px, 0.25 * px + rand() * 0.6 * px);
      }
      g.globalAlpha = 1;
      g.fillStyle = mask ? '#000' : '#9ea3a6';   // shutter rolled up
      g.fillRect(sx, 0.3 * px, sw, 0.35 * px);
      if (mask) return;
    } else {
      for (let y = 0.3 * px; y < H; y += 6) {   // closed roller shutter
        g.fillStyle = y % 12 < 6 ? '#b8bcbf' : '#a2a6a9';
        g.fillRect(sx, y, sw, 6);
      }
    }
    g.fillStyle = '#c4c8c6';
    g.fillRect(0, 0, W, 0.3 * px);
  };
  const c = canvas(W, H);
  drawIt(c.getContext('2d'), false);
  const m = canvas(W, H);
  drawIt(m.getContext('2d'), true);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(m);
  emissive.colorSpace = THREE.SRGBColorSpace;
  const out = { map, emissive };
  cache.set(key, out);
  return out;
}

/** Front of a terrace house: door, windows with grilles, vent blocks. */
export function terraceFront(seed, floors) {
  const key = `terr-${seed}-${floors}`;
  if (cache.has(key)) return cache.get(key);
  const W = 320;
  const H = Math.round(W * ((floors * 3.1) / 6));
  const plan = rng(seed * 7 + 3);
  const wall = WALLS[Math.floor(plan() * WALLS.length)];
  const lights = Array.from({ length: floors * 2 }, () => plan());
  const px = W / 6;
  const drawIt = (g, mask) => {
    let ci = 0;
    const rand = () => lights[ci++];
    g.fillStyle = mask ? '#000' : wall;
    g.fillRect(0, 0, W, H);
    for (let f = 0; f < floors; f++) {
      const base = H - f * 3.1 * px;
      const wins = f === 0 ? [[3.3, 1.2, 1.7]] : [[0.7, 1.4, 1.4], [3.3, 1.4, 1.4]];
      wins.forEach(([x0, w0, h0]) => {
        const x = x0 * px;
        const y = base - (1.0 + h0) * px;
        const on = rand() > 0.4;
        if (mask) { if (on) { g.fillStyle = '#fbeedd'; g.fillRect(x, y, w0 * px * 1.3, h0 * px); } return; }
        g.fillStyle = '#34444f';
        g.fillRect(x, y, w0 * px * 1.3, h0 * px);
        g.strokeStyle = '#f2f2ee';
        g.lineWidth = 2;
        for (let gx = x; gx <= x + w0 * px * 1.3; gx += 9) { g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + h0 * px); g.stroke(); }
        g.strokeRect(x, y, w0 * px * 1.3, h0 * px);
      });
      if (f === 0 && !mask) {   // front door
        g.fillStyle = '#5b6770';
        g.fillRect(1.2 * px, base - 2.2 * px, 1.0 * px, 2.2 * px);
        g.fillStyle = '#c9ced1';
        g.fillRect(2.0 * px, base - 1.2 * px, 0.06 * px, 0.2 * px);
      }
      if (!mask) {   // vent blocks
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < 6; k++) g.fillRect((0.6 + k * 0.25) * px, base - 2.9 * px, 0.18 * px, 0.18 * px);
      }
    }
    if (!mask) {
      const r2 = rng(seed + 9);
      blotches(g, W, H, 10, 'rgba(60,66,70,0.6)', 10, 40, 0.18, r2);
      weather(g, W, H, r2, 8);
    }
  };
  const c = canvas(W, H);
  drawIt(c.getContext('2d'), false);
  const m = canvas(W, H);
  drawIt(m.getContext('2d'), true);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(m);
  emissive.colorSpace = THREE.SRGBColorSpace;
  const out = { map, emissive };
  cache.set(key, out);
  return out;
}

/** Plain side or back wall of a building. */
export function plainWall(seed) {
  return texture(`plain-${seed}`, 128, 128, (g, w, h) => {
    const rand = rng(seed);
    g.fillStyle = WALLS[Math.floor(rand() * WALLS.length)];
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 8, 'rgba(60,66,70,0.6)', 8, 30, 0.2, rand);
    weather(g, w, h, rand, 6);
  });
}

/**
 * Flood depth marker staff, 1.0 m in 10 cm bands, red on the odd decimetres
 * and white on the even ones. The top band (90-100 cm) is red so the top
 * edge is easy to find; plain bands keep the reading clean at a distance.
 */
export function gaugeStaff() {
  return texture('gauge', 64, 512, (g, w, h) => {
    const band = h / 10;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i % 2 === 0 ? '#d21f2b' : '#f5f5f2';   // i = 0 is the top band
      g.fillRect(0, i * band, w, band);
    }
  });
}

/** Tileable ripple normal map for water surfaces (linear colour). */
export function waterNormal() {
  return texture('waternormal', 256, 256, (g, w, h) => {
    const rand = rng(31);
    const waves = [];
    for (let i = 0; i < 14; i++) {
      waves.push({ kx: Math.floor(rand() * 9) - 4, ky: Math.floor(rand() * 9) - 4, a: 0.4 + rand(), p: rand() * 6.28 });
    }
    const hgt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        waves.forEach((q) => { v += q.a * Math.sin(((q.kx * x) / w + (q.ky * y) / h) * Math.PI * 2 + q.p); });
        hgt[y * w + x] = v;
      }
    }
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = hgt[y * w + ((x + 1) % w)] - hgt[y * w + ((x - 1 + w) % w)];
        const dy = hgt[((y + 1) % h) * w + x] - hgt[((y - 1 + h) % h) * w + x];
        const nx = -dx * 0.25;
        const ny = -dy * 0.25;
        const len = Math.hypot(nx, ny, 1);
        const i = (y * w + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

/**
 * Equirectangular sky. `look` is { top, horizon, ground, cloud, cover }.
 * Not cached: the sky changes with the time of day and the weather.
 */
export function skyCanvas(look, seed = 3) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, look.top);
  grad.addColorStop(0.47, look.horizon);
  grad.addColorStop(0.5, look.horizon);
  grad.addColorStop(0.53, look.ground);
  grad.addColorStop(1, look.ground);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rand = rng(seed);
  const n = Math.round(40 + look.cover * 260);
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const y = H * (0.12 + rand() * 0.34);
    const rx = 30 + rand() * 120 * (0.5 + look.cover);
    const ry = rx * (0.25 + rand() * 0.2);
    [x, x - W, x + W].forEach((xx) => {
      const gr = g.createRadialGradient(xx, y, 0, xx, y, rx);
      gr.addColorStop(0, look.cloud);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.25 + 0.5 * look.cover;
      g.fillStyle = gr;
      g.save();
      g.translate(xx, y);
      g.scale(1, ry / rx);
      g.translate(-xx, -y);
      g.fillRect(xx - rx, y - rx, 2 * rx, 2 * rx);
      g.restore();
    });
  }
  g.globalAlpha = 1;
  return c;
}

/** "Road closed" sign for the barrier. */
export function closedSign() {
  return texture('closedsign', 256, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c4161c';
    g.lineWidth = 12;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#c4161c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 34px Arial, sans-serif';
    g.fillText('JALAN DITUTUP', w / 2, h * 0.38, w - 40);
    g.font = '800 24px Arial, sans-serif';
    g.fillText('ROAD CLOSED', w / 2, h * 0.7, w - 60);
  });
}

/** Red and white stripes for water-filled barriers. */
export function barrierStripes() {
  return texture('barrier', 128, 64, (g, w, h) => {
    g.fillStyle = '#f2f2f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c81e28';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill();
    }
  });
}

/** Noise tiles for the CCTV grain. */
export function noiseCanvas(seed) {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const rand = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
