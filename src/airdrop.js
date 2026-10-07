// Opening cinematic: a Night Hawk cargo plane crosses the stadium, the rear
// ramp lowers, the car(s) roll out of the lit cargo bay, parachutes open and
// they swing down onto the start positions. The camera rides behind the plane,
// looking into the bay. Original plane design, all procedural.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLORS, tex, canvasTexture } from './brand.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

const ALT = 70;
const SPEED = 52;
const T_RAMP = [0.6, 1.8];
const T_ROLL = 2.3; // first car starts rolling
const ROLL = 0.75; // seconds to roll down the ramp
const GAP = 0.85; // second car follows
const FREE = 0.45; // free fall before the canopy opens
const T_DESCENT = 4.4;
const LAND_Y = 7;
const HINGE = V(-3.6, -1.55, 0); // ramp hinge, plane space
const RAMP_LEN = 5.8;

// ---------------------------------------------------------------------------
// Plane geometry
// ---------------------------------------------------------------------------
function airfoil(chord, thick, n = 40) {
  const s = new THREE.Shape();
  const yt = (x) => 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  for (let i = 0; i <= n; i++) {
    const x = 1 - Math.cos((i / n) * Math.PI / 2 * 2) * 0.5 - 0.5; // cosine spacing
    const p = [chord * (0.5 - x), chord * yt(x)];
    i ? s.lineTo(...p) : s.moveTo(...p);
  }
  for (let i = n; i >= 0; i--) {
    const x = 1 - Math.cos((i / n) * Math.PI) * 0.5 - 0.5;
    s.lineTo(chord * (0.5 - x), -chord * yt(x) * 0.55);
  }
  return s;
}

