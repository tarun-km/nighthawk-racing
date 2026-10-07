// Body shells for the two cars + the livery atlas mapping.
// Pure geometry (no DOM), so the same code runs in the browser and in the
// node script that renders the Canva livery templates (scripts/livery-uv.mjs).
//
// Local car axes: +X forward, +Y up, +Z right. Origin = physics body centre.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';

// ---------------------------------------------------------------------------
// Vehicle specs: physics layout + body bounds (for the livery projection).
// ---------------------------------------------------------------------------
export const VEHICLES = {
  // Classic: a smooth retro Cruiser. Long hood, pontoon fenders, chrome.
  classic: {
    key: 'classic',
    name: 'Cruiser',
    wheelRadius: 0.42,
    rest: 0.28,
    wheels: [
      { x: 1.1, z: 0.86, front: true },
      { x: 1.1, z: -0.86, front: true },
      { x: -1.06, z: 0.88, front: false },
      { x: -1.06, z: -0.88, front: false },
    ],
    collider: { hx: 1.7, hy: 0.36, hz: 0.98, y: 0.0 },
    mass: 150,
    com: -0.32,
    suspension: { stiffness: 40, compression: 4.8, relaxation: 3.8, travel: 0.25 },
    tuning: { grip: 3.8, steerHigh: 0.23, maxSpeed: 35, boostSpeed: 50, boostImpulse: 2900 },
    bounds: { x: [-1.78, 1.82], y: [-0.44, 0.5], z: [-1.1, 1.1] },
    seat: { x: -0.42, y: 0.14 },
    steering: { x: 0.12, y: 0.62, tilt: 0.5 },
  },
  // Ultra: an off-road Buggy. Big knobby wheels, roll cage, long travel.
  ultra: {
    key: 'ultra',
    name: 'Buggy',
    wheelRadius: 0.56,
    rest: 0.36,
    wheels: [
      { x: 1.0, z: 1.04, front: true },
      { x: 1.0, z: -1.04, front: true },
      { x: -1.0, z: 1.04, front: false },
      { x: -1.0, z: -1.04, front: false },
    ],
    collider: { hx: 1.45, hy: 0.42, hz: 0.95, y: 0.1 },
    mass: 140,
    com: -0.42,
    suspension: { stiffness: 26, compression: 3.6, relaxation: 2.8, travel: 0.42 },
    tuning: { grip: 3.2, maxSpeed: 36.5, boostSpeed: 55, boostImpulse: 3300 },
    bounds: { x: [-1.48, 1.58], y: [-0.36, 0.66], z: [-0.98, 0.98] },
    seat: { x: -0.18, y: 0.1 },
    steering: { x: 0.36, y: 0.58, tilt: 0.7 },
  },
};

// ---------------------------------------------------------------------------
// Livery atlas: 2048 x 2048, six projected views. Shared with the templates.
// ---------------------------------------------------------------------------
export const LIVERY = {
  size: 2048,
  regions: {
    top: { x: 40, y: 40, w: 1190, h: 735, label: 'TOP  (front of car  →)' },
    front: { x: 1270, y: 40, w: 735, h: 420, label: 'FRONT' },
    rear: { x: 1270, y: 500, w: 735, h: 420, label: 'REAR' },
    right: { x: 40, y: 815, w: 1190, h: 420, label: 'RIGHT SIDE  (front  →)' },
    left: { x: 40, y: 1275, w: 1190, h: 420, label: 'LEFT SIDE  (←  front)' },
    under: { x: 1270, y: 960, w: 735, h: 735, label: 'UNDERSIDE' },
  },
};
const REGION_IDS = ['top', 'front', 'rear', 'right', 'left', 'under'];

function liveryFrame(spec) {
  const { x: [x0, x1], y: [y0, y1], z: [z0, z1] } = spec.bounds;
  const L = x1 - x0, H = y1 - y0, W = z1 - z0;
  const R = LIVERY.regions;
  const S = Math.min(R.top.w / L, R.top.h / W, R.right.w / L, R.right.h / H, R.front.w / W, R.front.h / H);
  // centre each projection inside its rectangle
  // the underside gets its own (smaller) scale; nobody sees much of it
  const Su = Math.min(R.under.w / L, R.under.h / W);
  const off = (r, a, b, k = S) => [r.x + (r.w - a * k) / 2, r.y + (r.h - b * k) / 2];
  return { x0, x1, y0, y1, z0, z1, S, Su, o: {
    top: off(R.top, L, W), front: off(R.front, W, H), rear: off(R.rear, W, H),
    right: off(R.right, L, H), left: off(R.left, L, H), under: off(R.under, L, W, Su),
  } };
}

