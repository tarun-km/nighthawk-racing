// Hawk Boxes and power-ups (Grand Prix and Duel). Rows of boxes sit across
// the road; driving through one rolls a power-up, and racers further back
// roll the stronger ones.
//   turbo  - instant nitro burst
//   hawk   - homing hawk that spins out the next car ahead
//   mines  - three cans dropped behind; whoever hits one spins out
//   shield - a bubble that soaks up one hit
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLORS, CAN, tex, canGeometry, canMaterials, wingShape, radialTexture, canvasTexture } from './brand.js';
import { trackPoint, trackParam, trackDistance, TRACK_W } from './track.js';

export const POWERS = ['turbo', 'hawk', 'mines', 'shield'];
export const POWER_INFO = {
  turbo: { name: 'Turbo can', color: '#8dc63f' },
  hawk: { name: 'Hawk strike', color: '#f4f6ff' },
  mines: { name: 'Can mines', color: '#ff3348' },
  shield: { name: 'Wing shield', color: '#3d6bff' },
};
const ROWS = [128, 292, 468, 676];
const LANES = [3.4, 7.5, 11.7, 15.8];
const ROLL_TIME = 0.9;
const RESPAWN = 2.5;
const MINE_POOL = 12;
const HAWK_POOL = 6;
const HAWK_SPEED = 72;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// rank 0 = leading, 1 = last
function rollFor(rank) {
  const w = { turbo: 30 + 15 * rank, hawk: 6 + 42 * rank, mines: 34 - 24 * rank, shield: 30 - 15 * rank };
  let t = Math.random() * (w.turbo + w.hawk + w.mines + w.shield);
  for (const k of POWERS) if ((t -= w[k]) <= 0) return k;
  return 'turbo';
}