function wingGeometry(span, rootChord, tipChord, thick, dihedral = 0, sweep = 0.1) {
  const g = new THREE.ExtrudeGeometry(airfoil(rootChord, thick), { depth: span, steps: 40, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -span / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const k = Math.abs(z) / (span / 2);
    const taper = 1 - (1 - tipChord / rootChord) * k;
    p.setX(i, p.getX(i) * taper - k * rootChord * sweep);
    p.setY(i, p.getY(i) * taper + k * span * 0.5 * dihedral);
  }
  g.computeVertexNormals();
  return g;
}

function buildPlane() {
  const navy = new THREE.MeshPhysicalMaterial({ color: 0x0e1f8a, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xeef1f8, roughness: 0.38, metalness: 0.2, clearcoat: 0.7 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0b4, roughness: 0.45, metalness: 0.6 });
  const lime = new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.4 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1f3dff, roughness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd0182c, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.4, metalness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0f22, roughness: 0.04, metalness: 0.7, clearcoat: 1 });
  const bayMat = new THREE.MeshStandardMaterial({ color: 0x1a1d2b, roughness: 0.8, side: THREE.BackSide });
  const bayLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.lime).multiplyScalar(1.6) });
  const g = new THREE.Group();
  const add = (...o) => g.add(...o);

  // --- forward fuselage: nose to the cargo opening (open at the back)
  const prof = [];
  for (let i = 0; i <= 96; i++) {
    const x = 10.5 - (i / 96) * 14.1; // 10.5 -> -3.6
    const r = x > 6 ? 1.75 * Math.sqrt(Math.max(0, 1 - ((x - 6) / 4.5) ** 2)) ** 0.85 : 1.75;
    prof.push(new THREE.Vector2(Math.max(r, 0.002), x));
  }
  const fwd = new THREE.LatheGeometry(prof, 128);
  fwd.rotateZ(-Math.PI / 2);
  add(new THREE.Mesh(fwd, navy));

  // --- upswept tail shell (upper part only: the bottom is the cargo door)
  const tprof = [];
  for (let i = 0; i <= 48; i++) {
    const x = -3.6 - (i / 48) * 8.6;
    tprof.push(new THREE.Vector2(1.75 - ((-3.6 - x) / 8.6) * 1.2, x));
  }
  const tail = new THREE.LatheGeometry(tprof, 96, Math.PI - 0.45, Math.PI + 0.9);
  tail.rotateZ(-Math.PI / 2);
  const tp = tail.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i);
    tp.setY(i, tp.getY(i) + (-3.6 - x) * 0.21);
  }
  tail.computeVertexNormals();
  const tailMesh = new THREE.Mesh(tail, navy);
  tailMesh.material = navy.clone();
  tailMesh.material.side = THREE.DoubleSide;
  add(tailMesh);

  // --- cargo bay interior, lit with lime strips
  const bay = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.68, 10, 48, 1, true), bayMat);
  bay.rotation.z = Math.PI / 2;
  bay.position.x = 1.4;
  add(bay);
  const floor = new THREE.Mesh(new RoundedBoxGeometry(10, 0.1, 2.8, 2, 0.04), dark);
  floor.position.set(1.4, -1.36, 0);
  add(floor);
  for (const z of [-0.9, 0.9]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.05, 0.06), bayLight);
    strip.position.set(1.4, 1.35, z);
    add(strip);
  }
  const bulk = new THREE.Mesh(new THREE.CircleGeometry(1.68, 48), new THREE.MeshStandardMaterial({ color: 0x2a2e40, roughness: 0.6 }));
  bulk.rotation.y = -Math.PI / 2;
  bulk.position.x = 6.4;
  add(bulk);

  // --- belly, cheatline, Blue/Red race stripes, titles
  const band = (thetaStart, thetaLength, mat, r = 1.758, len = 13.5, x = 3.3) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 128, 1, true, thetaStart, thetaLength), mat);
    m.rotation.z = Math.PI / 2;
    m.position.x = x;
    add(m);
    return m;
  };
  band(Math.PI * 0.62, Math.PI * 0.76, white);
  for (const s of [0, Math.PI]) {
    band(Math.PI * 0.42 + s * 0.0 + (s ? Math.PI * 1.1 : 0), Math.PI * 0.05, lime, 1.762);
  }
  band(Math.PI * 0.36, Math.PI * 0.025, blue, 1.763);
  band(Math.PI * 1.615, Math.PI * 0.025, red, 1.763);
  const title = canvasTexture(1024, 160, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.font = 'italic 900 112px Unbounded, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('HAWK RACING', w / 2, h / 2 + 6);
  });
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.15), new THREE.MeshBasicMaterial({ map: title, transparent: true }));
    t.position.set(2.2, 0.7, s * 1.772);
    t.rotation.y = s > 0 ? 0 : Math.PI;
    add(t);
  }

  // --- cockpit glazing + cabin windows
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.25, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.3), glass);
  cockpit.rotation.z = -1.0;
  cockpit.position.set(7.9, 0.55, 0);
  cockpit.scale.set(1, 0.62, 1.12);
  add(cockpit);
  const winGeo = new RoundedBoxGeometry(0.34, 0.42, 0.06, 3, 0.1);
  const wins = new THREE.InstancedMesh(winGeo, glass, 16);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 16; i++) {
    const s = i < 8 ? 1 : -1;
    q.setFromAxisAngle(V(0, 1, 0), 0);
    m4.compose(V(5.2 - (i % 8) * 0.95, 0.45, s * 1.745), q, V(1, 1, 1));
    wins.setMatrixAt(i, m4);
  }
  add(wins);

  // --- landing-gear sponsons
  for (const s of [1, -1]) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), navy);
    sp.scale.set(3.2, 0.7, 0.55);
    sp.position.set(1.8, -1.2, s * 1.55);
    add(sp);
  }

  // --- high wing with fairing and four turboprops
  const wing = new THREE.Mesh(wingGeometry(32, 4.4, 2.0, 0.15, 0.05, 0.12), white);
  wing.position.set(1.2, 1.6, 0);
  add(wing);
  const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), navy);
  fairing.scale.set(3.6, 0.55, 1.4);
  fairing.position.set(1.0, 1.55, 0);
  add(fairing);
  const props = [];
  const engines = [];
  const nacGeo = new THREE.LatheGeometry([[0.0, 2.8], [0.28, 2.75], [0.5, 2.5], [0.62, 2.0], [0.66, 0.6], [0.6, -1.0], [0.45, -2.0], [0.22, -2.7], [0.0, -2.8]].map(([r, y]) => new THREE.Vector2(r, y)), 64);
  nacGeo.rotateZ(-Math.PI / 2);
  const intake = new THREE.TorusGeometry(0.3, 0.07, 12, 48);
  const blade = new THREE.Shape();
  blade.moveTo(0, -0.1);
  blade.quadraticCurveTo(0.9, -0.24, 1.75, -0.02);
  blade.quadraticCurveTo(1.8, 0.04, 1.7, 0.07);
  blade.quadraticCurveTo(0.9, 0.16, 0, 0.1);
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.03, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 20 });
  const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  for (const z of [-10.2, -5.4, 5.4, 10.2]) {
    const nac = new THREE.Mesh(nacGeo, navy);
    nac.position.set(1.6, 1.15, z);
    add(nac);
    const ring = new THREE.Mesh(intake, grey);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(3.4, 0.82, z);
    add(ring);
    const rotor = new THREE.Group();
    rotor.position.set(4.45, 1.15, z);
    for (let i = 0; i < 6; i++) {
      const holder = new THREE.Group();
      holder.rotation.x = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(bladeGeo, dark);
      b.rotation.set(0, Math.PI / 2, 0.3);
      holder.add(b);
      rotor.add(holder);
    }
    const spinner = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.7], [0.12, 0.6], [0.26, 0.35], [0.33, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 48), lime);
    spinner.rotation.z = -Math.PI / 2;
    rotor.add(spinner);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.8, 64), discMat);
    disc.rotation.y = Math.PI / 2;
    rotor.add(disc);
    add(rotor);
    props.push(rotor);
    engines.push(V(-1.2, 1.15, z));
  }

  // --- T-tail: fin with dorsal fillet, logo, stabiliser
  const finShape = new THREE.Shape();
  finShape.moveTo(0.6, 0);
  finShape.quadraticCurveTo(-1.5, 0.15, -2.6, 0.9);
  finShape.lineTo(-4.4, 4.6);
  finShape.lineTo(-2.9, 4.6);
  finShape.lineTo(-1.2, 0.6);
  finShape.quadraticCurveTo(-0.4, 0.05, 0.6, 0);
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.26, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 6, curveSegments: 24 }), navy);
  fin.position.set(-7.2, 2.2, -0.13);
  add(fin);
  for (const s of [1, -1]) {
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4 * (952 / 1400)), new THREE.MeshBasicMaterial({ map: tex('logo'), transparent: true }));
    logo.position.set(-9.9, 4.6, s * 0.3);
    logo.rotation.y = s > 0 ? 0 : Math.PI;
    add(logo);
  }
  const stab = new THREE.Mesh(wingGeometry(11, 2.3, 1.3, 0.12, 0.02, 0.2), white);
  stab.position.set(-10.9, 6.85, 0);
  add(stab);

  // --- rear cargo ramp, hinged at the bay floor
  const ramp = new THREE.Group();
  const plate = new THREE.Mesh(new RoundedBoxGeometry(RAMP_LEN, 0.14, 2.9, 3, 0.05), navy);
  plate.position.x = -RAMP_LEN / 2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(RAMP_LEN - 0.2, 0.02, 2.6), dark);
  deck.position.set(-RAMP_LEN / 2, 0.08, 0);
  const chev = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.6), new THREE.MeshBasicMaterial({ color: COLORS.lime }));
  chev.rotation.x = -Math.PI / 2;
  chev.position.set(-RAMP_LEN + 1, 0.1, 0);
  ramp.add(plate, deck, chev);
  ramp.position.copy(HINGE);
  ramp.rotation.z = -0.33; // closed: tilted up against the tail
  add(ramp);

  // --- lights + antennas
  const lamp = (c, x, y, z, r = 0.15) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z);
    add(m);
    return m;
  };
  lamp(new THREE.Color(4, 0.2, 0.2), 0.0, 2.3, -16.1);
  lamp(new THREE.Color(0.2, 4, 0.4), 0.0, 2.3, 16.1);
  const strobe = lamp(new THREE.Color(6, 6, 6), -11.7, 7.0, 0, 0.2);
  const beacon = lamp(new THREE.Color(5, 0.4, 0.3), 2.0, 1.85, 0, 0.14);
  for (const x of [4.5, -1.5]) {
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.04), grey);
    ant.position.set(x, 1.9, 0);
    ant.rotation.z = 0.4;
    add(ant);
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, props, ramp, strobe, beacon, engines };
}

