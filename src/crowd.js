// The crowd: seated Night Hawk can mascots that cheer the drivers on.
// Classic fans wear a fedora + 8-bit shades, Ultra fans a beanie + star
// glasses, just like the drivers. Everything is instanced; the cheering
// (hops, waving arms, signs) runs in the vertex shader and gets louder for
// fans close to a passing car.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, CAN, FLAVORS, tex, faceFrontYaw, canvasTexture } from './brand.js';

const SCALE = 0.42; // can units -> metres (a fan is ~1.1 m tall)
const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);

// Paint a whole geometry one vertex colour (so parts can share a material).
function tint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const merge = (parts) => mergeGeometries(parts.map(([g, c]) => tint(g, c)));

// ---------- fan parts (can units, facing +X) ----------
function bodyGeometry() {
  const body = new THREE.CylinderGeometry(CAN.r, CAN.r, CAN.bodyTop - CAN.bodyBottom, 18, 1, true);
  body.translate(0, (CAN.bodyTop + CAN.bodyBottom) / 2, 0);
  body.rotateY(faceFrontYaw(Math.PI / 2));
  const metal = mergeGeometries([
    lathe([[0, 0.1], [0.38, 0.0], [0.47, 0.04], [CAN.r, CAN.bodyBottom]], 18),
    lathe([[CAN.r, CAN.bodyTop], [0.47, 2.42], [0.45, 2.53], [0.42, 2.52], [0, 2.53]], 18),
  ].map((g) => { g.deleteAttribute('uv'); return g; }));
  body.deleteAttribute('uv1');
  const label = body;
  metal.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(metal.attributes.position.count * 2), 2));
  return mergeGeometries([label.toNonIndexed(), metal.toNonIndexed()], true);
}

function fedoraGeometry() {
  const brim = lathe([[0.48, 0.08], [0.95, 0.1], [1.0, 0.16], [0.9, 0.13], [0.5, 0.13]], 18);
  const bp = brim.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i);
    bp.setY(i, bp.getY(i) + Math.max(0, Math.hypot(bp.getX(i), z) - 0.55) ** 2 * (z * z) * 0.8);
  }
  const crown = lathe([[0.52, 0.1], [0.53, 0.45], [0.47, 0.72], [0.3, 0.86], [0.1, 0.8], [0, 0.78]], 18);
  const band = new THREE.CylinderGeometry(0.54, 0.54, 0.14, 18, 1, true);
  band.translate(0, 0.22, 0);
  const g = merge([[brim, 0x2a2b31], [crown, 0x2a2b31], [band, 0x0b0b0f]]);
  g.rotateZ(-0.12);
  g.translate(0, CAN.h - 0.06, 0);
  return g;
}

function beanieGeometry() {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push([0.58 * Math.cos(a) + 0.001, 0.4 + 0.68 * Math.sin(a)]);
  }
  const dome = lathe(pts, 18);
  const cuff = lathe([[0.6, 0], [0.63, 0.06], [0.63, 0.36], [0.6, 0.42]], 18);
  const g = merge([[dome, 0xc41f2a], [cuff, 0xb01a25]]);
  g.translate(0, CAN.h - 0.5, 0);
  return g;
}

function shadesGeometry() {
  const parts = [];
  const box = (w, h, x, y, z) => { const b = new THREE.BoxGeometry(0.06, h, w); b.translate(x, y, z); return b; };
  parts.push([box(1.5, 0.09, CAN.r + 0.05, 0.12, 0), 0x050507]);
  for (const s of [1, -1]) {
    parts.push([box(0.6, 0.26, CAN.r + 0.06, -0.02, s * 0.36), 0x050507]);
    parts.push([box(0.12, 0.08, CAN.r + 0.1, 0.02, s * 0.5), 0xffffff]);
  }
  const g = merge(parts);
  g.translate(0, 1.85, 0);
  return g;
}