// Atlas pixel position (y down) of a point for a given projected view.
export function liveryProject(frame, region, x, y, z) {
  const { x0, x1, y1, z0, z1, S, Su, o } = frame;
  const [ox, oy] = o[region];
  switch (region) {
    case 'top': return [ox + (x - x0) * S, oy + (z - z0) * S];
    case 'right': return [ox + (x - x0) * S, oy + (y1 - y) * S];
    case 'left': return [ox + (x1 - x) * S, oy + (y1 - y) * S];
    case 'front': return [ox + (z1 - z) * S, oy + (y1 - y) * S];
    case 'rear': return [ox + (z - z0) * S, oy + (y1 - y) * S];
    default: return [ox + (x - x0) * Su, oy + (z1 - z) * Su];
  }
}

function pickRegion(n) {
  if (n.y > 0.55) return 'top';
  if (n.y < -0.6) return 'under';
  if (Math.abs(n.z) >= Math.abs(n.x)) return n.z > 0 ? 'right' : 'left';
  return n.x > 0 ? 'front' : 'rear';
}

// Box-projects every triangle into the atlas. Stores the region of each
// triangle in geometry.userData.regions (used by the template renderer).
export function applyLiveryUV(geo, spec) {
  if (geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const frame = liveryFrame(spec);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const regions = new Uint8Array(pos.count / 3);
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const region = pickRegion(n);
    regions[i / 3] = REGION_IDS.indexOf(region);
    for (const [k, v] of [[0, a], [1, b], [2, c]]) {
      const [px, py] = liveryProject(frame, region, v.x, v.y, v.z);
      uv[(i + k) * 2] = px / LIVERY.size;
      uv[(i + k) * 2 + 1] = 1 - py / LIVERY.size;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.userData.regions = regions;
  geo.userData.frame = frame;
  return geo;
}
export { REGION_IDS };

// ---------------------------------------------------------------------------
// CSG helpers
// ---------------------------------------------------------------------------
function prep(g) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  return g;
}

class Sculpt {
  constructor(geo) {
    this.ev = new Evaluator();
    this.ev.attributes = ['position', 'normal'];
    this.ev.useGroups = false;
    this.brush = new Brush(prep(geo));
    this.brush.updateMatrixWorld();
  }

  #op(geo, op, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const b = new Brush(prep(geo));
    b.position.set(...pos);
    b.rotation.set(...rot);
    b.scale.set(...scale);
    b.updateMatrixWorld();
    this.brush = this.ev.evaluate(this.brush, b, op);
    return this;
  }

  add(geo, pos, rot, scale) { return this.#op(geo, ADDITION, pos, rot, scale); }
  cut(geo, pos, rot, scale) { return this.#op(geo, SUBTRACTION, pos, rot, scale); }
  get geometry() { return this.brush.geometry; }
}

// Side silhouette (XY) extruded across the width with deep bevels.
function extrudeProfile(points, width, bevel, size = bevel * 0.85) {
  const s = new THREE.Shape();
  points.forEach((p, i) => {
    if (i === 0) s.moveTo(p[0], p[1]);
    else if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.lineTo(p[0], p[1]);
  });
  s.closePath();
  const depth = Math.max(0.01, width - bevel * 2);
  let g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: size, bevelSegments: 12, curveSegments: 48 });
  g.translate(0, 0, -depth / 2);
  g = toCreasedNormals(prep(g), 0.7);
  return g;
}

function ellipsoid(segW = 96, segH = 48) {
  return toCreasedNormals(prep(new THREE.SphereGeometry(1, segW, segH)), 1.2);
}