// ---------------------------------------------------------------------------
// Parachute in the player's colours with the logo on top.
// ---------------------------------------------------------------------------
function buildChute(main) {
  const geo = new THREE.SphereGeometry(4, 128, 28, 0, Math.PI * 2, 0, Math.PI * 0.4);
  const pal = [new THREE.Color(main), new THREE.Color(0xf4f6ff), new THREE.Color(COLORS.lime)];
  const colors = [];
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i)) + Math.PI;
    const k = (a / (Math.PI * 2)) * 12;
    const gore = Math.floor(k) % 2 === 0 ? 0 : Math.floor(k) % 4 === 1 ? 1 : 2;
    colors.push(pal[gore].r, pal[gore].g, pal[gore].b);
    const bil = 1 + 0.05 * Math.abs(Math.sin(k * Math.PI));
    p.setX(i, p.getX(i) * bil);
    p.setZ(i, p.getZ(i) * bil);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 }));
  canopy.scale.y = 0.62;
  canopy.castShadow = true;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4 * (952 / 1400)), new THREE.MeshBasicMaterial({ map: tex('logo'), transparent: true, depthWrite: false }));
  logo.rotation.x = -Math.PI / 2;
  logo.position.y = 4 * 0.62 + 0.03;
  const group = new THREE.Group();
  group.add(canopy, logo);
  const linePos = new Float32Array(12 * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8ecf8, transparent: true, opacity: 0.85 }));
  lines.frustumCulled = false;
  group.visible = false;
  lines.visible = false;
  return { group, lines, linePos };
}

