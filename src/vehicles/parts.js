// Shared high-poly parts and materials for both cars: wheels, steering wheels,
// lamps, nitro bottles, tubes. Wheels spin about local Z; steering wheels are
// built in the XY plane facing +Z (the driver).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLORS, wingShape } from '../brand.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- Materials ----------
let M = null;
export function materials() {
  if (M) return M;
  M = {
    chrome: new THREE.MeshStandardMaterial({ color: 0xf2f4fa, metalness: 1, roughness: 0.12 }),
    satin: new THREE.MeshStandardMaterial({ color: 0xc9ccd6, metalness: 1, roughness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.55, metalness: 0.2 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.3, metalness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x17171b, roughness: 0.92 }),
    whitewall: new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.7 }),
    ivory: new THREE.MeshPhysicalMaterial({ color: 0xefe6d2, roughness: 0.35, clearcoat: 0.8 }),
    lime: new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.38, metalness: 0.15 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfd2ff, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfffbe6, emissive: 0xfff1c0, emissiveIntensity: 2.4, roughness: 0.08 }),
    led: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f0ff, emissiveIntensity: 3, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.4, roughness: 0.2 }),
    leatherBlue: new THREE.MeshStandardMaterial({ color: 0x18307a, roughness: 0.62 }),
    leatherRed: new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.6 }),
    red: new THREE.MeshPhysicalMaterial({ color: 0xc8121f, roughness: 0.3, clearcoat: 1, metalness: 0.2 }),
    navy: new THREE.MeshPhysicalMaterial({ color: 0x0e1f8a, roughness: 0.3, clearcoat: 1, metalness: 0.2 }),
  };
  return M;
}

export function tube(points, radius, mat, { closed = false, segs = 96, radial = 20, tension = 0.5 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', tension);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, radial, closed), mat);
}

function lathe(pts, segs = 96) {
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

// Lathe along local Z (wheel axis) instead of Y.
function latheZ(pts, segs = 96) {
  const g = lathe(pts, segs);
  g.rotateX(Math.PI / 2);
  return g;
}

// Rounded tyre cross-section (superellipse) revolved around the axle.
function tyreGeo(R, rIn, halfW, squareness = 0.3, segs = 64) {
  const pts = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 - (i / n) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    const px = Math.sign(c) * Math.pow(Math.abs(c), squareness);
    const py = Math.sign(s) * Math.pow(Math.abs(s), squareness);
    pts.push([rIn + (R - rIn) * (0.5 + 0.5 * px), py * halfW]);
  }
  return latheZ(pts.reverse(), segs);
}

// ---------------------------------------------------------------------------
// Classic: whitewall tyre, painted steel wheel, chrome trim ring, dog-dish cap
// with a two-ear spinner.
// ---------------------------------------------------------------------------
export function cruiserWheel(R, paint) {
  const m = materials();
  const g = new THREE.Group();
  const halfW = 0.15;
  g.add(new THREE.Mesh(tyreGeo(R, R * 0.6, halfW, 0.26), m.rubber));
  // fine tread: two staggered rows of 48 blocks (plain boxes: they're tiny)
  const blk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.022, 0.1), m.rubber, 96);
  const q = new THREE.Quaternion(), mat4 = new THREE.Matrix4();
  for (let i = 0; i < 96; i++) {
    const row = i % 2 ? 1 : -1;
    const a = ((Math.floor(i / 2) + (row > 0 ? 0.5 : 0)) / 48) * Math.PI * 2;
    q.setFromAxisAngle(V(0, 0, 1), a);
    mat4.compose(V(-Math.sin(a) * R * 0.995, Math.cos(a) * R * 0.995, row * 0.065), q, V(1, 1, 1));
    blk.setMatrixAt(i, mat4);
  }
  g.add(blk);
  // whitewall band on the outer sidewall
  const ww = new THREE.Mesh(new THREE.RingGeometry(R * 0.66, R * 0.86, 96), m.whitewall);
  ww.position.z = halfW + 0.003;
  g.add(ww);
  // painted steel disc + chrome trim ring + dog-dish cap
  g.add(new THREE.Mesh(latheZ([[0.02, halfW - 0.02], [R * 0.3, halfW - 0.01], [R * 0.5, halfW - 0.04], [R * 0.62, halfW - 0.02], [R * 0.62, -halfW + 0.02]].map(([a, b]) => [a, b]), 96), paint));
  const trim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6, 0.018, 16, 96), m.chrome);
  trim.position.z = halfW - 0.01;
  g.add(trim);
  const cap = new THREE.Mesh(latheZ([[0, halfW + 0.07], [R * 0.16, halfW + 0.065], [R * 0.3, halfW + 0.04], [R * 0.4, halfW + 0.005], [R * 0.41, halfW - 0.01]], 96), m.chrome);
  g.add(cap);
  const ear = new THREE.Shape();
  ear.moveTo(-0.13, -0.02); ear.quadraticCurveTo(0, -0.035, 0.13, -0.02); ear.lineTo(0.13, 0.02); ear.quadraticCurveTo(0, 0.035, -0.13, 0.02); ear.closePath();
  const spinner = new THREE.Mesh(new THREE.ExtrudeGeometry(ear, { depth: 0.025, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3, curveSegments: 16 }), m.chrome);
  spinner.position.z = halfW + 0.06;
  g.add(spinner);
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 32), m.lime);
  dot.rotation.x = Math.PI / 2;
  dot.position.z = halfW + 0.09;
  g.add(dot);
  return g;
}