// Additive fresnel bubble for the shield.
function shieldMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(COLORS.electric).multiplyScalar(1.6) }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha, uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float hex = 0.5 + 0.5 * sin(vP.y * 14.0 - uTime * 6.0);
        gl_FragColor = vec4(uColor * (f * 1.5 + 0.04 + hex * f * 0.4) * uAlpha, 1.0);
      }`,
  });
}

export class Items {
  // cars: every car that can race, so the shield bubbles exist up front.
  constructor(scene, particles, cars = []) {
    this.scene = scene;
    this.particles = particles;
    this.enabled = false;
    this.boxes = [];
    this.mines = [];
    this.hawks = [];
    this.shields = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = V(1, 1, 1);
    this._v = V(0, 0, 0);

    // ---- boxes: navy cubes with the Night Hawk mark and a lime frame
    const face = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#0b1452';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#8dc63f';
      g.lineWidth = 22;
      g.strokeRect(11, 11, w - 22, h - 22);
      const logo = tex('logo').image;
      const lw = w * 0.66, lh = lw * (logo.height / logo.width);
      g.drawImage(logo, (w - lw) / 2, (h - lh) / 2, lw, lh);
    });
    const boxMat = new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2 });
    const haloMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), color: COLORS.lime, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    const n = ROWS.length * LANES.length;
    this.boxMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1.35, 1.35, 1.35, 3, 0.2), boxMat, n);
    this.haloMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4), haloMat, n);
    for (const m of [this.boxMesh, this.haloMesh]) { m.frustumCulled = false; m.visible = false; scene.add(m); }
    this.boxMesh.castShadow = true;
    ROWS.forEach((s, row) => LANES.forEach((lane) => {
      const p = trackPoint(s, lane);
      this.boxes.push({ x: p.x, z: p.z, active: true, t: 0, grow: 1, phase: row * 1.3 + lane });
    }));

    // ---- mines: small Ultra cans with a blinking red ring
    const mineGeo = canGeometry('low');
    const mineMat = canMaterials('ultra');
    const ringMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,60,80,1)', 'rgba(255,60,80,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < MINE_POOL; i++) {
      const g = new THREE.Group();
      const can = new THREE.Mesh(mineGeo, mineMat);
      can.scale.setScalar(0.6);
      can.castShadow = true;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      g.add(can, ring);
      g.visible = false;
      scene.add(g);
      this.mines.push({ g, can, ring, active: false, x: 0, z: 0, life: 0, arm: 0, owner: null });
    }

    // ---- hawks: chrome wings + body, flapping, with a lime trail
    const wingGeo = new THREE.ExtrudeGeometry(wingShape(), { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 24 });
    wingGeo.rotateX(-Math.PI / 2);
    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.15, clearcoat: 1, emissive: COLORS.lime, emissiveIntensity: 0.25 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x14162a, roughness: 0.5 });
    for (let i = 0; i < HAWK_POOL; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 6, 16), bodyMat);
      body.rotation.z = Math.PI / 2;
      const wl = new THREE.Group(), wr = new THREE.Group();
      const a = new THREE.Mesh(wingGeo, chrome);
      a.rotation.y = -Math.PI / 2;
      const b = a.clone();
      b.scale.z = -1;
      wl.add(a); wr.add(b);
      g.add(body, wl, wr);
      g.scale.setScalar(1.8);
      g.visible = false;
      scene.add(g);
      this.hawks.push({ g, wl, wr, active: false, pos: V(0, 0, 0), vel: V(0, 0, 0), target: null, owner: null, life: 0 });
    }
    const shieldGeo = new THREE.SphereGeometry(1, 48, 32);
    for (const c of cars) {
      const sh = new THREE.Mesh(shieldGeo, shieldMaterial());
      sh.scale.set(2.5, 1.5, 1.9);
      sh.visible = false;
      sh.frustumCulled = false;
      scene.add(sh);
      this.shields.set(c, sh);
    }
  }

  setEnabled(on) {
    this.enabled = on;
    this.boxMesh.visible = this.haloMesh.visible = on;
    this.reset();
  }

  reset() {
    for (const b of this.boxes) { b.active = true; b.grow = 1; }
    for (const m of this.mines) { m.active = false; m.g.visible = false; }
    for (const h of this.hawks) { h.active = false; h.g.visible = false; }
    for (const s of this.shields.values()) s.visible = false;
  }

  // Fire the racer's held item. Returns an event for the HUD / audio.
  use(r, racers) {
    const item = r.item;
    if (!item || r.rolling > 0) return null;
    r.item = null;
    const c = r.car;
    if (item === 'turbo') return { type: 'turbo', racer: r };
    if (item === 'shield') { r.shield = 8; return { type: 'shield', racer: r }; }
    if (item === 'mines') {
      const s0 = trackParam(c.position.x, c.position.z);
      const lane0 = trackDistance(c.position.x, c.position.z);
      const back = Math.cos(Math.atan2(-c.forward.z, c.forward.x) - trackPoint(s0, lane0).yaw) >= 0 ? -1 : 1;
      // a staggered spread wide enough to dodge between
      [-3.2, 0, 3.2].forEach((dl, i) => {
        const p = trackPoint(s0 + back * (3.6 + (i === 1 ? 2.4 : 0)), clamp(lane0 + dl, 1.4, TRACK_W - 1.4));
        const m = this.mines.find((x) => !x.active) ?? this.mines.reduce((a, x) => (x.life < a.life ? x : a));
        Object.assign(m, { active: true, x: p.x, z: p.z, life: 28, arm: 0.7, owner: r });
        m.g.position.set(p.x, 0, p.z);
        m.g.visible = true;
      });
      return { type: 'mines', racer: r };
    }
    if (item === 'hawk') {
      // the next car ahead on the lap
      let target = null, best = Infinity;
      for (const o of racers) {
        if (o === r || o.finished) continue;
        const gap = o.tracker.progress - r.tracker.progress;
        if (gap > 0 && gap < best) { best = gap; target = o; }
      }
      const h = this.hawks.find((x) => !x.active) ?? this.hawks[0];
      h.active = true;
      h.target = target;
      h.owner = r;
      h.life = target ? 6 : 2.2;
      h.pos.copy(c.position).addScaledVector(c.forward, 2.6).setY(c.position.y + 1.3);
      h.vel.copy(c.forward).setY(0).normalize().multiplyScalar(HAWK_SPEED);
      h.g.visible = true;
      return { type: 'hawk', racer: r, target };
    }
    return null;
  }

  // Shielded racers lose the shield instead of spinning.
  #hit(r, by, events, pos) {
    if (r.car.spin > 0 || r.immune > 0) return; // one hit at a time
    if (r.shield > 0) {
      r.immune = 0.8;
      r.shield = 0;
      events.push({ type: 'block', racer: r, by, pos });
      return;
    }
    r.car.spinOut();
    r.immune = 2.5;
    events.push({ type: 'hit', racer: r, by, pos });
  }

  update(dt, time, racers, ranks) {
    const events = [];
    if (!this.enabled) return events;
    const m4 = this._m, q = this._q, sc = this._s;

    // ---- boxes
    this.boxes.forEach((b, i) => {
      if (!b.active) {
        b.t -= dt;
        if (b.t <= 0) { b.active = true; b.grow = 0; }
      } else {
        b.grow = Math.min(1, b.grow + dt * 3);
        for (const r of racers) {
          const p = r.car.position;
          if (Math.abs(p.x - b.x) > 2 || Math.abs(p.z - b.z) > 2 || p.y > 4) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) > 1.9) continue;
          b.active = false;
          b.t = RESPAWN;
          this.particles.burst(V(b.x, 1.3, b.z), COLORS.lime, 12, 6);
          if (!r.item && !(r.rolling > 0)) {
            r.rolling = ROLL_TIME;
            r.rollItem = rollFor(ranks.get(r) ?? 0.5);
          }
          events.push({ type: 'box', racer: r });
          break;
        }
      }
      const k = b.active ? 1 - Math.pow(1 - b.grow, 3) : 0;
      q.setFromEuler(this._e.set(0.35, time * 1.7 + b.phase, 0.35));
      m4.compose(this._v.set(b.x, 1.25 + Math.sin(time * 2.2 + b.phase) * 0.18, b.z), q, sc.setScalar(Math.max(0.001, k)));
      this.boxMesh.setMatrixAt(i, m4);
      q.setFromEuler(this._e.set(-Math.PI / 2, 0, 0));
      m4.compose(this._v.set(b.x, 0.03, b.z), q, sc.setScalar(Math.max(0.001, k * (0.9 + Math.sin(time * 4 + b.phase) * 0.1))));
      this.haloMesh.setMatrixAt(i, m4);
    });
    this.boxMesh.instanceMatrix.needsUpdate = true;
    this.haloMesh.instanceMatrix.needsUpdate = true;

    // ---- rolling roulette + shields
    for (const r of racers) {
      if (r.rolling > 0) {
        r.rolling -= dt;
        if (r.rolling <= 0) { r.rolling = 0; r.item = r.rollItem; events.push({ type: 'item', racer: r }); }
      }
      if (r.shield > 0) r.shield = Math.max(0, r.shield - dt);
      if (r.immune > 0) r.immune -= dt;
      const sh = this.shields.get(r.car);
      if (sh) {
        sh.visible = r.shield > 0;
        if (sh.visible) {
          sh.position.copy(r.car.position).setY(r.car.position.y + 0.45);
          sh.quaternion.copy(r.car.group.quaternion);
          sh.material.uniforms.uTime.value = time;
          sh.material.uniforms.uAlpha.value = r.shield < 1.5 ? 0.5 + 0.5 * Math.sin(time * 20) : 1;
        }
      }
    }

    // ---- mines
    for (const m of this.mines) {
      if (!m.active) continue;
      m.life -= dt;
      m.arm -= dt;
      m.ring.material.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time * 9 + m.x));
      m.can.rotation.y += dt * 1.5;
      if (m.life <= 0) { m.active = false; m.g.visible = false; continue; }
      for (const r of racers) {
        if (r === m.owner && m.arm > 0) continue;
        const p = r.car.position;
        if (p.y > 3 || Math.hypot(p.x - m.x, p.z - m.z) > 1.9) continue;
        m.active = false;
        m.g.visible = false;
        const pos = V(m.x, 1, m.z);
        this.particles.burst(pos, COLORS.red, 34, 11);
        this.#hit(r, m.owner, events, pos);
        break;
      }
    }

    // ---- hawks: follow the road towards the target, then strike
    for (const h of this.hawks) {
      if (!h.active) continue;
      h.life -= dt;
      const t = h.target;
      let aim;
      if (t && !t.finished) {
        const tp = t.car.position;
        const d = h.pos.distanceTo(tp);
        if (d < 2.4) {
          h.active = false;
          h.g.visible = false;
          const pos = tp.clone().setY(tp.y + 1);
          this.particles.burst(pos, 0xffffff, 46, 13);
          this.particles.burst(pos, COLORS.lime, 26, 9);
          for (let k = 0; k < 10; k++) this.particles.puff(pos.clone().setY(0.6), 0xdfe6ff, 2.6, 1.8);
          this.#hit(t, h.owner, events, pos);
          continue;
        }
        if (d > 26) {
          const s = trackParam(h.pos.x, h.pos.z);
          const p = trackPoint(s + 20, clamp(trackDistance(tp.x, tp.z), 2, TRACK_W - 2));
          aim = this._v.set(p.x, tp.y + 1.2, p.z);
        } else aim = this._v.copy(tp).setY(tp.y + 0.9);
      } else {
        const s = trackParam(h.pos.x, h.pos.z);
        const lane = clamp(trackDistance(h.pos.x, h.pos.z), 2, TRACK_W - 2);
        const ahead = Math.cos(Math.atan2(-h.vel.z, h.vel.x) - trackPoint(s, lane).yaw) >= 0 ? 1 : -1;
        const p = trackPoint(s + ahead * 20, lane);
        aim = this._v.set(p.x, 1.6, p.z);
      }
      if (h.life <= 0) {
        h.active = false;
        h.g.visible = false;
        this.particles.burst(h.pos.clone(), COLORS.lime, 16, 6);
        continue;
      }
      const want = aim.sub(h.pos).normalize().multiplyScalar(HAWK_SPEED);
      h.vel.lerp(want, 1 - Math.exp(-7 * dt));
      h.pos.addScaledVector(h.vel, dt);
      h.g.position.copy(h.pos);
      h.g.rotation.set(0, Math.atan2(-h.vel.z, h.vel.x), 0);
      const flap = Math.sin(time * 22) * 0.6;
      h.wl.rotation.x = flap;
      h.wr.rotation.x = -flap;
      this.particles.puff(h.pos.clone(), COLORS.lime, 0.25, 0.7);
      if (Math.random() < dt * 30) this.particles.spark(h.pos, 0xffffff);
    }
    return events;
  }
}