// ---------------------------------------------------------------------------
export class AirDrop {
  constructor(scene) {
    this.plane = buildPlane();
    this.plane.group.visible = false;
    scene.add(this.plane.group);
    this.chutes = [buildChute(0x1f3dff), buildChute(0xd0182c)];
    for (const c of this.chutes) scene.add(c.group, c.lines);
    this.active = false;
    this.t = 0;
    this.camPos = V(0, 0, 0);
    this.camLook = V(0, 0, 0);
    this._e = new THREE.Euler();
  }

  // cargo: [{ car, target: Vector3 (ground point), height, chute: 0|1 }]
  start(cargo, cb = {}) {
    this.active = true;
    this.t = 0;
    this.cb = cb;
    this.cargo = cargo.map((c, i) => ({
      ...c,
      i,
      t0: T_ROLL + i * GAP,
      pos: V(0, 0, 0),
      quat: new THREE.Quaternion(),
      phase: 'bay',
      released: false,
      chuteObj: this.chutes[c.chute ?? i],
    }));
    for (const c of this.chutes) { c.group.visible = false; c.lines.visible = false; c.flyAway = null; c.group.scale.setScalar(1); c.group.rotation.set(0, 0, 0); }
    const mid = cargo.reduce((a, c) => a.add(c.target), V(0, 0, 0)).multiplyScalar(1 / cargo.length);
    this.mid = mid;
    this.pathZ = mid.z;
    // time when the plane is overhead such that cargo lands near the targets
    this.tOver = T_ROLL + 1.8;
    this.plane.group.visible = true;
    this.plane.ramp.rotation.z = -0.33;
    this.planeAt(0);
  }

  planeAt(t) {
    const g = this.plane.group;
    g.position.set(this.mid.x - 40 + (t - this.tOver) * SPEED, ALT + Math.sin(t * 0.8) * 0.35, this.pathZ);
    g.rotation.set(Math.sin(t * 0.6) * 0.025, 0, Math.sin(t * 0.9) * 0.012);
    g.updateMatrixWorld();
    return g.position;
  }

