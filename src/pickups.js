// Collectables (mini cans, bolts, wing tokens, nitro tanks) floating over the
// road, and the score-attack checkpoint gate. Nothing here blocks the road:
// every pickup is a drive-through. Items are recycled around the car so the
// lap always feels full without spawning thousands of objects.
import * as THREE from 'three';
import { COLORS, CAN, tex, canGeometry, canMaterials, wingShape, boltShape, radialTexture } from './brand.js';
import { TRACK } from './world.js';
import { trackPoint, trackParam, PERIM, TRACK_W } from './track.js';
import { nitroBottle, materials } from './vehicles/parts.js';

const COUNTS = { can: 36, bolt: 14, wings: 3, nitro: 10 };

const RADIUS = { can: 2.2, bolt: 2.4, wings: 3, nitro: 2.5 };
const RECYCLE = 120;

export class Pickups {
  constructor(scene, obstacles) {
    this.scene = scene;
    this.obstacles = obstacles;
    this.mode = 'solo';
    this.items = [];

    const halo = radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    const haloGeo = new THREE.PlaneGeometry(2.8, 2.8);
    const haloMat = (c, o = 0.28) => new THREE.MeshBasicMaterial({ map: halo, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: o });

    // Mini cans: same high-poly geometry as the monuments, both flavours.
    const canGeo = canGeometry('low');
    const canMat = { classic: canMaterials('classic'), ultra: canMaterials('ultra') };
    for (const k in canMat) canMat[k][0].emissiveIntensity = 0.08;
    const canHalo = { classic: haloMat(COLORS.electric), ultra: haloMat(COLORS.red) };

    // Bolt: bevelled lightning in lime.
    const boltGeo = new THREE.ExtrudeGeometry(boltShape(), { depth: 0.2, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 5, curveSegments: 12 });
    boltGeo.center();
    const boltMat = new THREE.MeshPhysicalMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.2, clearcoat: 1 });
    const boltHalo = haloMat(COLORS.lime);

    // Wing token: chrome wings inside a glowing ring.
    const wingGeo = new THREE.ExtrudeGeometry(wingShape(), { depth: 0.08, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 5, curveSegments: 48 });
    const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.12, clearcoat: 1, emissive: 0xffffff, emissiveIntensity: 0.15 });
    const ringGeo = new THREE.TorusGeometry(1.25, 0.07, 16, 160);
    const ringMat = new THREE.MeshStandardMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 0.4, roughness: 0.4 });
    const wingHalo = haloMat(0xffffff, 0.35);

    let flip = false;
    const make = (type) => {
      const root = new THREE.Group();
      const spin = new THREE.Group();
      root.add(spin);
      let h;
      if (type === 'can') {
        const flavor = (flip = !flip) ? 'classic' : 'ultra';
        const c = new THREE.Mesh(canGeo, canMat[flavor]);
        c.scale.setScalar(0.5);
        c.position.y = -CAN.h * 0.25;
        spin.add(c);
        spin.rotation.z = 0.22;
        h = new THREE.Mesh(haloGeo, canHalo[flavor]);
      } else if (type === 'nitro') {
        // standing nitro canister with a lime ring around it
        const n = nitroBottle(0.95, 0.2, materials().navy);
        n.rotation.z = Math.PI / 2;
        n.position.y = -0.1;
        spin.add(n);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 12, 96), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -0.55;
        spin.add(ring);
        h = new THREE.Mesh(haloGeo, boltHalo);
        h.scale.setScalar(1.3);
      } else if (type === 'bolt') {
        const b = new THREE.Mesh(boltGeo, boltMat);
        b.scale.setScalar(0.85);
        spin.add(b);
        h = new THREE.Mesh(haloGeo, boltHalo);
      } else {
        for (const s of [1, -1]) {
          const w = new THREE.Mesh(wingGeo, wingMat);
          w.scale.set(0.75 * s, 0.75, 1);
          w.position.set(0.05 * s, -0.45, -0.04);
          spin.add(w);
        }
        spin.add(new THREE.Mesh(ringGeo, ringMat));
        h = new THREE.Mesh(haloGeo, wingHalo);
        h.scale.setScalar(1.7);
      }
      h.rotation.x = -Math.PI / 2;
      h.position.y = -1.1;
      root.add(h);
      spin.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(root);
      return { type, root, spin, phase: Math.random() * 10, active: true };
    };

    for (const type of ['can', 'bolt', 'wings', 'nitro']) {
      for (let i = 0; i < COUNTS[type]; i++) this.items.push(make(type));
    }

    this.gate = new Gate(scene);
  }

  // Random spot on the road, minR..maxR metres along the lap from a point
  // (ahead or behind), clear of anything listed in obstacles.
  spot(center, minR, maxR, clearance = 3) {
    const s0 = trackParam(center.x, center.z);
    for (let tries = 0; tries < 30; tries++) {
      const d = (minR + Math.random() * (maxR - minR)) * (Math.random() < 0.5 ? 1 : -1);
      const p = trackPoint(s0 + d, 1.5 + Math.random() * (TRACK_W - 3));
      if (this.obstacles.every((t) => Math.hypot(t.x - p.x, t.z - p.z) > t.r + clearance)) return { x: p.x, z: p.z };
    }
    const p = trackPoint(s0 + minR, TRACK_W / 2);
    return { x: p.x, z: p.z };
  }

  scatter(center) {
    this.mode = 'solo';
    for (const it of this.items) { it.home = null; it.disabled = false; this.#place(it, center, 12, 100); }
    this.gate.hide();
  }

  // Races (Grand Prix + Duel): nitro tanks and Hawk wings at fixed spots
  // around the oval. Score pickups are switched off.
  layoutRace() {
    this.mode = 'race';
    this.gate.hide();
    const W = TRACK.lanes * TRACK.lane;
    const spots = { nitro: [], wings: [] };
    // clear of the Hawk Box rows (s = 128, 292, 468, 676)
    for (const s of [48, 210, 385, 560, 770]) spots.nitro.push(trackPoint(s, 5.4), trackPoint(s, 13.8));
    spots.wings.push(trackPoint(335, W / 2), trackPoint(725, W / 2));
    const used = { nitro: 0, wings: 0 };
    for (const it of this.items) {
      const list = spots[it.type];
      if (!list || used[it.type] >= list.length) {
        it.active = false;
        it.home = null;
        it.root.visible = false;
        it.disabled = true;
        continue;
      }
      it.disabled = false;
      const sp = list[used[it.type]++];
      it.home = { x: sp.x, z: sp.z };
      it.root.position.set(sp.x, it.type === 'wings' ? 1.6 : 1.4, sp.z);
      it.active = true;
      it.root.visible = true;
    }
  }

  // Next gate: 60-110 m further along the lap in the direction of travel,
  // facing the road so the car threads straight through it.
  spawnGate(car) {
    const s0 = trackParam(car.position.x, car.position.z);
    const here = trackPoint(s0, TRACK_W / 2);
    const fwd = Math.cos(here.yaw) * car.forward.x - Math.sin(here.yaw) * car.forward.z;
    const dir = fwd >= 0 ? 1 : -1;
    for (let tries = 0; tries < 20; tries++) {
      const p = trackPoint(s0 + dir * (60 + Math.random() * 50), 4 + Math.random() * (TRACK_W - 8));
      if (this.obstacles.every((t) => Math.hypot(t.x - p.x, t.z - p.z) > t.r + 6) || tries === 19) {
        this.gate.show(p.x, p.z, p.yaw + Math.PI / 2);
        return;
      }
    }
  }

  #place(it, center, minR, maxR) {
    const s = this.spot(center, minR, maxR);
    it.root.position.set(s.x, it.type === 'wings' ? 1.6 : it.type === 'nitro' ? 1.4 : 1.25, s.z);
    it.active = true;
    it.root.visible = true;
  }

  // cars: active cars; magnets: Hawk Mode pull radius per car.
  // Events carry `who` (index into cars).
  update(dt, time, cars, magnets = []) {
    if (!Array.isArray(cars)) cars = [cars];
    const events = [];
    const cp = cars[0].position;
    const nearest = (x, z) => {
      let best = 0, bd = Infinity;
      cars.forEach((c, i) => {
        const d = Math.hypot(c.position.x - x, c.position.z - z);
        if (d < bd) { bd = d; best = i; }
      });
      return [best, bd];
    };
    const duel = this.mode === 'race';

    for (const it of this.items) {
      if (it.disabled) continue;
      const p = it.root.position;
      if (it.active) {
        it.spin.rotation.y += dt * (it.type === 'wings' ? 1.6 : 2.4);
        it.spin.position.y = Math.sin(time * 2.4 + it.phase) * 0.2;
        const [who, d] = nearest(p.x, p.z);
        const c = cars[who].position;
        const mag = magnets[who] ?? 0;
        if (mag > 0 && d < mag && d > 0.01 && it.type !== 'wings') {
          p.x -= ((p.x - c.x) / d) * dt * 28;
          p.z -= ((p.z - c.z) / d) * dt * 28;
        }
        if (d < RADIUS[it.type] && Math.abs(c.y - p.y) < 3) {
          it.active = false;
          events.push({ type: it.type, pos: p.clone(), who });
          it.root.visible = false;
          it.respawnIn = duel ? (it.type === 'wings' ? 12 : 4) : it.type === 'wings' ? 8 : 1.5;
        } else if (!duel && d > RECYCLE) {
          this.#place(it, cp, 60, 100);
        }
      } else {
        it.respawnIn -= dt;
        if (it.respawnIn <= 0) {
          if (it.home) {
            it.root.position.set(it.home.x, it.type === 'wings' ? 1.6 : 1.4, it.home.z);
            it.active = true;
            it.root.visible = true;
          } else this.#place(it, cp, 50, 100);
        }
      }
    }

    if (!duel && this.gate.update(dt, time, cp)) events.push({ type: 'gate', pos: this.gate.root.position.clone().setY(3), who: 0 });
    return events;
  }
}