// ---------------------------------------------------------------------------
// Ultra: knobby off-road tyre, black beadlock rim, lime ring with bolts.
// ---------------------------------------------------------------------------
export function buggyWheel(R) {
  const m = materials();
  const g = new THREE.Group();
  const halfW = 0.22;
  g.add(new THREE.Mesh(tyreGeo(R * 0.93, R * 0.58, halfW, 0.35, 64), m.rubber));
  // staggered chevron lugs across the tread + shoulder lugs on the sidewall
  const lugGeo = new RoundedBoxGeometry(0.13, 0.07, 0.17, 1, 0.02);
  const N = 22;
  const lugs = new THREE.InstancedMesh(lugGeo, m.rubber, N * 4);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), mat4 = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < N; i++) {
    for (const [row, off, yaw] of [[-1, 0, 0.35], [1, 0.5, -0.35]]) {
      const a = ((i + off) / N) * Math.PI * 2;
      e.set(0, yaw, a);
      q.setFromEuler(e);
      mat4.compose(V(-Math.sin(a) * R * 0.95, Math.cos(a) * R * 0.95, row * 0.1), q, V(1, 1, 1));
      lugs.setMatrixAt(k++, mat4);
    }
    for (const side of [-1, 1]) {
      const a = ((i + 0.25) / N) * Math.PI * 2;
      e.set(0, 0, a);
      q.setFromEuler(e);
      mat4.compose(V(-Math.sin(a) * R * 0.86, Math.cos(a) * R * 0.86, side * (halfW - 0.01)), q, V(0.8, 1.3, 0.35));
      lugs.setMatrixAt(k++, mat4);
    }
  }
  g.add(lugs);
  // rim barrel + dished face
  const barrel = new THREE.CylinderGeometry(R * 0.6, R * 0.6, halfW * 1.8, 72, 1, true);
  barrel.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(barrel, m.black));
  g.add(new THREE.Mesh(latheZ([[0.05, halfW * 0.3], [R * 0.2, halfW * 0.35], [R * 0.45, halfW * 0.55], [R * 0.6, halfW * 0.7]], 72), m.black));
  // six split spokes
  const sp = new THREE.Shape();
  sp.moveTo(R * 0.12, -0.03); sp.lineTo(R * 0.58, -0.05); sp.lineTo(R * 0.58, 0.05); sp.lineTo(R * 0.12, 0.03); sp.closePath();
  const spokeGeo = new THREE.ExtrudeGeometry(sp, { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
  for (let i = 0; i < 6; i++) {
    for (const off of [-0.09, 0.09]) {
      const s = new THREE.Mesh(spokeGeo, m.black);
      s.rotation.z = (i / 6) * Math.PI * 2 + off;
      s.position.z = halfW * 0.45;
      g.add(s);
    }
  }
  // beadlock ring with bolts
  const ring = new THREE.Mesh(latheZ([[R * 0.6, halfW * 0.72], [R * 0.71, halfW * 0.74], [R * 0.71, halfW * 0.86], [R * 0.6, halfW * 0.84]], 96), m.lime);
  g.add(ring);
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12), m.chrome, 20);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    q.setFromAxisAngle(V(1, 0, 0), Math.PI / 2);
    mat4.compose(V(Math.cos(a) * R * 0.655, Math.sin(a) * R * 0.655, halfW * 0.88), q, V(1, 1, 1));
    bolts.setMatrixAt(i, mat4);
  }
  g.add(bolts);
  const hub = new THREE.Mesh(latheZ([[0, halfW * 0.62], [0.06, halfW * 0.6], [0.09, halfW * 0.5], [0.1, halfW * 0.35]], 48), materials().red);
  g.add(hub);
  return g;
}