  skip() {
    if (!this.active) return;
    for (const c of this.cargo) if (!c.released) c.skip = true;
  }

  get allReleased() { return this.cargo?.every((c) => c.released); }

  // Point in plane space on the bay floor / ramp for roll progress k (0..1).
  #rollPoint(c, k) {
    const slotX = -1.8 + c.i * 4.3;
    const lift = c.height - 1.31; // car body centre above the floor
    const rampAng = this.plane.ramp.rotation.z;
    const toHinge = slotX - HINGE.x;
    const total = toHinge + RAMP_LEN + 1.2;
    const d = k * total;
    if (d < toHinge) return V(slotX - d, -1.31 + lift, 0);
    const along = d - toHinge;
    return V(HINGE.x - Math.cos(rampAng) * along, HINGE.y + 0.07 - Math.sin(rampAng) * along + lift, 0);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const P = this.planeAt(t);
    const pl = this.plane;
    for (const r of pl.props) r.rotation.x += dt * 42;
    pl.strobe.visible = (t * 1.5) % 1 < 0.1;
    pl.beacon.visible = (t * 1.1) % 1 < 0.5;
    // ramp: closed (tilted up) -> open (a little below level)
    pl.ramp.rotation.z = -0.33 + 0.5 * ease(clamp01((t - T_RAMP[0]) / (T_RAMP[1] - T_RAMP[0])));

    for (const c of this.cargo) this.#updateCargo(c, t, dt, P);

    // camera: behind and just above the plane, looking into the bay; once the
    // cars are out it follows them down.
    const out = this.cargo.filter((c) => c.phase !== 'bay');
    // tucked in behind the tail, a touch above: straight into the open bay
    const camBehind = V(-24, 1.6 + Math.sin(t * 1.3) * 0.25, 2.2 + Math.sin(t * 0.7) * 0.4).add(P);
    const lookBay = V(-2, -0.9, 0).add(P);
    if (!out.length || t < this.cargo[0].t0 + ROLL + 0.35) {
      this.camPos.copy(camBehind);
      this.camLook.copy(lookBay);
    } else {
      const mid = out.reduce((a, c) => a.add(c.pos), V(0, 0, 0)).multiplyScalar(1 / out.length);
      const spread = out.length > 1 ? out[0].pos.distanceTo(out[1].pos) : 0;
      const h = Math.max(0, mid.y);
      const k = clamp01(1 - h / ALT);
      const back = 18 + spread * 0.6 + k * 4;
      this.camPos.set(mid.x - back, mid.y + 5 + k * 9, mid.z + 6 + k * 8);
      this.camLook.copy(mid).add(V(4 * (1 - k), -1 - k * 1.5, 0));
    }