function starGlassesGeometry() {
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.17 : 0.36;
    i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  const parts = [];
  for (const s of [1, -1]) {
    const g = new THREE.ExtrudeGeometry(star, { depth: 0.06, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(CAN.r + 0.08, 0, s * 0.36);
    parts.push([g, 0xff2f9a]);
  }
  const g = merge(parts);
  g.translate(0, 1.8, 0);
  return g;
}

// Arm pointing up from the shoulder (origin) with a racing glove at the end.
function armGeometry(color) {
  const arm = new THREE.CapsuleGeometry(0.11, 0.62, 4, 10);
  arm.translate(0, 0.42, 0);
  const glove = new RoundedBoxGeometry(0.34, 0.3, 0.3, 2, 0.1);
  glove.translate(0, 0.86, 0);
  const strap = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12);
  strap.translate(0, 0.7, 0);
  return merge([[arm, color], [glove, 0x23252e], [strap, COLORS.lime]]);
}

// Seated legs: thighs forward along the bench, shins down, white sneakers.
function legsGeometry(color) {
  const parts = [];
  for (const s of [1, -1]) {
    const thigh = new THREE.CapsuleGeometry(0.12, 0.38, 4, 10);
    thigh.rotateZ(Math.PI / 2);
    thigh.translate(0.42, 0.14, s * 0.22);
    const shin = new THREE.CapsuleGeometry(0.11, 0.42, 4, 10);
    shin.translate(0.72, -0.18, s * 0.22);
    const shoe = new RoundedBoxGeometry(0.36, 0.16, 0.22, 2, 0.06);
    shoe.translate(0.8, -0.5, s * 0.22);
    parts.push([thigh, color], [shin, color], [shoe, 0xf4f6ff]);
  }
  return merge(parts);
}

function signTexture(text, bg, fg) {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f4f6ff';
    g.lineWidth = 16;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg;
    g.font = 'italic 900 110px Unbounded, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 6);
  });
}

function signGeometry() {
  const board = new THREE.BoxGeometry(0.06, 0.7, 1.4);
  board.translate(0.05, 1.25, 0);
  const stick = new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8);
  stick.translate(0, 0.55, 0);
  // the board face carries the texture; give the stick zero UVs
  const st = stick.toNonIndexed();
  st.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(st.attributes.position.count * 2), 2));
  const bd = board.toNonIndexed();
  return mergeGeometries([bd, st]);
}

// ---------- shader: shared cheering animation ----------
const ANIM = /* glsl */ `
  uniform float uTime;
  uniform float uHype;
  uniform vec3 uCarA;
  uniform vec3 uCarB;
  uniform float uSide;
  uniform float uArm;
  uniform float uSign;
  float fanSeed() { return fract(sin(float(gl_InstanceID) * 12.9898 + uSign * 3.1) * 43758.5453); }
  float fanHype() {
    vec3 p = vec3(instanceMatrix[3]);
    float d = min(length(p.xz - uCarA.xz), length(p.xz - uCarB.xz));
    return clamp(uHype + exp(-d / 24.0) * 1.2, 0.0, 1.0);
  }
`;
const MOVE = /* glsl */ `
  {
    float seed = fanSeed();
    float hype = fanHype();
    float keen = step(0.68, seed); // the superfans never sit still
    float cheer = clamp(max(hype, keen * 0.75), 0.0, 1.0);
    float rate = 5.0 + seed * 3.0 + cheer * 4.0;
    float hop = max(0.0, sin(uTime * rate + seed * 6.283)) * (0.06 + cheer * 0.55);
    if (uArm != 0.0) {
      float wave = sin(uTime * (8.0 + seed * 4.0) + seed * 9.0) * 0.4;
      float a = uSide * mix(2.45, 0.35 + wave, cheer);
      float c = cos(a), s = sin(a);
      transformed.yz = vec2(transformed.y * c - transformed.z * s, transformed.y * s + transformed.z * c);
    }
    if (uSign != 0.0) transformed.z += sin(uTime * 3.0 + seed * 6.0) * 0.25 * transformed.y;
    transformed.y += hop;
  }
`;

