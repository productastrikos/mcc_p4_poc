import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as T from './textures';

/*
 * One hotspot as a 3D street, in metres. y is height above chart datum, the
 * datum of the tide gauge, so the tide, the outfall invert and the road are
 * on one scale. +x is east (towards the creek), +z is north. Traffic keeps
 * left, as in Malaysia.
 *
 * Driven by the same numbers as the hydraulic model (server/physics.py):
 *   depth   road water above the road edge (the Smart Drain's above-rim gauge)
 *   drain   % of the 1.2 m drain depth
 *   tide    water level in the receiving creek
 *   block   how far the tide or river has shut the outfall's flap gate
 */
export const TIDE_MEAN_M = 1.35;   // mean sea level above chart datum (physics.py)
const ROAD_HALF = 3.35;            // carriageway half-width
const CAMBER = 0.09;               // crown above the road edge: shallow water stays in the gutters
const DRAIN_W = 0.9;
const WALL = 0.15;
const DRAIN_D = 1.2;
const DRAIN_OUT = ROAD_HALF + 2 * WALL + DRAIN_W;   // outer face of the drain (4.55)
const X_W = -140;                  // west end of the modelled road
const X_J0 = 10.5;                 // cross road (junction) band
const X_J1 = 17.5;
const BUND_X = 20;                 // flood wall or creek bank
const Z_FAR = 140;
const BAY = 6;                     // shophouse / terrace frontage
const ROW_X0 = -52;

/** Fixed positions shared with the camera rigs and the HUD (y relative to the road). */
export const RIG = {
  // Street camera on a lamp pole, looking east along the road towards the outfall.
  cctv: { pos: [-23.7, 6.2, -4.6], look: [-2, -3.0, 1.6], fov: 40 },
  // Overview from above the creek, looking west up the street.
  aerial: { pos: [58, 19, -36], look: [-2, -2, 0], fov: 38 },
  orbit: { pos: [60, 21, -38], look: [0, -1, 0], fov: 40 },
  gauge: [-16, -3.2],
  sensor: [-19.5, -3.95],
  lamps: [-46, -24, -2],
  barrierX: -10.5,
};

const ARCH = {
  'pujut-adong': { north: 'shop', northFloors: 2, south: 'terrace', southFloors: 1, seed: 11 },
  'tanjung-batu': { north: 'shop', northFloors: 3, south: 'terrace', southFloors: 1, seed: 23 },
  'taman-tunku': { north: 'terrace', northFloors: 2, south: 'terrace', southFloors: 2, seed: 37 },
  'senadin-mcot': { north: 'shop', northFloors: 3, south: 'shop', southFloors: 2, seed: 41 },
  'desa-senadin': { north: 'terrace', northFloors: 1, south: 'terrace', southFloors: 1, seed: 53 },
  'tudan-desaras': { north: 'terrace', northFloors: 2, south: 'terrace', southFloors: 1, seed: 67, hills: true },
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const col = (hex) => new THREE.Color(hex);
const mixCol = (a, b, t) => col(a).lerp(col(b), clamp01(t));

function std(opts) {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...opts });
}

function boxAt(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A box spanning [x0,x1] x [y0,y1] x [z0,z1]. */
function slab(x0, x1, y0, y1, z0, z1, mat) {
  const m = boxAt(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}

/** A quad rising (or falling) along x from (x0, y0) to (x1, y1), spanning z0..z1, facing up. */
function sheet(x0, y0, x1, y1, z0, z1, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y0, z1, x1, y1, z1, x1, y1, z0, x0, y0, z0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 3, 1, 2, 3]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** Camber across a road of half-width `half`, 0 at the edges. */
const camberAt = (off, half = ROAD_HALF) => CAMBER * Math.max(0, 1 - (off / half) ** 2);

function waterMaterial(color, normalTex, opacity = 0.9) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.12, metalness: 0.0, transparent: true, opacity,
    normalMap: normalTex, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.7,
  });
}

/** Side profile (x along the car, y up) extruded across its width, centred on z = 0. */
function profile(points, width, bevel) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4,
  });
  return geo.translate(0, 0, -(width - 2 * bevel) / 2);
}

const CAR_PARTS = (() => {
  const wheel = (x, z) => new THREE.CylinderGeometry(0.32, 0.32, 0.22, 18).rotateX(Math.PI / 2).translate(x, 0.32, z);
  const lamp = (x, y, z, h, d) => new THREE.BoxGeometry(0.06, h, d).translate(x, y, z);
  // A small hatchback / sedan: lower body to the belt line, a narrower glasshouse, a roof panel.
  const body = profile([[-2.12, 0.28], [2.1, 0.28], [2.16, 0.6], [2.02, 0.86], [1.1, 1.0], [-1.65, 1.0], [-2.12, 0.9]], 1.76, 0.06);
  const glass = profile([[-1.58, 0.98], [1.08, 0.98], [0.42, 1.4], [-1.3, 1.39]], 1.56, 0.03);
  const roof = profile([[-1.3, 1.38], [0.42, 1.39], [0.4, 1.45], [-1.28, 1.44]], 1.5, 0);
  return {
    paint: mergeGeometries([body, roof]),
    glass,
    wheels: mergeGeometries([wheel(1.32, 0.8), wheel(1.32, -0.8), wheel(-1.32, 0.8), wheel(-1.32, -0.8)]),
    head: mergeGeometries([lamp(2.13, 0.72, 0.6, 0.14, 0.36), lamp(2.13, 0.72, -0.6, 0.14, 0.36)]),
    tail: mergeGeometries([lamp(-2.15, 0.8, 0.62, 0.14, 0.3), lamp(-2.15, 0.8, -0.62, 0.14, 0.3)]),
  };
})();
const GLASS = std({ color: '#1c252d', roughness: 0.1, metalness: 0.3 });
const TYRE = std({ color: '#151617', roughness: 0.9 });