    if (t > this.tOver + 5.5) pl.group.visible = false;
    if (this.allReleased && this.chutes.every((c) => !c.group.visible)) this.active = false;
  }

  #updateCargo(c, t, dt, P) {
    const ch = c.chuteObj;
    let pitch = 0, roll = 0, yaw = c.yaw ?? 0;
    const tChute = c.t0 + ROLL + FREE;
    const tEnd = tChute + T_DESCENT;
    if (c.skip && !c.released) { c.skip = false; c.forceEnd = true; }

    if (!c.released && (c.forceEnd || t >= tEnd)) {
      c.released = true;
      c.phase = 'released';
      c.pos.set(c.target.x, LAND_Y, c.target.z);
      c.quat.setFromEuler(this._e.set(0, yaw, 0, 'YXZ'));
      // the car is placed here too, so a skipped drop lands on its grid slot
      this.cb.onRelease?.(c.i, V(0, -11, 0), c.pos, c.quat);
      ch.flyAway = { v: V(5, 7, -2), spin: 0.6 };
    } else if (!c.released) {
      if (t < c.t0 + ROLL) {
        // in the bay, then rolling backwards down the ramp
        const k = ease(clamp01((t - c.t0) / ROLL));
        const local = this.#rollPoint(c, k);
        c.pos.copy(local).applyMatrix4(this.plane.group.matrixWorld);
        pitch = local.x < HINGE.x ? this.plane.ramp.rotation.z : 0;
        c.phase = k > 0 ? 'rolling' : 'bay';
        if (k > 0 && !c.rollCalled) { c.rollCalled = true; this.cb.onRoll?.(c.i); }
      } else if (t < tChute) {
        c.phase = 'free';
        c.freeFrom ??= c.pos.clone();
        const k = t - (c.t0 + ROLL);
        c.pos.copy(c.freeFrom).add(V(SPEED * 0.5 * k, -9 * k * k, 0));
        pitch = 0.2 + k * 1.1; // rear-first exit: the nose tips up
        roll = Math.sin(k * 7) * 0.15;
      } else {
        c.phase = 'chute';
        if (!ch.group.visible && !ch.flyAway) {
          ch.group.visible = true;
          ch.lines.visible = true;
          c.chuteFrom = c.pos.clone();
          this.cb.onChute?.(c.i);
        }
        const k = (t - tChute) / T_DESCENT;
        const p0 = c.chuteFrom, p3 = V(c.target.x, LAND_Y, c.target.z);
        const p1 = p0.clone().add(V(20, -6, 0)), p2 = p3.clone().add(V(0, 20, 0));
        const u = ease(k) * 0.85 + k * 0.15, w = 1 - u;
        c.pos.copy(p0).multiplyScalar(w * w * w)
          .addScaledVector(p1, 3 * w * w * u).addScaledVector(p2, 3 * w * u * u).addScaledVector(p3, u * u * u);
        const settle = clamp01((t - tChute) / 0.9);
        pitch = 0.7 * (1 - settle) + Math.sin(t * 2.4 + c.i) * 0.08 * (1 - k);
        roll = Math.sin(t * 2.0 + 0.6 + c.i * 1.7) * 0.22 * (1 - k * 0.8);
        yaw += Math.sin(t * 0.7 + c.i) * 0.25 * (1 - k);
      }
    }
    this._e.set(roll, yaw, pitch, 'YXZ');
    c.quat.setFromEuler(this._e);

    // parachute
    if (!ch.group.visible) return;
    if (ch.flyAway) {
      ch.group.position.addScaledVector(ch.flyAway.v, dt);
      ch.flyAway.v.y += dt * 2;
      ch.group.rotation.z += dt * ch.flyAway.spin;
      ch.group.scale.multiplyScalar(1 - dt * 0.35);
      if (ch.group.position.y > ALT) { ch.group.visible = false; ch.lines.visible = false; }
    } else {
      const inflate = clamp01((t - (c.t0 + ROLL + FREE)) / 0.7);
      const s = 0.15 + 0.85 * (1 - Math.pow(1 - inflate, 3)) * (1 + 0.08 * Math.sin(inflate * 9) * (1 - inflate));
      ch.group.scale.set(s, 0.6 + 0.4 * inflate, s);
      ch.group.position.copy(c.pos).add(V(Math.sin(roll) * -6, 8.5, Math.sin(roll) * 2));
      ch.group.rotation.set(-roll * 0.5, yaw, pitch * 0.2);
    }
    const rimR = 4 * Math.sin(Math.PI * 0.4);
    const rimY = 4 * Math.cos(Math.PI * 0.4) * 0.62;
    ch.group.updateMatrixWorld();
    const anchor = V(0, 0, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      anchor.set(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR).applyMatrix4(ch.group.matrixWorld);
      ch.linePos.set([anchor.x, anchor.y, anchor.z], i * 6);
      const cx = (i % 4 < 2 ? 1 : -1) * 0.9, cz = (i % 2 ? 1 : -1) * 0.6;
      const cpt = V(cx, 1.0, cz).applyQuaternion(c.quat).add(c.pos);
      ch.linePos.set([cpt.x, cpt.y, cpt.z], i * 6 + 3);
    }
    ch.lines.geometry.attributes.position.needsUpdate = true;
  }

  // world positions of the props (for prop-wash puffs)
  engineWorld(out) {
    out.length = 0;
    for (const e of this.plane.engines) out.push(e.clone().applyMatrix4(this.plane.group.matrixWorld));
    return out;
  }
}