function animated(mat, uniforms, extra = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, {
      uSide: { value: extra.side ?? 0 },
      uArm: { value: extra.arm ? 1 : 0 },
      uSign: { value: extra.sign ? 1 : 0 },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ANIM)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + MOVE);
  };
  mat.customProgramCacheKey = () => `fan-${extra.side ?? 0}-${extra.arm ? 1 : 0}-${extra.sign ? 1 : 0}`;
  return mat;
}

// seats: [{ x, y, z, yaw, flavor }] with y = bench top, yaw = facing direction
export function createCrowd(scene, seats) {
  const uniforms = {
    uTime: { value: 0 },
    uHype: { value: 0 },
    uCarA: { value: new THREE.Vector3(1e4, 0, 1e4) },
    uCarB: { value: new THREE.Vector3(1e4, 0, 1e4) },
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(SCALE, SCALE, SCALE);
  const off = new THREE.Matrix4();

  const make = (geo, mat, list, offset, extra) => {
    const m = Array.isArray(mat) ? mat.map((x) => animated(x, uniforms, extra)) : animated(mat, uniforms, extra);
    const mesh = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
      m4.compose(new THREE.Vector3(f.x, f.y, f.z), q, sc);
      if (offset) m4.multiply(off.makeTranslation(offset.x, offset.y, offset.z));
      mesh.setMatrixAt(i, m4);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // vertex animation moves fans outside the static bounds
    mesh.userData.fan = true;
    mesh.userData.total = list.length;
    scene.add(mesh);
    return mesh;
  };

  for (const flavor of ['classic', 'ultra']) {
    const list = seats.filter((s) => s.flavor === flavor);
    if (!list.length) continue;
    const f = FLAVORS[flavor];
    const vc = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, emissive: 0x222633 });
    make(bodyGeometry(), [
      new THREE.MeshStandardMaterial({ map: tex(flavor), roughness: 0.35, metalness: 0.2, emissive: 0xffffff, emissiveMap: tex(flavor), emissiveIntensity: 0.45 }),
      new THREE.MeshStandardMaterial({ color: 0xd9dbe4, metalness: 1, roughness: 0.25 }),
    ], list);
    make(flavor === 'classic' ? fedoraGeometry() : beanieGeometry(), vc(), list);
    make(flavor === 'classic' ? shadesGeometry() : starGlassesGeometry(), vc(), list);
    make(legsGeometry(f.paint), vc(), list);
    for (const side of [1, -1]) {
      make(armGeometry(f.paint), vc(), list, new THREE.Vector3(0, 1.25, side * (CAN.r + 0.08)), { side, arm: true });
    }
    // every fifth fan holds up a sign
    const holders = list.filter((_, i) => i % 5 === 2);
    const signMat = new THREE.MeshStandardMaterial({
      map: signTexture(flavor === 'classic' ? 'GO BLUE!' : 'GO RED!', flavor === 'classic' ? '#1f3dff' : '#d0182c', '#ffffff'),
      roughness: 0.6,
    });
    make(signGeometry(), signMat, holders, new THREE.Vector3(-0.2, 2.6, 0), { sign: true });
  }

  // Lower presets seat fewer fans (instances keep their order, so every part
  // of a fan stays in step).
  const meshes = [];
  scene.traverse((o) => { if (o.isInstancedMesh && o.userData.fan) meshes.push(o); });
  return {
    uniforms,
    setDensity(f) {
      for (const m of meshes) m.count = Math.max(1, Math.floor(m.userData.total * f));
    },
    hype(amount) { uniforms.uHype.value = Math.min(1, uniforms.uHype.value + amount); },
    update(time, a, b) {
      uniforms.uTime.value = time;
      uniforms.uHype.value *= 0.985;
      if (a) uniforms.uCarA.value.copy(a);
      if (b) uniforms.uCarB.value.copy(b);
      else if (a) uniforms.uCarB.value.copy(a);
    },
  };
}
