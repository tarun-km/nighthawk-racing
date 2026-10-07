// Visual builds for the two cars. Each returns:
//   { root, chassis, wheels: [{ pivot, spin }], steering, exhausts, tail, update(dt) }
// root holds the wheels (physics-driven); chassis is the sprung body that
// rolls/pitches on springs and carries the mascot.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildShell } from './shells.js';
import {
  V, materials, tube, cruiserWheel, buggyWheel, banjoSteering, flatBottomSteering,
  bucketLamp, nitroBottle, hoodOrnament, exhaust,
} from './parts.js';

function mount(steering, spec) {
  const g = steering.group;
  g.rotation.order = 'YXZ';
  g.rotation.set(spec.steering.tilt, -Math.PI / 2, 0);
  g.position.set(spec.steering.x, spec.steering.y, 0);
  return steering;
}

function wheelPivots(root, spec, make) {
  return spec.wheels.map((w) => {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    const wheel = make();
    wheel.scale.z = Math.sign(w.z); // outer face always points outwards
    spin.add(wheel);
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin, w };
  });
}

function flameMaterial(color) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  m.userData.core = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  return m;
}

// ---------------------------------------------------------------------------
// Classic Cruiser
// ---------------------------------------------------------------------------
export function buildCruiser(spec, livery) {
  const m = materials();
  const tail = m.tail.clone(); // each car owns its brake-light material
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const add = (...o) => chassis.add(...o);

  add(new THREE.Mesh(buildShell(spec), livery));

  // cockpit: floor, tufted bench, dash with chrome gauges
  const floor = new THREE.Mesh(new RoundedBoxGeometry(1.14, 0.05, 0.94, 4, 0.02), m.black);
  floor.position.set(-0.38, 0.16, 0);
  const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.14, 0.9, 6, 0.06), m.leatherBlue);
  cushion.position.set(-0.56, 0.22, 0);
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.5, 0.9, 6, 0.07), m.leatherBlue);
  back.position.set(-0.84, 0.46, 0);
  back.rotation.z = 0.18;
  add(floor, cushion, back);
  for (let i = 0; i < 4; i++) {
    const tuft = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.82, 4, 12), m.black);
    tuft.rotation.x = Math.PI / 2;
    tuft.position.set(-0.755 - i * 0.02, 0.32 + i * 0.1, 0);
    add(tuft);
  }
  const dash = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.22, 0.96, 6, 0.06), m.navy);
  dash.position.set(0.16, 0.42, 0);
  add(dash);
  for (const z of [-0.26, 0, 0.26]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 12, 48), m.chrome);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0.075, 0.44, z);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.05, 48), m.ivory);
    face.rotation.y = -Math.PI / 2;
    face.position.set(0.078, 0.44, z);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.006), m.red);
    needle.position.set(0.074, 0.45, z);
    needle.rotation.x = 0.6;
    add(ring, face, needle);
  }

  // curved windscreen with chrome frame
  const R = 0.9, th = 0.56;
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.3, 64, 1, true, Math.PI / 2 - th, th * 2), m.glass);
  screen.position.set(0.26 - R, 0.66, 0);
  screen.rotation.z = -0.2;
  add(screen);
  const framePts = [];
  for (let i = 0; i <= 24; i++) {
    const a = -th + (i / 24) * th * 2;
    framePts.push(V(0.26 - R + Math.cos(a) * R + 0.035, 0.81, Math.sin(a) * R));
  }
  add(tube(framePts, 0.014, m.chrome, { segs: 64, radial: 10 }));
  for (const s of [1, -1]) add(tube([V(0.07, 0.44, s * 0.48), V(0.06, 0.62, s * 0.49), V(0.05, 0.8, s * 0.5)], 0.014, m.chrome, { segs: 16, radial: 10 }));

  // grille: chrome racetrack surround + vertical bars + dark backing
  const gp = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    gp.push(V(1.67, Math.sin(a) * 0.13, Math.cos(a) * 0.24));
  }
  add(tube(gp, 0.022, m.chrome, { closed: true, segs: 120, radial: 14 }));
  const backing = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m.black);
  backing.scale.set(0.02, 0.12, 0.22);
  backing.position.set(1.66, 0, 0);
  add(backing);
  const bars = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.009, 0.2, 4, 12), m.chrome, 9);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 9; i++) {
    const z = (i - 4) * 0.048;
    const h = Math.sqrt(Math.max(0, 1 - (z / 0.24) ** 2)) * 0.11;
    m4.compose(V(1.675, 0, z), new THREE.Quaternion(), V(1, h / 0.11, 1));
    bars.setMatrixAt(i, m4);
  }
  add(bars);

  // headlights: two big chrome buckets + a small fog lamp in the middle
  for (const s of [1, -1]) {
    const lamp = bucketLamp(0.15);
    lamp.position.set(1.5, 0.24, s * 0.56);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 16), m.chrome);
    stalk.position.set(1.36, 0.17, s * 0.56);
    add(lamp, stalk);
  }
  const fog = bucketLamp(0.075);
  fog.position.set(1.9, -0.17, 0);
  add(fog);

  // chrome bumpers with overriders
  for (const [x, dir] of [[1.88, 1], [-1.82, -1]]) {
    add(tube([V(x - dir * 0.12, -0.27, -0.78), V(x, -0.27, -0.5), V(x + dir * 0.02, -0.27, 0), V(x, -0.27, 0.5), V(x - dir * 0.12, -0.27, 0.78)], 0.05, m.chrome, { segs: 96, radial: 20 }));
    for (const z of [0.34, -0.34]) {
      const o = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 8, 16), m.chrome);
      o.position.set(x + dir * 0.02, -0.21, z);
      add(o);
    }
  }

  // hood ornament: the Night Hawk wings in chrome
  const orn = hoodOrnament();
  orn.position.set(1.3, 0.36, 0);
  add(orn);
  // hood louvres
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.16, 4, 12), m.chrome);
      l.rotation.z = Math.PI / 2 - 0.15;
      l.position.set(0.7 + i * 0.12, 0.31 - i * 0.012, s * 0.6);
      add(l);
    }
  }

  // twin nitro bottles strapped to the boat-tail
  for (const s of [1, -1]) {
    const b = nitroBottle(0.5, 0.075, m.navy);
    b.position.set(-1.12, 0.47, s * 0.19);
    b.rotation.z = -0.12;
    add(b);
    for (const x of [-1.25, -0.98]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.01, 8, 32), m.black);
      strap.rotation.y = Math.PI / 2;
      strap.position.set(x, 0.46 + (x + 1.12) * 0.12, s * 0.19);
      add(strap);
    }
    add(tube([V(-0.82, 0.5, s * 0.19), V(-0.72, 0.4, s * 0.25), V(-0.62, 0.22, s * 0.3)], 0.012, m.lime, { segs: 24, radial: 8 }));
  }

  // bullet tail lights on the rear fenders
  for (const s of [1, -1]) {
    const t = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 8, 24), m.chrome);
    shell.rotation.z = Math.PI / 2;
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.058, 24, 16), tail);
    lens.position.x = -0.1;
    lens.scale.set(0.6, 1, 1);
    t.add(shell, lens);
    t.position.set(-1.52, 0.17, s * 0.82);
    add(t);
  }

  // exhausts
  const flameMat = flameMaterial(0x3d6bff);
  const exhausts = [0.3, -0.3].map((z) => {
    const e = exhaust(0.055, 0.3, flameMat);
    e.group.position.set(-1.62, -0.3, z);
    add(e.group);
    return e;
  });

  const steering = mount(banjoSteering(), spec);
  add(steering.group);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.3, 16), m.chrome);
  column.position.set(0.17, 0.52, 0);
  column.rotation.z = 1.05;
  add(column);

  const wheels = wheelPivots(root, spec, () => cruiserWheel(spec.wheelRadius, m.navy));
  return { root, chassis, wheels, steering, exhausts, flameMat, tail, update() {} };
}

