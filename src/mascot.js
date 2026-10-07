// The Night Hawk can mascots that drive the cars: the Classic can (fedora +
// 8-bit shades) and the Ultra can (knit beanie + star glasses). Accessories are
// built in can units (radius 0.5, height 2.55) and face +X (the car's forward).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLORS, CAN, FLAVORS, tex, canGeometry, canMaterials, faceFrontYaw } from './brand.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y_AXIS = V(0, 1, 0);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const lathe = (pts, segs = 128) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);

const EYE_Y = 1.8; // glasses sit across the top of the logo, like the key art

// Curve that wraps accessories gently around the front of the can.
function frontCurve(z, lift = 0.06, k = 1.25) {
  return { x: CAN.r + lift - (z * z) / (2 * k), yaw: Math.atan(z / k) };
}

// ---------- Hats ----------
function fedora() {
  const felt = new THREE.MeshStandardMaterial({ color: 0x2a2b31, roughness: 0.95, side: THREE.DoubleSide });
  const ribbon = new THREE.MeshStandardMaterial({ color: 0x0b0b0f, roughness: 0.5 });
  const g = new THREE.Group();

  // brim: curled up at the sides, dipping slightly at the front
  const brim = lathe([[0.5, 0.06], [0.62, 0.05], [0.8, 0.045], [0.94, 0.06], [1.02, 0.1], [1.03, 0.14], [0.98, 0.12], [0.8, 0.09], [0.6, 0.1], [0.5, 0.11]], 160);
  const bp = brim.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i);
    const r = Math.hypot(x, z);
    const curl = Math.max(0, r - 0.55) ** 2 * (z * z) / (r * r + 1e-6) * 0.9;
    const dip = x > 0 ? -(Math.max(0, r - 0.6) ** 2) * (x * x) / (r * r + 1e-6) * 0.45 : 0;
    bp.setY(i, bp.getY(i) + curl + dip);
  }
  brim.computeVertexNormals();
  g.add(new THREE.Mesh(brim, felt));

  // crown: teardrop with a centre crease and front pinches
  const crown = lathe([[0.52, 0.08], [0.535, 0.3], [0.53, 0.52], [0.5, 0.7], [0.44, 0.84], [0.32, 0.92], [0.16, 0.9], [0.0, 0.84]], 160);
  const cp = crown.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    x *= 1.08; // a touch longer front-to-back
    const top = Math.max(0, (y - 0.5) / 0.42);
    y -= 0.16 * top * Math.exp(-(z * z) / 0.02); // centre crease
    if (x > 0) z *= 1 - 0.22 * top * Math.min(1, x / 0.4); // front pinch
    cp.setXYZ(i, x, y, z);
  }
  crown.computeVertexNormals();
  g.add(new THREE.Mesh(crown, felt));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.545, 0.55, 0.15, 160, 1, true), ribbon);
  band.scale.x = 1.08;
  band.position.y = 0.2;
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), ribbon);
  bow.scale.set(1.6, 0.9, 0.5);
  bow.position.set(-0.1, 0.2, -0.56);
  g.add(band, bow);
  g.rotation.set(0.1, 0, -0.14);
  g.position.y = CAN.h - 0.06;
  return g;
}

function beanie() {
  const knit = new THREE.MeshStandardMaterial({ color: 0xc41f2a, roughness: 1 });
  const g = new THREE.Group();
  const ribbed = (geo, amp, freq, rows = 0, rowAmp = 0) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + amp * Math.abs(Math.cos(a * freq)) + (rows ? rowAmp * Math.sin(y * rows) : 0);
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  // knit dome with a slight slouch
  const pts = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * (Math.PI / 2);
    pts.push([0.585 * Math.cos(a) + 0.0001, 0.4 + 0.72 * Math.sin(a)]);
  }
  const dome = ribbed(lathe(pts, 192), 0.012, 48, 70, 0.006);
  const dp = dome.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const y = dp.getY(i);
    dp.setX(i, dp.getX(i) - Math.max(0, y - 0.7) * 0.18); // slouch backwards
  }
  dome.computeVertexNormals();
  g.add(new THREE.Mesh(dome, knit));
  // folded cuff
  const cuff = ribbed(lathe([[0.57, -0.02], [0.62, 0.0], [0.635, 0.12], [0.635, 0.3], [0.62, 0.42], [0.585, 0.44]], 192), 0.022, 64);
  g.add(new THREE.Mesh(cuff, knit));
  // small woven Night Hawk patch on the cuff
  const patch = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.15, 0.03, 3, 0.012), new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.8 }));
  patch.position.set(0.635, 0.21, 0);
  patch.rotation.y = Math.PI / 2;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.12), new THREE.MeshBasicMaterial({ map: tex('logo'), transparent: true, color: 0x0b0c12 }));
  logo.position.set(0.652, 0.21, 0);
  logo.rotation.y = Math.PI / 2;
  g.add(patch, logo);
  g.position.y = CAN.h - 0.5;
  g.rotation.z = 0.05;
  return g;
}