/** A car facing +x. Its head and tail lamps light up at night. */
function car(color) {
  const g = new THREE.Group();
  const paint = std({ color, roughness: 0.35, metalness: 0.5 });
  const head = new THREE.MeshStandardMaterial({ color: '#dfe6ea', emissive: '#fff6e0', emissiveIntensity: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: '#5a1014', emissive: '#ff2020', emissiveIntensity: 0 });
  [[CAR_PARTS.paint, paint], [CAR_PARTS.glass, GLASS], [CAR_PARTS.wheels, TYRE],
    [CAR_PARTS.head, head], [CAR_PARTS.tail, tail]].forEach(([geo, mat], i) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = i < 2;
    g.add(m);
  });
  g.userData.lights = [head, tail];
  return g;
}

/** Trees and nipah palms as instanced meshes (few draw calls). */
function vegetation(scene, trees, palms) {
  const trunkMat = std({ color: '#47423e' });
  const leafMat = std({ color: '#3b6631', roughness: 0.95, flatShading: true });
  const frondMat = std({ color: '#3d6a32', side: THREE.DoubleSide, flatShading: true });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 8).translate(0, 1.3, 0), trunkMat, trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), leafMat, trees.length * 3);
    trees.forEach((t, i) => {
      trunk.setMatrixAt(i, m4.compose(v.set(t.x, t.y, t.z), q.identity(), s.setScalar(t.s)));
      const r = T.rng(i * 13 + 1);
      for (let k = 0; k < 3; k++) {
        const rad = (1.2 + r() * 0.9) * t.s;
        crown.setMatrixAt(i * 3 + k, m4.compose(
          v.set(t.x + (r() - 0.5) * 1.4 * t.s, t.y + (3 + r() * 1.2) * t.s, t.z + (r() - 0.5) * 1.4 * t.s), q.identity(), s.setScalar(rad)));
      }
    });
    crown.castShadow = true;
    scene.add(trunk, crown);
  }
  if (palms.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0), trunkMat, palms.length);
    const frond = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 2.6, 3).translate(0, 1.3, 0), frondMat, palms.length * 7);
    palms.forEach((p, i) => {
      trunk.setMatrixAt(i, m4.compose(v.set(p.x, p.y, p.z), q.identity(), s.set(p.s, p.h, p.s)));
      for (let k = 0; k < 7; k++) {
        e.set(0, (k / 7) * Math.PI * 2 + i, -Math.PI / 2.8, 'YXZ');
        q.setFromEuler(e);
        frond.setMatrixAt(i * 7 + k, m4.compose(v.set(p.x, p.y + p.h, p.z), q, s.setScalar(p.s)));
      }
    });
    scene.add(trunk, frond);
  }
}

/** A polyline path and the pose at distance s along it. */
function makePath(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    segs.push({ x0, z0, x1, z1, len, start: total });
    total += len;
  }
  return {
    total,
    at(s) {
      const d = ((s % total) + total) % total;
      const seg = segs.find((g) => d <= g.start + g.len) || segs[segs.length - 1];
      const t = (d - seg.start) / seg.len;
      return { x: lerp(seg.x0, seg.x1, t), z: lerp(seg.z0, seg.z1, t), heading: Math.atan2(seg.z1 - seg.z0, seg.x1 - seg.x0) };
    },
  };
}

function arc(cx, cz, r, a0, a1, n = 8) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return pts;
}

/** Sun elevation (degrees) and direction for the MYT hour; Miri is at 4.4 N, sun to the south in October. */
export function solar(hour) {
  const f = (hour - 6.45) / 12.15;   // sunrise about 06:27, sunset 18:36
  const el = f > -0.15 && f < 1.15 ? Math.sin(f * Math.PI) * 75 : -20;
  const a = Math.PI * clamp01(f);
  const rad = (Math.max(el, 3) * Math.PI) / 180;
  const ce = Math.cos(rad);
  const dir = new THREE.Vector3(Math.cos(a) * ce, Math.sin(rad), -0.28 * Math.sin(a) * ce).normalize();
  return { el, dir };
}