// ---------------------------------------------------------------------------
// Steering wheels. Grip points (hands at 9 and 3) are returned for the IK.
// ---------------------------------------------------------------------------
export function banjoSteering() {
  const m = materials();
  const g = new THREE.Group();
  const R = 0.2;
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.017, 20, 128), m.ivory));
  const hub = new THREE.Mesh(lathe([[0, 0.035], [0.035, 0.03], [0.05, 0.0]], 48), m.chrome);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  // three spokes, each a fan of four fine chrome wires
  const wire = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 8);
  for (const ang of [Math.PI / 2 + Math.PI, Math.PI / 2 + Math.PI / 3 * 2 + Math.PI, Math.PI / 2 - Math.PI / 3 * 2 + Math.PI]) {
    for (let k = 0; k < 4; k++) {
      const a = ang + (k - 1.5) * 0.09;
      const from = V(Math.cos(ang) * 0.045, Math.sin(ang) * 0.045, 0.012);
      const to = V(Math.cos(a) * R, Math.sin(a) * R, 0);
      const w = new THREE.Mesh(wire, m.chrome);
      w.position.copy(from).add(to).multiplyScalar(0.5);
      w.scale.y = from.distanceTo(to);
      w.quaternion.setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize());
      g.add(w);
    }
  }
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 32), m.lime);
  btn.rotation.x = Math.PI / 2;
  btn.position.z = 0.038;
  g.add(btn);
  return { group: g, grips: [V(R, 0, 0.02), V(-R, 0, 0.02)] };
}

export function flatBottomSteering() {
  const m = materials();
  const g = new THREE.Group();
  const R = 0.18;
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    let x = Math.cos(a) * R, y = Math.sin(a) * R;
    if (y < -R * 0.72) y = -R * 0.72; // flat bottom
    pts.push(V(x, y, 0));
  }
  g.add(tube(pts, 0.021, m.black, { closed: true, segs: 160, radial: 20 }));
  const marker = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.05, 0.05, 2, 0.01), m.lime);
  marker.position.set(0, R, 0);
  g.add(marker);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const s = new THREE.Mesh(new RoundedBoxGeometry(R * 0.95, 0.045, 0.025, 3, 0.01), m.carbon);
    s.position.set(Math.cos(a) * R * 0.48, Math.sin(a) * R * 0.48 * 0.8, 0);
    s.rotation.z = a;
    g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 32), m.carbon);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 32), materials().red);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.03;
  g.add(cap);
  return { group: g, grips: [V(R, 0.0, 0.02), V(-R, 0.0, 0.02)] };
}