// ---------- Glasses ----------
// 8-bit shades: oversized, wider than the can, wrapped gently around it.
function pixelShades() {
  const rows = [
    '####################',
    '.########..########.',
    '.#..#####..#..#####.',
    '..######....######..',
    '...####......####...',
  ];
  const shine = new Set(['2,2', '2,3', '2,12', '2,13']);
  const px = 0.085;
  const black = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.35, metalness: 0.3 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const geo = new RoundedBoxGeometry(px * 0.98, px * 0.98, 0.07, 2, 0.008);
  const dark = [], light = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '#') dark.push([r, c]);
    if (shine.has(`${r},${c}`)) light.push([r, c]);
  }));
  const g = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const build = (list, mat) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([r, c], i) => {
      const z = (c - (rows[0].length - 1) / 2) * px;
      const { x, yaw } = frontCurve(z, 0.07);
      q.setFromAxisAngle(Y_AXIS, Math.PI / 2 - yaw);
      m.compose(V(x, -r * px, z), q, V(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    return mesh;
  };
  g.add(build(dark, black), build(light, white));
  // temple arms back along the can
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.05, 0.04, 2, 0.015), black);
    arm.position.set(0.05, 0, s * 0.56);
    arm.rotation.y = s * 0.25;
    g.add(arm);
  }
  g.position.y = EYE_Y + 0.08;
  return g;
}

// Pink star glasses, big and playful.
function starGlasses() {
  const star = (ro, ri) => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 ? ri : ro;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return s;
  };
  const frame = new THREE.MeshPhysicalMaterial({ color: 0xff2f9a, roughness: 0.22, clearcoat: 1, metalness: 0.05 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xff7cc4, roughness: 0.05, transparent: true, opacity: 0.6, clearcoat: 1, side: THREE.DoubleSide });
  const outer = star(0.38, 0.19);
  outer.holes.push(star(0.29, 0.14));
  const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 4 });
  const lensGeo = new THREE.ShapeGeometry(star(0.29, 0.14));
  const g = new THREE.Group();
  for (const s of [1, -1]) {
    const z = s * 0.36;
    const { x, yaw } = frontCurve(z, 0.12);
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    holder.rotation.y = Math.PI / 2 - yaw;
    holder.rotation.z = s * 0.08;
    const f = new THREE.Mesh(frameGeo, frame);
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.z = 0.03;
    holder.add(f, lens);
    g.add(holder);
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.05, 0.04, 2, 0.015), frame);
    arm.position.set(0.08, 0.06, s * 0.58);
    arm.rotation.y = s * 0.2;
    g.add(arm);
  }
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 10, 32, Math.PI), frame);
  bridge.rotation.y = Math.PI / 2;
  bridge.position.set(CAN.r + 0.16, 0.06, 0);
  g.add(bridge);
  g.position.y = EYE_Y;
  return g;
}

// Night Hawk racing glove: charcoal fist, lime knuckle guard, wrist strap.
function glove() {
  const leather = new THREE.MeshStandardMaterial({ color: 0x23252e, roughness: 0.6 });
  const guard = new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.4 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.12, 0.13, 5, 0.05), leather));
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.125, 4, 0.02), guard);
  pad.position.set(0.06, 0.035, 0);
  g.add(pad);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.05, 8, 16), leather);
  thumb.position.set(0.04, -0.05, 0.04);
  thumb.rotation.z = 1.2;
  g.add(thumb);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.04, 32), guard);
  strap.rotation.z = Math.PI / 2;
  strap.position.x = -0.085;
  g.add(strap);
  return g;
}