/** Build the scene for one hotspot. */
export function buildSiteScene(site) {
  const arch = ARCH[site.id] || { north: 'shop', northFloors: 2, south: 'terrace', southFloors: 1, seed: 5 };
  const R = (site.elevation_m ?? 2) + TIDE_MEAN_M;     // road edge (gutter) level, chart datum
  const invert = site.outfall ?? 1.5;
  const tidal = !!site.tidal_outfall;
  const bed = tidal ? 0.1 : Math.max(0.3, invert - 0.8);
  const scene = new THREE.Scene();
  const rand = T.rng(arch.seed);

  // ── materials ──────────────────────────────────────────────────────────
  const mainLen = X_J0 - X_W;
  const asphaltMat = std({ map: T.tiled(T.asphalt(), mainLen / 8, 1), roughness: 0.9 });
  const crossMat = std({ map: T.tiled(T.asphalt(), (2 * Z_FAR) / 8, 1), roughness: 0.9 });
  const concreteMat = std({ map: T.tiled(T.concrete(), 4, 4) });
  const apronMat = std({ map: T.tiled(T.concrete(), 2, 60) });
  const kerbMat = std({ map: T.tiled(T.concrete('concrete-light', '#b4b4af'), 30, 1) });
  const drainMat = std({ map: T.tiled(T.drainWall(), 60, 1), roughness: 0.95 });
  const pavingMat = std({ map: T.tiled(T.paving(), 60, 2), roughness: 0.6 });
  const yardMat = std({ map: T.tiled(T.concrete('yard', '#a9aaa6'), 40, 2) });
  const grassMat = std({ map: T.tiled(T.grass(), 50, 40), roughness: 1 });
  const bankMat = std({ map: T.tiled(T.grass(), 2, 60), roughness: 1 });
  const mudMat = std({ map: T.tiled(T.mud(), 4, 60), roughness: 0.75 });
  const lineMat = new THREE.MeshStandardMaterial({ color: '#e9e9e4', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const normal = T.waterNormal();
  const floodNormal = T.tiled(normal, 40, 70);
  const drainNormal = T.tiled(normal, 120, 1);
  const creekNormal = T.tiled(normal, 4, 50);
  const floodMat = waterMaterial('#7d6440', floodNormal, 0.92);
  const drainWaterMat = waterMaterial('#41463f', drainNormal, 0.95);
  const creekMat = waterMaterial('#5f5a45', creekNormal, 0.95);
  const jetMat = waterMaterial('#8a7350', T.tiled(normal, 1, 3), 0.8);

  // ── roads ──────────────────────────────────────────────────────────────
  {
    const geo = new THREE.PlaneGeometry(mainLen, 2 * ROAD_HALF, Math.ceil(mainLen / 2), 16);
    geo.rotateX(-Math.PI / 2);   // local y became -z
    geo.translate(X_W + mainLen / 2, 0, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const taper = 1 - smooth(X_J0 - 4, X_J0, p.getX(i));   // flatten where it meets the cross road
      p.setY(i, R + camberAt(p.getZ(i)) * taper);
    }
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, asphaltMat);
    road.receiveShadow = true;
    scene.add(road);
  }
  {
    const half = (X_J1 - X_J0) / 2;
    const geo = new THREE.PlaneGeometry(2 * Z_FAR, 2 * half, 140, 16);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI / 2);   // length along z, width along x
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, R + camberAt(p.getX(i), half));
    geo.computeVertexNormals();
    geo.translate(X_J0 + half, 0, 0);
    const road = new THREE.Mesh(geo, crossMat);
    road.receiveShadow = true;
    scene.add(road);
  }
  // Lane markings: dashed centre lines, solid edge lines (white only).
  {
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.12).rotateX(-Math.PI / 2), lineMat, 16);
    for (let i = 0; i < 16; i++) dash.setMatrixAt(i, new THREE.Matrix4().makeTranslation(X_W + 4 + i * 9, R + CAMBER + 0.004, 0));
    scene.add(dash);
    [-1, 1].forEach((s) => {
      const z = s * (ROAD_HALF - 0.3);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(mainLen - 7, 0.1).rotateX(-Math.PI / 2), lineMat);
      edge.position.set(X_W + (mainLen - 7) / 2, R + camberAt(z) + 0.004, z);
      scene.add(edge);
    });
    const crossDash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 3).rotateX(-Math.PI / 2), lineMat, 30);
    for (let i = 0; i < 30; i++) {
      crossDash.setMatrixAt(i, new THREE.Matrix4().makeTranslation((X_J0 + X_J1) / 2, R + CAMBER + 0.004, -Z_FAR + 6 + i * 9.4));
    }
    scene.add(crossDash);
  }

  // ── drains: open U-drains on both sides of the main road ──────────────
  [-1, 1].forEach((s) => {
    const zIn = s * (ROAD_HALF + WALL);
    const zOut = s * (ROAD_HALF + WALL + DRAIN_W);
    const lo = (a, b) => Math.min(a, b);
    const hi = (a, b) => Math.max(a, b);
    scene.add(slab(X_W, X_J0, R - DRAIN_D, R, lo(s * ROAD_HALF, zIn), hi(s * ROAD_HALF, zIn), kerbMat));
    scene.add(slab(X_W, X_J0, R - DRAIN_D, R + 0.02, lo(zOut, s * DRAIN_OUT), hi(zOut, s * DRAIN_OUT), kerbMat));
    scene.add(slab(X_W, X_J0, R - DRAIN_D - 0.15, R - DRAIN_D, lo(zIn, zOut), hi(zIn, zOut), drainMat));
    // Stained inner faces, facing into the channel.
    [zIn, zOut].forEach((zz, k) => {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(mainLen, DRAIN_D), drainMat);
      const into = k === 0 ? s : -s;   // +1: the channel is on the +z side of this face
      face.position.set(X_W + mainLen / 2, R - DRAIN_D / 2, zz + into * 0.003);
      face.rotation.y = into > 0 ? 0 : Math.PI;
      scene.add(face);
    });
  });
  // Steel gratings at driveways; the drain stays open in front of the camera.
  const grateMat = std({ map: T.tiled(T.grating(), 2, 2), roughness: 0.6, metalness: 0.6 });
  for (let x = X_W + 8; x < X_J0 - 2; x += 12) {
    if (x > -30 && x < -10) continue;
    scene.add(slab(x, x + 1.2, R - 0.04, R + 0.01, -(ROAD_HALF + WALL + DRAIN_W), -(ROAD_HALF + WALL), grateMat));
  }
  for (let x = X_W + 14; x < X_J0 - 2; x += 18) {
    scene.add(slab(x, x + 1.2, R - 0.04, R + 0.01, ROAD_HALF + WALL, ROAD_HALF + WALL + DRAIN_W, grateMat));
  }
  const drainWater = [-1, 1].map((s) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(mainLen, DRAIN_W).rotateX(-Math.PI / 2), drainWaterMat);
    m.position.set(X_W + mainLen / 2, R - DRAIN_D * 0.7, s * (ROAD_HALF + WALL + DRAIN_W / 2));
    scene.add(m);
    return m;
  });

  // ── ground either side ────────────────────────────────────────────────
  const northShop = arch.north === 'shop';
  const southShop = arch.south === 'shop';
  scene.add(slab(X_W, X_J0, R - DRAIN_D, R + 0.25, DRAIN_OUT, 9, northShop ? pavingMat : yardMat));
  scene.add(slab(X_W, X_J0, R - DRAIN_D, R + 0.25, -9, -DRAIN_OUT, southShop ? pavingMat : yardMat));
  scene.add(slab(X_W, X_J0, R - 1.5, R + 0.3, 9, Z_FAR, grassMat));
  scene.add(slab(X_W, X_J0, R - 1.5, R + 0.3, -Z_FAR, -9, grassMat));
  // Apron between the cross road and the creek, with the outfall sump.
  scene.add(slab(X_J1, BUND_X, R - 1.5, R + 0.12, -Z_FAR, Z_FAR, apronMat));
  scene.add(slab(X_J1 + 0.25, BUND_X - 0.35, R + 0.12, R + 0.15, -5.4, -2.6, grateMat));

  // ── creek, flood wall or bank, outfall ────────────────────────────────
  let creekX0;
  let exitX;
  if (tidal) {
    // Tidal sites sit behind a flood wall; the drains only reach the creek through the gate.
    const wall = slab(BUND_X, BUND_X + 0.5, bed - 0.5, R + 0.55, -Z_FAR, Z_FAR, concreteMat);
    wall.castShadow = true;
    scene.add(wall);
    creekX0 = BUND_X + 0.5;
    exitX = creekX0;
  } else {
    const run = (R + 0.12 - bed) * 1.1;
    scene.add(sheet(BUND_X, R + 0.12, BUND_X + run, bed, -Z_FAR, Z_FAR, bankMat));
    creekX0 = BUND_X + run;
    exitX = BUND_X + (R + 0.12 - (invert + 0.7)) * 1.1;
  }
  const creekW = 13;
  scene.add(slab(creekX0, creekX0 + creekW, bed - 2, bed, -Z_FAR, Z_FAR, mudMat));
  const farY = R - 0.2;
  const farRun = Math.max(2.5, (farY - bed) * 1.4);
  scene.add(sheet(creekX0 + creekW, bed, creekX0 + creekW + farRun, farY, -Z_FAR, Z_FAR, mudMat));
  const farX0 = creekX0 + creekW + farRun;
  scene.add(slab(farX0, farX0 + 180, farY - 2, farY, -Z_FAR, Z_FAR, grassMat));
  const creekWater = new THREE.Mesh(new THREE.PlaneGeometry(creekW + 2 * farRun, 2 * Z_FAR).rotateX(-Math.PI / 2), creekMat);
  creekWater.position.set(creekX0 + creekW / 2 + farRun / 2, bed + 0.2, 0);
  scene.add(creekWater);

  // Culvert from the sump, headwall and flap gate.
  const pipeLen = exitX - X_J1;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, pipeLen, 20, 1, true), std({ color: '#7e817d', side: THREE.DoubleSide }));
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(X_J1 + pipeLen / 2, invert + 0.3, -4);
  scene.add(pipe);
  scene.add(slab(exitX - 0.05, exitX + 0.25, invert - 0.4, invert + 1.1, -5.4, -2.6, concreteMat));
  const gatePivot = new THREE.Group();
  gatePivot.position.set(exitX + 0.28, invert + 0.68, -4);
  gatePivot.add(boxAt(0.05, 0.78, 0.82, std({ color: '#4c5a54', roughness: 0.55, metalness: 0.6 }), 0, -0.39, 0));
  scene.add(gatePivot);
  // Outflow jet: radius grows downstream; its axis points out and down at 50 degrees.
  const JET_LEN = 2;
  const jetDir = new THREE.Vector3(Math.cos(-0.87), Math.sin(-0.87), 0);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.16, JET_LEN, 12, 1, true), jetMat);
  jet.rotation.z = Math.atan2(-jetDir.x, jetDir.y);   // maps the cylinder's +y onto jetDir
  scene.add(jet);

  // ── buildings ─────────────────────────────────────────────────────────
  const roofMats = [[88, 102, 114], [96, 110, 104], [70, 78, 90]]
    .map((c, i) => std({ map: T.tiled(T.roofMetal(`roof-${i}`, c), 2, 2), roughness: 0.55, metalness: 0.4 }));
  const flatRoof = std({ map: T.tiled(T.concrete('roofslab', '#8e8f8c'), 2, 2) });
  const facadeMats = [];   // lit windows at night
  const ROW_N = Math.floor((X_J0 - 2 - ROW_X0) / BAY);

  const shopRow = (s, floors) => {   // s = +1 north side, -1 south side
    const front = s * 7.0;
    const recess = s * 9.0;
    const back = s * 20;
    const colMat = std({ color: '#d9dbd7' });
    for (let i = 0; i < ROW_N; i++) {
      const x0 = ROW_X0 + i * BAY;
      const seed = arch.seed * 1000 + (s > 0 ? 0 : 500) + i;
      const upper = T.shopUpper(seed, floors - 1);
      const shop = T.shopFront(seed);
      const wallMat = std({ map: T.plainWall(seed % 7) });
      const upMat = std({ map: upper.map, emissive: '#ffffff', emissiveMap: upper.emissive, emissiveIntensity: 0 });
      const frontMat = std({ map: shop.map, emissive: '#ffffff', emissiveMap: shop.emissive, emissiveIntensity: 0 });
      facadeMats.push(upMat, frontMat);
      const upH = (floors - 1) * 3.4 + 1.0;
      const faceIdx = s > 0 ? 5 : 4;   // BoxGeometry faces: +x, -x, +y, -y, +z, -z
      const upMats = [wallMat, wallMat, flatRoof, wallMat, wallMat, wallMat];
      upMats[faceIdx] = upMat;
      const up = new THREE.Mesh(new THREE.BoxGeometry(BAY, upH, Math.abs(back - front)), upMats);
      up.position.set(x0 + BAY / 2, R + 0.3 + 3.2 + upH / 2, (front + back) / 2);
      up.castShadow = true;
      up.receiveShadow = true;
      scene.add(up);
      const gMats = [wallMat, wallMat, wallMat, wallMat, wallMat, wallMat];
      gMats[faceIdx] = frontMat;
      const ground = new THREE.Mesh(new THREE.BoxGeometry(BAY, 3.2, Math.abs(back - recess)), gMats);
      ground.position.set(x0 + BAY / 2, R + 0.3 + 1.6, (recess + back) / 2);
      scene.add(ground);
      scene.add(boxAt(0.4, 3.2, 0.4, colMat, x0, R + 0.3 + 1.6, front + s * 0.25));
    }
  };

  const terraceRow = (s, floors) => {
    const front = s * 9.5;
    const back = s * 21;
    for (let i = 0; i < ROW_N; i++) {
      const x0 = ROW_X0 + i * BAY;
      const seed = arch.seed * 1000 + (s > 0 ? 0 : 500) + i;
      const tex = T.terraceFront(seed, floors);
      const wallMat = std({ map: T.plainWall(seed % 7) });
      const faceMat = std({ map: tex.map, emissive: '#ffffff', emissiveMap: tex.emissive, emissiveIntensity: 0 });
      facadeMats.push(faceMat);
      const h = floors * 3.1;
      const mats = [wallMat, wallMat, wallMat, wallMat, wallMat, wallMat];
      mats[s > 0 ? 5 : 4] = faceMat;
      const house = new THREE.Mesh(new THREE.BoxGeometry(BAY, h, Math.abs(back - front)), mats);
      house.position.set(x0 + BAY / 2, R + 0.3 + h / 2, (front + back) / 2);
      house.castShadow = true;
      house.receiveShadow = true;
      scene.add(house);
      // Gable roof along the row: the triangle's x becomes -z, the extrusion runs along +x.
      const depth = Math.abs(back - front) + 0.8;
      const shape = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, 1.9)]);
      const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: BAY, bevelEnabled: false }), roofMats[(i + (s > 0 ? 0 : 1)) % 3]);
      roof.rotation.y = Math.PI / 2;
      roof.position.set(x0, R + 0.3 + h, (front + back) / 2);
      roof.castShadow = true;
      scene.add(roof);
      scene.add(boxAt(BAY - 0.2, 0.12, 3.2, roofMats[2], x0 + BAY / 2, R + 0.3 + 2.7, front - s * 1.7));   // car porch
      if (rand() > 0.55) {
        const c = car(['#e8e8e8', '#9aa3a8', '#20262c', '#a8282c', '#2f5a8a'][Math.floor(rand() * 5)]);
        c.position.set(x0 + BAY / 2, R + 0.25, front - s * 2.4);
        c.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;   // nose towards the road
        scene.add(c);
      }
    }
    // Front fence along the drain (railings as instanced bars).
    const z = s * (DRAIN_OUT + 0.25);
    const len = ROW_N * BAY;
    const railMat = std({ color: '#d7dad8', roughness: 0.5, metalness: 0.4 });
    [0.12, 1.2].forEach((y) => scene.add(boxAt(len, 0.05, 0.05, railMat, ROW_X0 + len / 2, R + 0.25 + y, z)));
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 1.1, 0.025), railMat, Math.ceil(len / 0.14));
    for (let i = 0; i < bars.count; i++) bars.setMatrixAt(i, new THREE.Matrix4().makeTranslation(ROW_X0 + i * 0.14, R + 0.25 + 0.66, z));
    scene.add(bars);
  };

  if (northShop) shopRow(1, arch.northFloors); else terraceRow(1, arch.northFloors);
  if (southShop) shopRow(-1, arch.southFloors); else terraceRow(-1, arch.southFloors);

  // The neighbourhood behind the frontage: more terrace rows, merged into a few draw calls.
  // Only the front and back faces show the facade; the ends, top and bottom
  // sample a plain corner of the texture, so no window stretches across an end wall.
  const houseBox = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < 16; i++) uv.setXY(i, 0.02 + (i % 2) * 0.05, 0.94 + ((i >> 1) % 2) * 0.04);   // +x, -x, +y, -y faces
    return g;
  };
  {
    const walls = {};   // `${floors}-${variant}`: three facade variants so lit windows differ house to house
    const roofs = [[], [], []];
    [1, -1].forEach((side) => {
      [28, 48, 68, 92].forEach((z0, ri) => {
        const floors = 1 + ((ri + (side > 0 ? 1 : 0)) % 2);
        const h = floors * 3.1;
        const depth = 11;
        const zc = side * (z0 + depth / 2);
        for (let x = X_W + 16, k = 0; x < X_J0 - 4; x += BAY, k++) {
          const key = `${floors}-${(k * 7 + ri * 5 + (side > 0 ? 1 : 0)) % 3}`;
          (walls[key] = walls[key] || []).push(houseBox(BAY - 0.06, h, depth).translate(x + BAY / 2, R + 0.3 + h / 2, zc));
          const shape = new THREE.Shape([new THREE.Vector2(-(depth + 0.8) / 2, 0), new THREE.Vector2((depth + 0.8) / 2, 0), new THREE.Vector2(0, 1.8)]);
          const roof = new THREE.ExtrudeGeometry(shape, { depth: BAY, bevelEnabled: false });
          roof.rotateY(Math.PI / 2).translate(x, R + 0.3 + h, zc);
          roofs[(k + ri) % 3].push(roof);
        }
      });
    });
    Object.entries(walls).forEach(([key, list]) => {
      const [f, v] = key.split('-').map(Number);
      const tex = T.terraceFront(4000 + arch.seed * 10 + f * 3 + v, f);
      const m = new THREE.Mesh(mergeGeometries(list), std({ map: tex.map, emissive: '#ffffff', emissiveMap: tex.emissive, emissiveIntensity: 0 }));
      facadeMats.push(m.material);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    });
    roofs.forEach((list, i) => {
      const m = new THREE.Mesh(mergeGeometries(list), roofMats[i]);
      m.castShadow = true;
      scene.add(m);
    });
  }
  const trees = [];
  for (let i = 0; i < 60; i++) {
    const gap = [24.5, 43, 63, 85][i % 4];
    trees.push({ x: X_W + 20 + rand() * (X_J0 - X_W - 24), y: R + 0.3, z: (i % 2 ? 1 : -1) * (gap + rand() * 2.5), s: 0.85 + rand() * 0.45 });
  }
  for (let i = 0; i < 7; i++) trees.push({ x: X_J1 + 1.3, y: R + 0.12, z: 10 + i * 9, s: 0.8 });
  const palms = [];
  for (let i = 0; i < 90; i++) {
    palms.push({ x: farX0 + 1 + rand() * 34, y: farY, z: -Z_FAR + 6 + rand() * (2 * Z_FAR - 12), s: 0.9 + rand() * 0.5, h: 3 + rand() * 3 });
  }
  vegetation(scene, trees, palms);
  if (arch.hills) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(90, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      std({ color: '#3f6334', roughness: 1, flatShading: true }));
    hill.scale.set(1.7, 0.45, 0.7);
    hill.position.set(-30, R - 2, 150);
    scene.add(hill);
  }

  // ── street furniture: lamps, CCTV pole, Smart Drain sensor, gauge staff ──
  const poleMat = std({ color: '#8c9196', roughness: 0.5, metalness: 0.6 });
  const lampHeads = [];
  const lamps = [];
  RIG.lamps.forEach((x) => {
    const zp = -(DRAIN_OUT + 0.05);
    scene.add(boxAt(0.16, 8, 0.16, poleMat, x, R + 4, zp));
    scene.add(boxAt(0.1, 0.1, 2.2, poleMat, x, R + 7.95, zp + 1.1));
    // LED street lighting (Sarawak's main roads moved off sodium lamps).
    const headMat = new THREE.MeshStandardMaterial({ color: '#cfd6da', emissive: '#f4f7ff', emissiveIntensity: 0 });
    scene.add(boxAt(0.5, 0.12, 0.28, headMat, x, R + 7.85, zp + 2.2));
    lampHeads.push(headMat);
    const light = new THREE.PointLight('#eef2fb', 0, 32, 2);
    light.position.set(x, R + 7.6, zp + 2.2);
    scene.add(light);
    lamps.push(light);
  });
  // The street camera hangs on a bracket off the middle lamp pole.
  const [cx, cy, cz] = RIG.cctv.pos;
  scene.add(boxAt(0.5, 0.06, 0.06, poleMat, cx - 0.2, R + cy + 0.2, cz));
  scene.add(boxAt(0.36, 0.2, 0.2, std({ color: '#e8e9e6' }), cx - 0.05, R + cy + 0.05, cz));

  const [sx, sz] = RIG.sensor;
  scene.add(boxAt(0.06, 1.0, 0.06, poleMat, sx, R + 0.5, -(DRAIN_OUT + 0.1)));
  scene.add(boxAt(0.06, 0.06, 0.75, poleMat, sx, R + 0.98, (sz - DRAIN_OUT - 0.1) / 2));
  scene.add(boxAt(0.26, 0.16, 0.22, std({ color: '#e3e5e2' }), sx, R + 0.88, sz));
  const ledMat = new THREE.MeshStandardMaterial({ color: '#1d9e4b', emissive: '#22c55e', emissiveIntensity: 1.2 });
  scene.add(boxAt(0.04, 0.04, 0.04, ledMat, sx - 0.14, R + 0.9, sz));
  const panel = boxAt(0.42, 0.03, 0.32, std({ color: '#1f3047', roughness: 0.3, metalness: 0.5 }), sx, R + 1.12, -(DRAIN_OUT + 0.1));
  panel.rotation.x = -0.4;
  scene.add(panel);

  // Flood depth gauge staff at the road edge, its painted face turned to the camera.
  const [gx, gz] = RIG.gauge;
  const gaugeTex = T.gaugeStaff();
  const gaugeMat = std({ map: gaugeTex, roughness: 0.45, emissive: '#ffffff', emissiveMap: gaugeTex, emissiveIntensity: 0 });
  const plain = std({ color: '#d0d2d0' });
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.0, 0.3), [gaugeMat, plain, plain, plain, plain, plain]);
  const toCam = Math.atan2(cz - gz, cx - gx);
  gauge.rotation.y = -toCam;   // turns the +x face towards the camera
  gauge.position.set(gx, R + 0.5, gz);
  scene.add(gauge);
  scene.add(boxAt(0.05, 1.35, 0.05, poleMat, gx - 0.05 * Math.cos(toCam), R + 0.67, gz - 0.05 * Math.sin(toCam)));

  // ── vehicles (keep left) ──────────────────────────────────────────────
  const paths = [
    // Eastbound on the main road, left turn north onto the cross road.
    { path: makePath([[X_W, -1.7], [X_J0 - 2, -1.7], ...arc(X_J0 - 2, 5.55, 7.25, -Math.PI / 2, 0), [15.75, Z_FAR]]), main: true },
    // Southbound on the cross road, right turn west onto the main road.
    { path: makePath([[12.25, Z_FAR], [12.25, 5.45], ...arc(8.5, 5.45, 3.75, 0, -Math.PI / 2), [X_W, 1.7]]), main: true },
    { path: makePath([[15.75, -Z_FAR], [15.75, Z_FAR]]), main: false },
    { path: makePath([[12.25, Z_FAR], [12.25, -Z_FAR]]), main: false },
  ];
  const traffic = ['#e9e9e6', '#20262c', '#9aa3a8', '#a8282c', '#2f5a8a', '#e9e9e6', '#5a636b', '#d8dcdf'].map((c, i) => {
    const m = car(c);
    scene.add(m);
    return { mesh: m, route: paths[i % 4], phase: (i * 0.37) % 1 };
  });
  [[-34, 2.35], [-7, 2.35]].forEach(([x, z], i) => {   // parked at the north kerb, facing west
    const m = car(i ? '#9aa3a8' : '#e9e9e6');
    m.position.set(x, R + camberAt(z), z);
    m.rotation.y = Math.PI;
    scene.add(m);
  });

  // ── response: mobile pumps and road closure ──────────────────────────
  const pumpMat = std({ color: '#2c5aa0', roughness: 0.45, metalness: 0.3 });
  const hoseMat = std({ color: '#16191c', roughness: 0.7 });
  const pumps = [0, 1, 2, 3].map((k) => {
    const g = new THREE.Group();
    const z0 = -8.6 - k * 3.4;
    const px = X_J1 + 1.25;
    const base = R + 0.12;
    g.add(boxAt(1.4, 1.1, 2.4, pumpMat, px, base + 0.95, z0));
    g.add(boxAt(1.42, 0.18, 2.42, std({ color: '#eef0f2' }), px, base + 1.2, z0));
    g.add(boxAt(0.1, 0.5, 0.1, std({ color: '#3a3d40' }), px + 0.35, base + 1.75, z0 + 0.8));
    const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14).rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(mergeGeometries([0.75, -0.75].flatMap((dz) => [
      wheel.clone().translate(px - 0.75, base + 0.32, z0 + dz), wheel.clone().translate(px + 0.75, base + 0.32, z0 + dz)])), hoseMat));
    const suction = new THREE.CatmullRomCurve3([
      new THREE.Vector3(px - 0.6, base + 0.8, z0 + 1.0), new THREE.Vector3(px - 0.6, base + 0.4, -5.4),
      new THREE.Vector3(px - 0.3, base + 0.1, -4.4), new THREE.Vector3(px - 0.3, R - 0.9, -4.0)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(suction, 24, 0.08, 8), hoseMat));
    const top = tidal ? R + 0.75 : R + 0.35;
    const discharge = new THREE.CatmullRomCurve3([
      new THREE.Vector3(px + 0.6, base + 1.3, z0), new THREE.Vector3(BUND_X - 0.2, top + 0.1, z0),
      new THREE.Vector3(BUND_X + 0.7, top + 0.15, z0), new THREE.Vector3(creekX0 + 2.4, bed + 0.5, z0)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(discharge, 30, 0.1, 8), hoseMat));
    g.visible = false;
    scene.add(g);
    return g;
  });
  const barrier = new THREE.Group();
  const stripe = std({ map: T.barrierStripes(), roughness: 0.5 });
  for (let k = 0; k < 4; k++) {
    const b = boxAt(0.55, 0.9, 1.6, stripe, RIG.barrierX, R + 0.5, -2.55 + k * 1.7);
    b.castShadow = true;
    barrier.add(b);
  }
  barrier.add(boxAt(0.05, 0.8, 1.6, std({ map: T.closedSign() }), RIG.barrierX - 0.3, R + 1.65, -1.0));
  barrier.add(boxAt(0.06, 1.3, 0.06, poleMat, RIG.barrierX - 0.25, R + 0.7, -1.0));
  barrier.visible = false;
  scene.add(barrier);

  // ── floodwater over the road and everything below its surface ─────────
  const flood = new THREE.Mesh(new THREE.PlaneGeometry(BUND_X - X_W, 2 * Z_FAR).rotateX(-Math.PI / 2), floodMat);
  flood.position.set((X_W + BUND_X) / 2, R, 0);
  flood.visible = false;
  scene.add(flood);

  // ── rain ──────────────────────────────────────────────────────────────
  const RAIN_MAX = 14000;
  const seeds = new Float32Array(RAIN_MAX * 6);
  const ends = new Float32Array(RAIN_MAX * 2);
  const rr = T.rng(arch.seed + 99);
  for (let i = 0; i < RAIN_MAX; i++) {
    const a = rr();
    const b = rr();
    const c = rr();
    seeds.set([a, b, c, a, b, c], i * 6);
    ends[i * 2 + 1] = 1;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_MAX * 6), 3));
  rainGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  rainGeo.setAttribute('endp', new THREE.BufferAttribute(ends, 1));
  const rainMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uSpeed: { value: 9 }, uLen: { value: 0.55 }, uWind: { value: 0.12 },
      uMin: { value: new THREE.Vector3(-70, R - 1, -32) }, uSize: { value: new THREE.Vector3(105, 26, 64) },
      uColor: { value: new THREE.Color('#c9d3dc') }, uOpacity: { value: 0.35 },
    },
    vertexShader: `
      attribute vec3 seed; attribute float endp;
      uniform float uTime, uSpeed, uLen, uWind; uniform vec3 uMin, uSize;
      void main() {
        vec3 p = uMin + seed * uSize;
        p.y = uMin.y + mod(seed.y * uSize.y - uTime * uSpeed * (0.85 + 0.3 * seed.z), uSize.y) + endp * uLen;
        p.x += endp * uWind;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);

  // ── sky, sun and fog ──────────────────────────────────────────────────
  const skyTex = new THREE.CanvasTexture(T.skyCanvas({ top: '#5f93c9', horizon: '#cfe0ea', ground: '#8a9196', cloud: '#ffffff', cover: 0.3 }));
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), skyMat);
  sky.position.y = R;
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat));
  const hemi = new THREE.HemisphereLight('#dfe8f0', '#5b5f55', 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e0', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(-12, R, 0);
  scene.add(sun, sun.target);
  scene.fog = new THREE.FogExp2('#c6d1d8', 0.004);
  const envCache = new Map();
  let envKey = null;
  let skyKey = null;
  const look = { exposure: 1, dark: 0 };

  /**
   * Set every moving part from a state:
   *   { rain, drain, depth, tide, block: {tide, river}, pumps, roadsClosed, hour }
   * `t` (seconds) drives what moves on its own: rain, traffic, ripples.
   */
  function apply(st, t, pmrem) {
    const rainR = Math.max(0, st.rain || 0);
    const depth = Math.max(0, st.depth || 0);
    const drainF = clamp01((st.drain || 0) / 100);
    const tide = st.tide ?? TIDE_MEAN_M;
    const hour = st.hour ?? 12;

    // Water levels.
    flood.visible = depth >= 0.3;
    flood.position.y = R + depth / 100;
    const dl = depth > 0 ? R - 0.005 : R - DRAIN_D + DRAIN_D * drainF;
    drainWater.forEach((m) => { m.position.y = dl; m.visible = drainF > 0.02 || depth > 0; });
    // Base flow is dark; storm runoff carries silt and turns brown as the drain fills.
    drainWaterMat.color.copy(mixCol('#41463f', '#7b6442', smooth(0.45, 0.85, drainF)));
    const creekY = Math.max(tide, bed + 0.15);
    creekWater.position.y = creekY;

    // Flap gate: pushed shut by the tide or the river, swung open by the outflow.
    const blocked = Math.max(st.block?.tide || 0, st.block?.river || 0) / 100;
    const flow = smooth(0.05, 0.6, drainF) * (1 - smooth(0.55, 0.9, blocked));
    const open = creekY > invert + 0.62 ? 0 : flow;
    gatePivot.rotation.z = open * 0.75;
    const exitY = invert + 0.05;
    const drop = exitY - creekY;
    jet.visible = open > 0.15 && drop > 0.05;
    if (jet.visible) {
      const len = Math.min(JET_LEN, Math.max(0.3, drop / 0.77));
      jet.scale.set(0.5 + open * 0.6, len / JET_LEN, 0.5 + open * 0.6);
      jet.position.set(exitX + 0.35 + jetDir.x * len / 2, exitY + jetDir.y * len / 2, -4);
    }

    // Ripples: rain roughens every surface; flowing water drifts.
    const rough = 0.35 + Math.min(1.1, rainR / 25);
    floodMat.normalScale.set(rough, rough);
    floodNormal.offset.set(t * 0.012, t * 0.008);
    drainWaterMat.normalScale.set(0.5 + flow, 0.5 + flow);
    drainNormal.offset.set(t * (0.04 + 0.25 * flow), 0);
    creekMat.normalScale.set(rough * 0.8, rough * 0.8);
    creekNormal.offset.set(t * 0.004, t * 0.01);
    jetMat.normalMap.offset.set(0, -t * 1.5);

    // Wet asphalt goes dark and glossy.
    const wet = clamp01(Math.max(rainR / 3, depth > 0 ? 1 : 0, drainF > 0.85 ? 0.6 : 0));
    [asphaltMat, crossMat].forEach((m) => {
      m.roughness = lerp(0.92, 0.3, wet);
      m.color.setScalar(lerp(1, 0.62, wet));
    });
    [concreteMat, yardMat, apronMat].forEach((m) => m.color.setScalar(lerp(1, 0.8, wet)));
    pavingMat.roughness = lerp(0.6, 0.25, wet);

    // Rain. Seen from a distance it is a haze, not a curtain of lines.
    const far = st.view !== 'cctv';
    const n = Math.round(Math.min(RAIN_MAX, rainR * 380 * (far ? 0.3 : 1)));
    rainGeo.setDrawRange(0, n * 2);
    rain.visible = n > 0;
    rainMat.uniforms.uTime.value = t;
    rainMat.uniforms.uSpeed.value = 8 + Math.min(4, rainR / 12);
    rainMat.uniforms.uOpacity.value = (0.22 + Math.min(0.25, rainR / 160)) * (far ? 0.55 : 1);

    // Light, sky and fog for the time of day and the weather.
    const { el, dir } = solar(hour);
    const dark = 1 - smooth(-7, 5, el);
    const overcast = clamp01(rainR / 12 + (drainF > 0.8 ? 0.2 : 0));
    look.dark = dark;
    const dusk = smooth(-6, 2, el) * (1 - smooth(4, 16, el));
    const skyTop = mixCol(mixCol('#5f93c9', '#7c858d', overcast), '#060a12', dark).lerp(col('#3d4f78'), dusk * 0.5 * (1 - overcast));
    const skyHor = mixCol(mixCol('#d4e3ec', '#b3bbc0', overcast), '#18202c', dark).lerp(col('#e6c2a6'), dusk * 0.6 * (1 - overcast));
    const key = `${Math.round(hour * 2)}-${Math.round(overcast * 4)}`;
    if (key !== skyKey) {
      skyKey = key;
      skyTex.image = T.skyCanvas({
        top: `#${skyTop.getHexString()}`, horizon: `#${skyHor.getHexString()}`,
        ground: `#${mixCol('#8a9196', '#0b0e13', dark).getHexString()}`,
        cloud: dark > 0.6 ? '#2a3240' : overcast > 0.5 ? '#9ba3a9' : '#ffffff',
        cover: 0.3 + overcast * 0.65,
      }, arch.seed);
      skyTex.needsUpdate = true;
    }
    if (pmrem && key !== envKey) {
      envKey = key;
      if (!envCache.has(key)) {
        if (envCache.size >= 10) {
          const [oldKey, oldTex] = envCache.entries().next().value;
          oldTex.dispose();
          envCache.delete(oldKey);
        }
        envCache.set(key, pmrem.fromScene(envScene, 0.02, 0.1, 100).texture);
      }
      scene.environment = envCache.get(key);
    }
    scene.fog.color.copy(skyHor);
    scene.fog.density = 0.0028 + overcast * 0.006 + dark * 0.002;
    sun.position.copy(sun.target.position).addScaledVector(dir, 140);
    sun.intensity = (1 - dark) * smooth(0, 12, el) * lerp(2.3, 0.5, overcast);
    sun.color.copy(mixCol('#fff4e2', '#ffc28a', 1 - smooth(5, 25, el)));
    sun.castShadow = sun.intensity > 0.4;
    // The overview views keep some moonlight and sky glow so the model stays
    // readable at night; the street camera sees the real darkness.
    hemi.intensity = lerp(lerp(0.9, 1.15, overcast), far ? 0.7 : 0.1, dark);
    hemi.color.copy(mixCol(mixCol('#dfe9f2', '#c3cad0', overcast), far ? '#7286ad' : '#33415a', dark));
    hemi.groundColor.copy(mixCol('#5f6258', far ? '#2b313b' : '#14161a', dark));
    const lampsOn = dark > 0.35 || (overcast > 0.85 && el < 25) ? 1 : 0;
    lamps.forEach((l) => { l.intensity = lampsOn * 90; });
    lampHeads.forEach((m) => { m.emissiveIntensity = lampsOn * 2.5; });
    facadeMats.forEach((m) => { m.emissiveIntensity = dark * (far ? 0.35 : 0.8); });
    gaugeMat.emissiveIntensity = dark * 0.25;
    look.exposure = lerp(1.0, 1.55, dark) * lerp(1, 1.1, overcast);

    // Smart Drain status LED.
    ledMat.emissive.set(drainF >= 0.8 || depth > 0 ? '#ef4444' : drainF >= 0.6 ? '#f59e0b' : '#22c55e');

    // Response.
    pumps.forEach((p, k) => { p.visible = k < (st.pumps || 0); });
    barrier.visible = !!st.roadsClosed;

    // Traffic slows in floodwater and stops coming once it is about 20 cm deep.
    const speed = depth > 8 ? 2.6 : wet > 0.5 ? 7 : 9.5;
    traffic.forEach((c) => {
      c.mesh.visible = !(c.route.main && st.roadsClosed) && depth <= 20;
      if (!c.mesh.visible) return;
      const p = c.route.path.at(t * speed + c.phase * c.route.path.total);
      const onMain = p.x < X_J0 - 1 && Math.abs(p.z) <= ROAD_HALF;
      c.mesh.position.set(p.x, onMain ? R + camberAt(p.z) : R + CAMBER * 0.6, p.z);
      c.mesh.rotation.y = -p.heading;
      c.mesh.userData.lights.forEach((m) => { m.emissiveIntensity = lampsOn ? 3 : 0; });
    });
  }

  return {
    scene, apply, R, look,
    anchors: {
      sensor: new THREE.Vector3(sx, R + 1.25, sz),
      gauge: new THREE.Vector3(gx, R + 1.25, gz),
      gate: new THREE.Vector3(exitX + 0.3, invert + 1.4, -4),
      creek: new THREE.Vector3(creekX0 + creekW / 2, R + 0.9, -12),
      pump: new THREE.Vector3(X_J1 + 1.25, R + 2.4, -8.6),
      barrier: new THREE.Vector3(RIG.barrierX, R + 2.4, -1),
    },
  };
}