// ---------------------------------------------------------------------------
// Ultra Buggy
// ---------------------------------------------------------------------------
export function buildBuggy(spec, livery) {
  const m = materials();
  const tail = m.tail.clone();
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const add = (...o) => chassis.add(...o);

  add(new THREE.Mesh(buildShell(spec), livery));

  // roll cage (lime powder coat)
  const cage = [
    // main hoop behind the seat
    [V(-0.6, 0.38, 0.6), V(-0.63, 1.0, 0.58), V(-0.65, 1.28, 0.38), V(-0.66, 1.31, 0), V(-0.65, 1.28, -0.38), V(-0.63, 1.0, -0.58), V(-0.6, 0.38, -0.6)],
    // front hoop leaning forward
    [V(0.52, 0.4, 0.58), V(0.34, 0.95, 0.55), V(0.16, 1.22, 0.4), V(0.13, 1.25, 0), V(0.16, 1.22, -0.4), V(0.34, 0.95, -0.55), V(0.52, 0.4, -0.58)],
  ];
  for (const pts of cage) add(tube(pts, 0.042, m.lime, { segs: 140, radial: 18 }));
  for (const s of [1, -1]) {
    add(tube([V(0.17, 1.22, s * 0.4), V(-0.25, 1.27, s * 0.4), V(-0.65, 1.28, s * 0.38)], 0.038, m.lime, { segs: 40, radial: 16 }));
    add(tube([V(-0.65, 1.22, s * 0.42), V(-0.98, 0.9, s * 0.46), V(-1.3, 0.6, s * 0.5)], 0.036, m.lime, { segs: 40, radial: 16 }));
    add(tube([V(0.5, 0.52, s * 0.62), V(0, 0.56, s * 0.66), V(-0.58, 0.52, s * 0.62)], 0.034, m.lime, { segs: 40, radial: 16 }));
  }
  add(tube([V(-0.62, 0.45, 0.56), V(-0.64, 0.85, 0.1), V(-0.66, 1.26, -0.34)], 0.032, m.lime, { segs: 40, radial: 16 }));

  // roof light bar + bull bar with two round spots
  const bar = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.11, 0.86, 4, 0.03), m.black);
  bar.position.set(0.2, 1.33, 0);
  add(bar);
  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.07, 0.16, 2, 0.008), m.led);
    led.position.set(0.265, 1.33, -0.3 + i * 0.2);
    add(led);
  }
  for (const s of [1, -1]) {
    add(tube([V(1.36, -0.08, s * 0.5), V(1.6, 0.05, s * 0.48), V(1.62, 0.3, s * 0.4), V(1.5, 0.42, s * 0.32)], 0.04, m.black, { segs: 40, radial: 14 }));
    const spot = bucketLamp(0.1);
    spot.position.set(1.66, 0.22, s * 0.28);
    add(spot);
  }
  add(tube([V(1.6, 0.12, -0.48), V(1.66, 0.12, 0), V(1.6, 0.12, 0.48)], 0.035, m.black, { segs: 30, radial: 14 }));

  // bucket seat with side bolsters + headrest
  const seatBack = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.62, 0.5, 5, 0.06), m.leatherRed);
  seatBack.position.set(-0.47, 0.5, 0);
  seatBack.rotation.z = 0.2;
  const seatBase = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.12, 0.5, 5, 0.05), m.leatherRed);
  seatBase.position.set(-0.26, 0.17, 0);
  add(seatBack, seatBase);
  for (const s of [1, -1]) {
    const bol = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.42, 0.08, 5, 0.035), m.red);
    bol.position.set(-0.36, 0.42, s * 0.27);
    bol.rotation.z = 0.2;
    add(bol);
  }
  // dash with tach
  const dash = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.2, 0.9, 5, 0.04), m.carbon);
  dash.position.set(0.48, 0.45, 0);
  const tach = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 48), m.lime);
  tach.rotation.z = Math.PI / 2;
  tach.position.set(0.405, 0.48, 0.15);
  add(dash, tach);

  // engine with stacks, side-pod nitro bottles
  const block = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.3, 0.46, 5, 0.06), m.satin);
  block.position.set(-0.98, 0.62, 0);
  const cover = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.08, 0.4, 4, 0.03), m.red);
  cover.position.set(-0.98, 0.8, 0);
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 48), m.lime);
  filter.position.set(-0.98, 0.9, 0);
  add(block, cover, filter);
  const flameMat = flameMaterial(0xff3b2e);
  const exhausts = [];
  for (const s of [1, -1]) {
    add(tube([V(-1.0, 0.62, s * 0.25), V(-1.18, 0.8, s * 0.3), V(-1.32, 1.0, s * 0.3)], 0.045, m.chrome, { segs: 32, radial: 16 }));
    const e = exhaust(0.05, 0.16, flameMat);
    e.group.position.set(-1.32, 1.0, s * 0.3);
    e.group.rotation.z = -0.75;
    add(e.group);
    exhausts.push(e);
    const b = nitroBottle(0.55, 0.075, m.red);
    b.position.set(-0.05, 0.25, s * 0.66);
    add(b);
    for (const x of [-0.2, 0.12]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.01, 8, 32), m.black);
      strap.rotation.y = Math.PI / 2;
      strap.position.set(x, 0.25, s * 0.66);
      add(strap);
    }
  }

  // round tail lights on the rear panel
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 10, 40), m.black);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-1.43, 0.22, s * 0.48);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), tail);
    lens.rotation.z = Math.PI / 2;
    lens.scale.set(1, 0.4, 1);
    lens.position.set(-1.43, 0.22, s * 0.48);
    add(ring, lens);
  }

  // fender flares
  const flare = new THREE.TorusGeometry(spec.wheelRadius + 0.08, 0.05, 12, 64, Math.PI * 0.85);
  for (const w of spec.wheels) {
    const f = new THREE.Mesh(flare, m.black);
    f.position.set(w.x, -spec.rest + 0.02, w.z);
    f.rotation.z = w.front ? 0.0 : 0.47;
    f.scale.z = 4.4;
    add(f);
  }

  const steering = mount(flatBottomSteering(), spec);
  add(steering.group);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 16), m.carbon);
  column.position.set(0.44, 0.5, 0);
  column.rotation.z = 1.1;
  add(column);

  const wheels = wheelPivots(root, spec, () => buggyWheel(spec.wheelRadius));

  // exposed suspension: A-arms + coilovers re-aimed at the wheel hubs every frame
  const armGeo = new THREE.CylinderGeometry(0.024, 0.024, 1, 12);
  const dampGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 16);
  const helix = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2 * 7;
    helix.push(V(Math.cos(a) * 0.05, i / 120 - 0.5, Math.sin(a) * 0.05));
  }
  const springGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 240, 0.011, 8);
  const links = wheels.map(({ w }) => {
    const side = Math.sign(w.z);
    const l = {
      side, w,
      arms: [0, 1, 2, 3].map(() => new THREE.Mesh(armGeo, m.black)),
      damper: new THREE.Mesh(dampGeo, m.satin),
      spring: new THREE.Mesh(springGeo, m.red),
    };
    root.add(...l.arms, l.damper, l.spring);
    return l;
  });
  const a = V(0, 0, 0), b = V(0, 0, 0), hub = V(0, 0, 0), dir = V(0, 0, 0);
  const Y = V(0, 1, 0);
  const place = (mesh, from, to) => {
    dir.copy(to).sub(from);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.scale.y = dir.length();
    mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
  };
  function update() {
    chassis.updateMatrix();
    links.forEach((l, i) => {
      const p = wheels[i].pivot.position;
      hub.set(p.x, p.y, p.z - l.side * 0.16);
      const mounts = [[0.2, 0.12], [-0.2, 0.12], [0.22, -0.16], [-0.22, -0.16]];
      mounts.forEach(([dx, dy], k) => {
        a.set(l.w.x + dx, dy, l.side * 0.5).applyMatrix4(chassis.matrix);
        b.copy(hub).setY(hub.y + (dy > 0 ? 0.1 : -0.06));
        place(l.arms[k], a, b);
      });
      a.set(l.w.x - 0.05, 0.5, l.side * 0.48).applyMatrix4(chassis.matrix);
      b.copy(hub).setY(hub.y - 0.04);
      place(l.damper, a, b);
      place(l.spring, a, b);
      l.spring.scale.set(1, l.spring.scale.y * 0.82, 1);
    });
  }

  return { root, chassis, wheels, steering, exhausts, flameMat, tail, update };
}
