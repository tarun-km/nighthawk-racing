// A player car: one Rapier rigid body + raycast-vehicle controller for either
// the Classic Cruiser or the Ultra Buggy. Both cars exist at once (duel mode);
// in solo play the unused one is parked with setActive(false).
// Visuals come from vehicles/builds.js, liveries from public/liveries/*.png.
// Local axes: +X forward, +Y up, +Z right.
import * as THREE from 'three';
import { COLORS, FLAVORS, radialTexture } from './brand.js';
import { VEHICLES } from './vehicles/shells.js';
import { buildCruiser, buildBuggy } from './vehicles/builds.js';
import { Mascot } from './mascot.js';

const BASE = {
  engine: 580, // per wheel, N
  reverse: 280,
  brake: 950,
  maxSpeed: 34,
  boostSpeed: 50,
  boostImpulse: 2900,
  steerLow: 0.62,
  steerHigh: 0.2,
  grip: 3.3,
  driftSideStiffness: 0.32,
};

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Recolour a livery (CPU rivals, unlockable paints): draw it through a canvas filter.
function recolour(t, filter) {
  const img = t.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.filter = filter;
  g.drawImage(img, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.flipY = t.flipY;
  out.colorSpace = THREE.SRGBColorSpace;
  out.anisotropy = 8;
  return out;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Car {
  // variant: optional livery recolour for CPU rivals ({ filter, glow }).
  constructor(scene, physics, R, flavor = 'classic', variant = null) {
    this.R = R;
    this.physics = physics;
    this.tuning = { ...BASE };
    this.steer = 0;
    this.flipTimer = 0;
    this.drifting = false;
    this.lateral = 0;
    this.speed = 0;
    this.boosting = false;
    this.braking = false;
    this.airborne = false;
    this.airTime = 0;
    this.boostVis = 0;
    this.idle = false;
    this.held = false;
    this.flavor = null;
    this.prevPos = V(0, 0, 0);
    this.prevQuat = new THREE.Quaternion();
    this.currPos = V(0, 0, 0);
    this.currQuat = new THREE.Quaternion();
    this.prevVel = V(0, 0, 0);
    this.wasAir = false;
    this.spr = { roll: [0, 0], pitch: [0, 0], heave: [0, 0] };
    this.spin = 0; // spin-out timer (hit by a hawk or a can mine)
    this.spinDir = 1;

    this.group = new THREE.Group();
    scene.add(this.group);

    // Liveries: editable PNGs (see livery-templates/README.md).
    const livery = (this.livery = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 }));
    this.paint = null;
    new THREE.TextureLoader().load(`/liveries/${flavor}.png`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      this.liveryBase = t;
      if (variant?.filter) { livery.map = recolour(t, variant.filter); t.dispose(); }
      else this.setPaint(this.paint, true);
      livery.needsUpdate = true;
    });
    const b = (flavor === 'ultra' ? buildBuggy : buildCruiser)(VEHICLES[flavor], livery);
    b.spec = VEHICLES[flavor];
    b.mascot = new Mascot(flavor, b.chassis, b.spec.seat, b.steering);
    b.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(b.root);
    this.build = b;

    // Ground decals: soft contact shadow + boost glow.
    this.glowMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), color: COLORS.electric, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 3.8), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.55)'), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.glow, this.shadow);

    this.body = physics.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(0, 1.4, 0).setCanSleep(false).setLinearDamping(0.08).setAngularDamping(1.2).setCcdEnabled(true),
    );

    this._q = new THREE.Quaternion();
    this._v = V(0, 0, 0);
    this.forward = V(1, 0, 0);
    this.right = V(0, 0, 1);
    this.position = V(0, 0, 0);
    this.velocity = V(0, 0, 0);
    this.active = true;
    this.variant = variant;
    this.#init(flavor);
  }

  get spec() { return this.build.spec; }

  // Player paint jobs: null = the stock livery, otherwise a canvas filter.
  setPaint(filter, force = false) {
    if (filter === this.paint && !force) return;
    this.paint = filter;
    const base = this.liveryBase;
    if (!base) return; // applied once the livery has loaded
    if (this.painted) { this.painted.dispose(); this.painted = null; }
    if (filter) this.painted = recolour(base, filter);
    this.livery.map = this.painted ?? base;
    this.livery.needsUpdate = true;
  }

  // Rebuild collider + wheel layout for the chosen car.
  #buildPhysics(spec) {
    const { physics, R } = this;
    if (this.vehicle) physics.removeVehicleController(this.vehicle);
    if (this.collider) physics.removeCollider(this.collider, true);
    const c = spec.collider;
    this.collider = physics.createCollider(
      R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
        .setTranslation(0, c.y, 0)
        .setFriction(0.2)
        .setRestitution(0)
        .setMassProperties(spec.mass, { x: 0, y: spec.com, z: 0 }, { x: 34, y: 100, z: 86 }, { x: 0, y: 0, z: 0, w: 1 }),
      this.body,
    );
    const v = (this.vehicle = physics.createVehicleController(this.body));
    const s = spec.suspension;
    spec.wheels.forEach((w, i) => {
      v.addWheel({ x: w.x, y: 0, z: w.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, spec.rest, spec.wheelRadius);
      v.setWheelSuspensionStiffness(i, s.stiffness);
      v.setWheelSuspensionCompression(i, s.compression);
      v.setWheelSuspensionRelaxation(i, s.relaxation);
      v.setWheelMaxSuspensionTravel(i, s.travel);
      v.setWheelFrictionSlip(i, this.tuning.grip);
    });
  }

  #init(key) {
    const f = FLAVORS[key] ?? FLAVORS.classic;
    this.flavor = f.key;
    this.tuning = { ...BASE, ...this.build.spec.tuning };
    this.glowMat.color.setHex(this.variant?.glow ?? f.glow);
    this.#buildPhysics(this.build.spec);
  }

  // Park / unpark: hidden, no collisions, no simulation.
  setActive(on) {
    this.active = on;
    this.group.visible = on;
    this.glow.visible = on;
    this.shadow.visible = on;
    this.body.setEnabled(on);
  }

  react(kind) {
    this.build.mascot.react(kind);
    if (kind === 'cheer') this.spr.heave[1] += 1.2;
  }

  reset(x = 0, z = 0, yaw = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
    this.body.setGravityScale(1, true);
    this.held = false;
    this.body.setTranslation({ x, y: 1.4, z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.flipTimer = 0;
    this.spin = 0;
    this.prevPos.set(x, 1.4, z);
    this.prevQuat.copy(q);
  }

  resetUpright() {
    const yaw = Math.atan2(-this.forward.z, this.forward.x);
    const p = this.body.translation();
    this.reset(p.x, p.z, yaw);
  }

  // Cinematics: pin the car to a scripted pose (no gravity), then let go.
  hold(pos, quat) {
    this.held = true;
    this.body.setGravityScale(0, true);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // Knocked into a spin: no drive for a moment, the car rotates and scrubs speed.
  // Roughly one full turn, then a short recovery that swings the nose back to
  // the original heading, so the car comes out facing the way it was going.
  // Everything goes through torque, so walls and other cars still push back.
  spinOut(t = 1.45) {
    if (this.spin > 0) return;
    this.spin = this.spinTotal = t;
    this.spinDir = Math.random() < 0.5 ? -1 : 1;
    this.spinYaw = Math.atan2(-this.forward.z, this.forward.x);
    this.build.mascot.react('land');
    this.spr.heave[1] += 1.6;
  }

  release(vel) {
    this.held = false;
    this.body.setGravityScale(1, true);
    this.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  }

  capturePrev() {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.prevPos.set(p.x, p.y, p.z);
    this.prevQuat.set(r.x, r.y, r.z, r.w);
  }

  // Called once per fixed physics step, before world.step().
  prePhysics(input, dt, { boost = false, hawk = false, frozen = false } = {}) {
    const t = this.tuning;
    const v = this.vehicle;
    const spec = this.spec;
    const speed = v.currentVehicleSpeed();
    this.speed = speed;
    if (this.held) { v.updateVehicle(dt); this.airborne = true; this.braking = false; return; }

    const spinning = this.spin > 0;
    if (spinning) this.spin = Math.max(0, this.spin - dt);
    const throttle = frozen || spinning ? 0 : input.throttle;
    const steerIn = frozen || spinning ? 0 : input.steer;
    const handbrake = !frozen && (spinning || input.handbrake);
    const top = boost || hawk ? t.boostSpeed : t.maxSpeed;

    let engine = 0;
    let brake = frozen ? 30 : 0;
    if (throttle > 0) engine = speed < top ? throttle * t.engine * (hawk ? 1.35 : 1) : 0;
    else if (throttle < 0) {
      if (speed > 1.5) brake = -throttle * t.brake;
      else engine = speed > -12 ? throttle * t.reverse : 0;
    }

    const speedK = Math.min(Math.abs(speed) / 36, 1);
    const maxSteer = t.steerLow + (t.steerHigh - t.steerLow) * speedK;
    this.steer = damp(this.steer, steerIn * maxSteer, 9, dt);

    spec.wheels.forEach((w, i) => {
      v.setWheelSteering(i, w.front ? this.steer : 0);
      v.setWheelEngineForce(i, engine);
      v.setWheelBrake(i, brake / 4 + (!w.front && handbrake ? 12 : 0));
      v.setWheelSideFrictionStiffness(i, !w.front && handbrake ? t.driftSideStiffness : 1);
      v.setWheelFrictionSlip(i, !w.front && handbrake ? t.grip * 0.55 : t.grip);
    });

    const rot = this.body.rotation();
    this._q.set(rot.x, rot.y, rot.z, rot.w);
    this.forward.set(1, 0, 0).applyQuaternion(this._q);
    const up = this._v.set(0, 1, 0).applyQuaternion(this._q);

    this.boosting = boost && !frozen;
    if (this.boosting && speed < t.boostSpeed) {
      const k = t.boostImpulse * dt;
      this.body.applyImpulse({ x: this.forward.x * k, y: 0, z: this.forward.z * k }, true);
    }

    // Arcade assists: crisp turn-in, yaw damping, a little air control.
    const av = this.body.angvel();
    if (spinning) {
      // a flat 360 that bleeds off speed, then control comes back
      const lv = this.body.linvel();
      const keep = 1 - Math.min(1, 2.2 * dt);
      this.body.setLinvel({ x: lv.x * keep, y: lv.y, z: lv.z * keep }, true);
      const RECOVER = 0.4;
      let target;
      if (this.spin > RECOVER) target = (this.spinDir * Math.PI * 2) / (this.spinTotal - RECOVER);
      else {
        const yaw = Math.atan2(-this.forward.z, this.forward.x);
        const e = Math.atan2(Math.sin(this.spinYaw - yaw), Math.cos(this.spinYaw - yaw));
        target = THREE.MathUtils.clamp(e * 9, -7, 7);
      }
      if (!this.airborne) this.body.applyTorqueImpulse({ x: 0, y: (target - av.y) * 100 * Math.min(1, 14 * dt), z: 0 }, true);
    } else if (!this.airborne && !frozen) {
      const k = Math.min(Math.abs(speed) / 8, 1) * (speed < -0.5 ? -1 : 1);
      const turn = steerIn * k * 200 * dt * (handbrake ? 1.6 : 1);
      const yawDamp = handbrake ? 0 : -av.y * (steerIn ? 0.6 : 3.2) * 100 * dt;
      this.body.applyTorqueImpulse({ x: 0, y: turn + yawDamp, z: 0 }, true);
    } else if (this.airborne && !frozen) {
      this.body.applyTorqueImpulse({ x: 0, y: steerIn * 90 * dt, z: 0 }, true);
    }

    // Downforce when grounded (jumps keep their arc) + self-righting.
    if (!this.airborne) {
      const df = Math.abs(speed) * 14 * dt;
      this.body.applyImpulse({ x: 0, y: -df, z: 0 }, true);
    }
    // arcade stability: bumps between cars can't roll or flip anyone
    const tilt = 1 - up.y; // 0 upright .. 2 upside down
    const corr = new THREE.Vector3().crossVectors(up, V(0, 1, 0)).multiplyScalar((this.airborne ? 240 : 150) * (1 + tilt * 6) * dt);
    this.body.applyTorqueImpulse({ x: corr.x, y: 0, z: corr.z }, true);
    const w = this.body.angvel();
    const LIM = 2.2;
    if (Math.abs(w.x) > LIM || Math.abs(w.z) > LIM) {
      this.body.setAngvel({ x: THREE.MathUtils.clamp(w.x, -LIM, LIM), y: w.y, z: THREE.MathUtils.clamp(w.z, -LIM, LIM) }, true);
    }

    // the course is flat: nothing should ever fling a car skywards
    const lv = this.body.linvel();
    if (lv.y > 5) this.body.setLinvel({ x: lv.x, y: 5, z: lv.z }, true);

    v.updateVehicle(dt);
    this.braking = !frozen && (brake > 0 || handbrake);

    // contact state is owned by the fixed step (assists and scoring read it)
    let contacts = 0;
    for (let i = 0; i < spec.wheels.length; i++) if (v.wheelIsInContact(i)) contacts++;
    this.airborne = contacts === 0;
    this.airTime = this.airborne ? this.airTime + dt : 0;
  }

  // Called once per rendered frame; alpha blends the last two physics poses.
  sync(dt, time = 0, alpha = 1) {
    const r = this.body.rotation();
    const t = this.body.translation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    this.group.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.group.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const p = this.group.position;
    const lv = this.body.linvel();
    this.position.copy(p);
    this.velocity.set(lv.x, lv.y, lv.z);
    this.forward.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    this.right.set(0, 0, 1).applyQuaternion(this.group.quaternion);

    const planar = Math.hypot(lv.x, lv.z);
    this.lateral = Math.abs(this.velocity.dot(this.right));
    this.drifting = !this.airborne && planar > 8 && this.lateral > 4.5;

    const b = this.build;
    const v = this.vehicle;
    b.wheels.forEach((w, i) => {
      const c = v.wheelChassisConnectionPointCs(i);
      const len = v.wheelSuspensionLength(i) ?? b.spec.rest;
      w.pivot.position.set(c.x, c.y - len, c.z);
      w.pivot.rotation.y = v.wheelSteering(i) ?? 0;
      w.spin.rotation.z = -(v.wheelRotation(i) ?? 0);
    });

    this.#animate(dt, time, planar);
    b.update(dt);

    // ground decals follow the car
    const yaw = Math.atan2(-this.forward.z, this.forward.x);
    const h = Math.max(0, p.y - 0.8);
    this.shadow.position.set(p.x, 0.02, p.z);
    this.shadow.rotation.z = yaw;
    this.shadow.material.opacity = Math.max(0.05, 0.8 - h * 0.25);
    this.glow.position.set(p.x, 0.03, p.z);
    this.glow.rotation.z = yaw;
    this.glowMat.opacity = damp(this.glowMat.opacity, this.boosting ? 0.5 : 0, 6, dt);

    // exhaust flames
    this.boostVis = damp(this.boostVis, this.boosting ? 1 : 0, 10, dt);
    for (const e of b.exhausts) {
      const flick = 0.75 + Math.random() * 0.35;
      const s = Math.max(0.001, this.boostVis * flick);
      e.flame.scale.set(s, 0.7 + this.boostVis * 0.5, 0.7 + this.boostVis * 0.5);
      e.core.scale.set(s * 0.6, 0.45, 0.45);
    }
    b.flameMat.opacity = this.boostVis;
    b.flameMat.userData.core.opacity = this.boostVis * 0.9;
    b.tail.emissiveIntensity = this.braking ? 3.4 : this.speed < -0.5 ? 2.4 : 1.1;

    const up = this._v.set(0, 1, 0).applyQuaternion(this.group.quaternion);
    if (!this.held && (up.y < 0.25 || p.y < -5)) this.flipTimer += dt;
    else this.flipTimer = 0;
    if (this.flipTimer > 1.4) this.resetUpright();
  }

  // Springy toy-car body (roll / pitch / heave) and the mascot.
  #animate(dt, time, planar) {
    if (dt <= 0) return;
    const s = this.spr;
    const spring = (st, target, k, c) => {
      st[1] += ((target - st[0]) * k - st[1] * c) * dt;
      st[0] += st[1] * dt;
      return st[0];
    };
    const acc = this._v.copy(this.velocity).sub(this.prevVel).divideScalar(Math.max(dt, 1e-3));
    this.prevVel.copy(this.velocity);
    const latA = THREE.MathUtils.clamp(acc.dot(this.right), -40, 40);
    const lonA = THREE.MathUtils.clamp(acc.dot(this.forward), -40, 40);
    if (this.wasAir && !this.airborne) {
      s.heave[1] -= 2.2;
      this.build.mascot.react('land');
    }
    this.wasAir = this.airborne;

    const roll = spring(s.roll, this.airborne ? 0 : latA * 0.0045, 140, 11);
    const pitch = spring(s.pitch, this.airborne ? 0 : -lonA * 0.0035, 140, 11);
    const heave = spring(s.heave, 0, 160, 10);
    const ch = this.build.chassis;
    ch.rotation.set(THREE.MathUtils.clamp(roll, -0.14, 0.14), 0, THREE.MathUtils.clamp(pitch, -0.1, 0.1));
    ch.position.y = THREE.MathUtils.clamp(heave * 0.1, -0.12, 0.12);

    this.build.mascot.update(dt, { steer: this.steer, latA, lonA, boost: this.boostVis, planar, idle: this.idle, time });
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }
}