function wheelWell(radius, depth) {
  const g = new THREE.CylinderGeometry(radius, radius, depth, 96, 1);
  g.rotateX(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Classic Cruiser: boat-tail roadster with pontoon fenders and running boards.
// ---------------------------------------------------------------------------
function cruiserShell(spec) {
  const R = spec.wheelRadius;
  const body = extrudeProfile([
    [-1.42, -0.26],
    [1.22, -0.26],
    [1.5, -0.26, 1.5, -0.08], // chin
    [1.52, 0.08], // grille face
    [1.47, 0.2, 1.22, 0.24], // nose top
    [0.62, 0.3, 0.22, 0.34], // long hood up to the cowl
    [-0.72, 0.34], // beltline
    [-1.28, 0.34, -1.52, 0.1], // boat-tail
    [-1.6, -0.08],
    [-1.58, -0.26, -1.42, -0.26],
  ], 1.3, 0.16, 0.14);

  const sc = new Sculpt(body);
  const fender = ellipsoid();
  for (const w of spec.wheels) {
    const side = Math.sign(w.z);
    const fx = w.front ? 0.66 : 0.62;
    sc.add(fender, [w.x + (w.front ? 0.06 : -0.04), -0.06, side * 0.82], [0, 0, w.front ? -0.06 : 0.08], [fx, 0.4, 0.27]);
  }
  // running boards join front and rear fenders
  for (const side of [1, -1]) {
    sc.add(new RoundedBoxGeometry(1.5, 0.1, 0.36, 6, 0.045), [0.02, -0.3, side * 0.82]);
  }
  // wheel wells, cockpit tub
  for (const w of spec.wheels) {
    sc.cut(wheelWell(R + 0.08, 0.7), [w.x, -spec.rest, Math.sign(w.z) * 0.86]);
  }
  sc.cut(new RoundedBoxGeometry(1.2, 1.0, 1.0, 8, 0.24), [-0.38, 0.64, 0]);
  return sc.geometry;
}

// ---------------------------------------------------------------------------
// Ultra Buggy: wedge tub with side pods, engine deck and a skid-plate nose.
// ---------------------------------------------------------------------------
function buggyShell() {
  const body = extrudeProfile([
    [-1.12, -0.24],
    [0.86, -0.24],
    [1.34, 0.0], // skid plate
    [1.44, 0.16],
    [1.4, 0.26, 1.2, 0.3], // nose
    [0.3, 0.4], // cowl
    [-0.62, 0.4],
    [-0.74, 0.52], // engine deck step
    [-1.18, 0.52],
    [-1.34, 0.52, -1.36, 0.32],
    [-1.32, -0.08],
    [-1.3, -0.24, -1.12, -0.24],
  ], 1.24, 0.08, 0.07);

  const sc = new Sculpt(body);
  // side pods (nitro tanks live under these) with three cooling slots each
  for (const side of [1, -1]) {
    sc.add(new RoundedBoxGeometry(1.0, 0.34, 0.26, 6, 0.08), [-0.05, -0.02, side * 0.68]);
    for (let i = 0; i < 3; i++) {
      sc.cut(new RoundedBoxGeometry(0.2, 0.05, 0.2, 3, 0.02), [-0.3 + i * 0.25, 0.05, side * 0.8]);
    }
  }
  sc.cut(new RoundedBoxGeometry(1.0, 1.0, 1.0, 6, 0.16), [-0.12, 0.62, 0]);
  // intake scoop on the engine deck
  sc.cut(new RoundedBoxGeometry(0.34, 0.2, 0.5, 4, 0.06), [-0.98, 0.56, 0]);
  return sc.geometry;
}

// Builds the shell with livery UVs. Cached per car: CSG is the slow part.
const cache = {};
export function buildShell(spec) {
  if (cache[spec.key]) return cache[spec.key];
  // three-bvh-csg still passes a renamed BVH option, which warns once per
  // operation; keep the console clean while the shell is carved.
  const warn = console.warn;
  console.warn = (...a) => { if (!String(a[0]).includes('maxLeafSize')) warn(...a); };
  let raw;
  try { raw = spec.key === 'classic' ? cruiserShell(spec) : buggyShell(spec); } finally { console.warn = warn; }
  const geo = applyLiveryUV(raw, spec);
  geo.computeBoundingSphere();
  cache[spec.key] = geo;
  return geo;
}