// A tall lime ring with the logo, plus a light beam visible from afar.
class Gate {
  constructor(scene) {
    this.root = new THREE.Group();
    this.active = false;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.lime).multiplyScalar(3) });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b1035, metalness: 0.9, roughness: 0.25 });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.22, 24, 192), ringMat);
    this.ring.position.y = 5;
    this.outer = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.12, 16, 192), frameMat);
    this.outer.position.y = 5;
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4 * (952 / 1400)),
      new THREE.MeshBasicMaterial({ map: tex('logo'), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    logo.position.y = 11.4;
    const legGeo = new THREE.CylinderGeometry(0.22, 0.32, 5, 32);
    for (const s of [1, -1]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(s * 4.2, 1.5, 0);
      this.root.add(leg);
    }
    const beamMat = new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 120, 48, 1, true), beamMat);
    this.beam.position.y = 60;
    this.root.add(this.ring, this.outer, logo, this.beam);
    this.root.visible = false;
    scene.add(this.root);
  }

  show(x, z, yaw) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.root.visible = true;
    this.active = true;
    this.root.scale.setScalar(0.01);
    this.grow = 0;
  }

  hide() {
    this.active = false;
    this.root.visible = false;
  }

  update(dt, time, carPos) {
    if (!this.active) return false;
    this.grow = Math.min(1, this.grow + dt * 2.5);
    const e = 1 - Math.pow(1 - this.grow, 3);
    this.root.scale.setScalar(Math.max(0.01, e));
    this.ring.rotation.z = time * 0.6;
    this.beam.material.opacity = 0.08 + 0.05 * Math.sin(time * 4);
    const p = this.root.position;
    if (Math.hypot(carPos.x - p.x, carPos.z - p.z) < 4.8 && carPos.y < 9) {
      this.hide();
      return true;
    }
    return false;
  }
}