// ---------------------------------------------------------------------------
export class Mascot {
  // parent: the car's sprung chassis group. steering: { group, grips }.
  constructor(flavor, parent, seat, steering) {
    this.flavor = flavor;
    this.DS = 0.36; // can units -> car units
    this.seat = seat;
    this.steering = steering;
    this.spr = { squash: [0, 0], hat: [0, 0] };

    this.body = new THREE.Group();
    this.body.position.set(seat.x, seat.y, 0);
    this.body.scale.setScalar(this.DS);
    const can = new THREE.Mesh(canGeometry(), canMaterials(flavor, { wet: false }));
    can.rotation.y = faceFrontYaw(Math.PI / 2); // label front faces +X
    this.hat = flavor === 'classic' ? fedora() : beanie();
    this.glasses = flavor === 'classic' ? pixelShades() : starGlasses();
    this.hat.userData.base = { x: this.hat.rotation.x, z: this.hat.rotation.z, y: this.hat.position.y };
    this.body.add(can, this.hat, this.glasses);
    parent.add(this.body);

    // arms: two-bone IK each frame from the shoulders to the steering grips
    const armMat = new THREE.MeshStandardMaterial({ color: FLAVORS[flavor].paint, roughness: 0.45 });
    const bone = new THREE.CylinderGeometry(0.045, 0.045, 1, 24, 1, true);
    const joint = new THREE.SphereGeometry(0.045, 24, 16);
    this.arms = [1, -1].map((side) => {
      const a = {
        side,
        upper: new THREE.Mesh(bone, armMat),
        lower: new THREE.Mesh(bone, armMat),
        elbow: new THREE.Mesh(joint, armMat),
        shoulder: new THREE.Mesh(joint, armMat),
        hand: glove(),
      };
      parent.add(a.upper, a.lower, a.elbow, a.shoulder, a.hand);
      return a;
    });
    this._sh = V(0, 0, 0); this._hd = V(0, 0, 0); this._el = V(0, 0, 0); this._v = V(0, 0, 0);
    parent.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  react(kind) {
    const s = this.spr;
    if (kind === 'hop') { s.squash[1] += 3.5; s.hat[1] += 4; }
    if (kind === 'cheer') { s.squash[1] += 6; s.hat[1] += 9; }
    if (kind === 'land') { s.squash[1] -= 5; s.hat[1] += 5; }
  }

  // ctx: { steer, latA, lonA, boost, planar, idle, time }
  update(dt, c) {
    if (dt <= 0) return;
    const s = this.spr;
    const spring = (st, target, k, d) => {
      st[1] += ((target - st[0]) * k - st[1] * d) * dt;
      st[0] += st[1] * dt;
      return st[0];
    };
    const b = this.body;
    const sq = THREE.MathUtils.clamp(spring(s.squash, 0, 220, 9) * 0.06, -0.22, 0.25);
    b.scale.set(this.DS * (1 - sq * 0.5), this.DS * (1 + sq), this.DS * (1 - sq * 0.5));
    const dance = c.idle ? 1 : 0;
    const beat = c.time * Math.PI * (128 / 60);
    b.rotation.x = damp(b.rotation.x, -c.steer * 0.35 - c.latA * 0.006 + dance * Math.sin(beat) * 0.12, 10, dt);
    b.rotation.z = damp(b.rotation.z, c.boost * 0.18 + c.lonA * 0.004 + dance * 0.05, 8, dt);
    b.rotation.y = damp(b.rotation.y, c.steer * 0.6 + dance * Math.sin(c.time * 0.7) * 0.5, 6, dt);
    b.position.y = this.seat.y + Math.abs(Math.sin(c.time * 9)) * Math.min(c.planar / 40, 1) * 0.025 + dance * Math.abs(Math.sin(beat)) * 0.06;

    // hat lags behind the head on a spring
    const w = spring(s.hat, -c.latA * 0.01, 90, 6);
    const base = this.hat.userData.base;
    this.hat.rotation.x = base.x + THREE.MathUtils.clamp(w * 0.08, -0.4, 0.4);
    this.hat.position.y = base.y + Math.max(0, w * 0.02);

    // steering wheel follows input; hands stay on it
    const sw = this.steering.group;
    sw.rotation.z = c.idle ? Math.sin(c.time * 2) * 0.4 : c.steer * 2.4;
    sw.updateMatrix();
    b.updateMatrix();
    for (const a of this.arms) {
      const shoulder = this._sh.set(0, 1.25, a.side * (CAN.r + 0.03)).applyMatrix4(b.matrix);
      const hand = this._hd.copy(this.steering.grips[a.side > 0 ? 0 : 1]).applyMatrix4(sw.matrix);
      if (c.idle && a.side > 0) hand.set(this.seat.x + 0.1, this.seat.y + 0.95 + Math.abs(Math.sin(c.time * 4)) * 0.16, 0.48);
      const L = 0.3;
      const dist = Math.min(shoulder.distanceTo(hand), L * 1.98);
      const mid = this._el.copy(shoulder).lerp(hand, 0.5);
      const bend = Math.sqrt(Math.max(0, L * L - (dist / 2) ** 2));
      mid.y -= bend * 0.6;
      mid.z += a.side * bend * 0.8;
      this.#bone(a.upper, shoulder, mid);
      this.#bone(a.lower, mid, hand);
      a.elbow.position.copy(mid);
      a.shoulder.position.copy(shoulder);
      a.hand.position.copy(hand);
      a.hand.quaternion.copy(sw.quaternion);
      a.hand.rotateY(Math.PI / 2);
    }
  }

  #bone(mesh, from, to) {
    const dir = this._v.copy(to).sub(from);
    const len = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
  }
}