// ---------------------------------------------------------------------------
// Lamps, nitro bottles, hood ornament
// ---------------------------------------------------------------------------
// Chrome bucket headlamp facing +X.
export function bucketLamp(r = 0.16) {
  const m = materials();
  const g = new THREE.Group();
  const bucket = new THREE.Mesh(lathe([[0.02, -r * 1.3], [r * 0.6, -r * 1.15], [r * 0.95, -r * 0.6], [r * 1.05, -r * 0.05], [r * 1.05, 0]], 72), m.chrome);
  bucket.rotation.z = -Math.PI / 2;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.12, 16, 72), m.chrome);
  bezel.rotation.y = Math.PI / 2;
  const lens = new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), m.lamp);
  lens.rotation.z = -Math.PI / 2;
  lens.scale.set(1, 0.32, 1);
  g.add(bucket, bezel, lens);
  return g;
}

// Nitro bottle lying along local X, with valve, gauge and lime band.
export function nitroBottle(len = 0.62, r = 0.085, body) {
  const m = materials();
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI / 2;
    pts.push([r * Math.sin(a) + 0.0001, -len / 2 + r * (1 - Math.cos(a))]);
  }
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI / 2;
    pts.push([r * Math.cos(a) + 0.0001 + (i === 16 ? 0.02 : 0) * 0, len / 2 - r + r * Math.sin(a) * 0.9]);
  }
  pts.push([0.022, len / 2 - r * 0.05], [0.022, len / 2 + 0.03]);
  const shell = new THREE.Mesh(lathe(pts, 64), body ?? m.navy);
  shell.rotation.z = -Math.PI / 2;
  g.add(shell);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, len * 0.22, 64, 1, true), m.lime);
  band.rotation.z = Math.PI / 2;
  band.position.x = -len * 0.08;
  g.add(band);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.07, 24), m.chrome);
  valve.rotation.z = Math.PI / 2;
  valve.position.x = len / 2 + 0.06;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 10, 32), materials().red);
  wheel.rotation.y = Math.PI / 2;
  wheel.position.x = len / 2 + 0.1;
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.018, 32), m.chrome);
  gauge.position.set(len / 2 + 0.05, 0.04, 0);
  g.add(valve, wheel, gauge);
  return g;
}

export function hoodOrnament() {
  const m = materials();
  const g = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(wingShape(), { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 4, curveSegments: 48 });
  geo.scale(0.16, 0.16, 1);
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(geo, m.chrome);
    w.rotation.y = Math.PI / 2;
    w.scale.x = s;
    w.position.z = 0.012 * s;
    g.add(w);
  }
  return g;
}

// Generic exhaust tip (open chrome pipe along -X) with its boost flame.
export function exhaust(r = 0.06, len = 0.34, flameMat) {
  const m = materials();
  const g = new THREE.Group();
  const pipe = new THREE.Mesh(lathe([[r, 0], [r * 1.12, len * 0.15], [r * 1.12, len], [r * 0.9, len], [r * 0.9, len * 0.2]], 48), m.chrome);
  pipe.material = m.chrome.clone();
  pipe.material.side = THREE.DoubleSide;
  pipe.rotation.z = Math.PI / 2;
  g.add(pipe);
  const fg = new THREE.ConeGeometry(r * 1.4, 1.1, 24, 1, true);
  fg.rotateZ(Math.PI / 2);
  fg.translate(-0.55, 0, 0);
  const flame = new THREE.Mesh(fg, flameMat);
  flame.position.x = -len;
  flame.scale.setScalar(0.001);
  const core = new THREE.Mesh(fg, flameMat.userData.core);
  core.position.x = -len;
  core.scale.setScalar(0.001);
  g.add(flame, core);
  return { group: g, flame, core };
}
