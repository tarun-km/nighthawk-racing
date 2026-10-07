// Particle effects, all instanced:
//  - shards: matte tumbling debris with ground bounce and friction
//  - sparks: white 4-point stars that pop on impacts (camera-facing)
//  - puffs: soft round smoke / exhaust billboards that grow and fade
import * as THREE from 'three';
import { radialTexture } from './brand.js';

const N_SHARD = 500;
const N_SPARK = 160;
const N_PUFF = 260;

function starGeometry() {
  const s = new THREE.Shape();
  const pts = 8;
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.16 : 0.5;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

// Camera-facing quads are built in the vertex shader, so one set of instances
// faces whichever camera is drawing (both split-screen views). Quads right in
// front of the lens shrink away instead of filling the screen.
function billboard(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */ `
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 corner = (instanceMatrix * vec4(transformed, 0.0)).xy;
      mvPosition.xy += corner * smoothstep(1.5, 6.0, -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  return mat;
}

// Solid debris: same near-lens shrink, applied around each piece's centre.
function nearFade(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */ `
      vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed * smoothstep(1.2, 4.5, -centre.z), 1.0);
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  return mat;
}

class Pool {
  constructor(scene, geo, mat, n) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const c = new THREE.Color(0);
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, c);
    this.p = Array.from({ length: n }, () => ({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1, color: new THREE.Color() }));
    this.n = n;
    this.cursor = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
  }

  next(color) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const p = this.p[i];
    p.color.set(color);
    this.mesh.setColorAt(i, p.color);
    this.dirtyColor = true;
    return p;
  }
}

export class Particles {
  constructor(scene) {
    this.shards = new Pool(scene, new THREE.IcosahedronGeometry(0.11, 0), nearFade(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 })), N_SHARD);
    this.sparks = new Pool(scene, starGeometry(), billboard(new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), N_SPARK);
    this.puffs = new Pool(scene, new THREE.PlaneGeometry(1, 1), billboard(new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), N_PUFF);
    this.density = 1; // quality preset scale for burst sizes
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  // Impact: debris in the given colour plus a pop of white stars.
  burst(pos, color, n = 24, power = 9) {
    n = Math.max(4, Math.round(n * this.density));
    for (let i = 0; i < n; i++) {
      const p = this.shards.next(color);
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() * 0.8 + 0.5, Math.random() - 0.5).normalize().multiplyScalar(power * (0.35 + Math.random() * 0.65));
      p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18);
      p.life = p.max = 0.9 + Math.random() * 0.7;
      p.size = 0.5 + Math.random() * 0.8;
    }
    const stars = Math.min(8, 2 + Math.floor(n / 8));
    for (let i = 0; i < stars; i++) {
      const p = this.sparks.next(i % 3 === 0 ? color : 0xffffff);
      p.pos.copy(pos).add(this._s.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(1.6));
      p.vel.set(Math.random() - 0.5, Math.random() * 0.6 + 0.3, Math.random() - 0.5).multiplyScalar(power * 0.5);
      p.life = p.max = 0.32 + Math.random() * 0.2;
      p.size = 0.35 + Math.random() * 0.5;
      p.rot.z = Math.random() * Math.PI;
    }
    this.shards.mesh.instanceColor.needsUpdate = true;
    this.sparks.mesh.instanceColor.needsUpdate = true;
  }

  // A single small spark (drift mini-turbo, scraping).
  spark(pos, color) {
    const p = this.sparks.next(color);
    p.pos.copy(pos);
    p.vel.set((Math.random() - 0.5) * 5, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 5);
    p.life = p.max = 0.16 + Math.random() * 0.12;
    p.size = 0.16 + Math.random() * 0.16;
    p.rot.z = Math.random() * Math.PI;
    this.sparks.mesh.instanceColor.needsUpdate = true;
  }

  // Soft smoke / exhaust puff.
  puff(pos, color, spread = 1, size = 1) {
    const p = this.puffs.next(color);
    p.pos.copy(pos);
    p.vel.set((Math.random() - 0.5) * spread, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * spread);
    p.life = p.max = 0.55 + Math.random() * 0.35;
    p.size = (0.7 + Math.random() * 0.5) * size;
    p.rot.z = Math.random() * Math.PI * 2;
    this.puffs.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const m = this._m;
    const q = this._q;
    const s = this._s;

    // shards
    const sh = this.shards;
    for (let i = 0; i < sh.n; i++) {
      const p = sh.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= 24 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.06) {
        p.pos.y = 0.06;
        p.vel.y *= -0.38;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
        p.spin.multiplyScalar(0.6);
      }
      p.rot.addScaledVector(p.spin, dt);
      const k = Math.min(1, (p.life / p.max) * 3); // shrink only at the very end
      q.setFromEuler(this._e.set(p.rot.x, p.rot.y, p.rot.z));
      m.compose(p.pos, q, s.setScalar(p.size * Math.max(k, 0)));
      sh.mesh.setMatrixAt(i, m);
    }
    sh.mesh.instanceMatrix.needsUpdate = true;

    // billboards (sparks + puffs): only position, roll and size live in the
    // instance matrix; the vertex shader turns them to face the camera
    const sp = this.sparks;
    for (let i = 0; i < sp.n; i++) {
      const p = sp.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 4);
      const t = 1 - p.life / p.max;
      const sc = p.size * Math.sin(Math.min(t, 1) * Math.PI) * 1.3;
      q.setFromAxisAngle(s.set(0, 0, 1), p.rot.z + t * 2);
      m.compose(p.pos, q, s.setScalar(Math.max(sc, 0)));
      sp.mesh.setMatrixAt(i, m);
    }
    sp.mesh.instanceMatrix.needsUpdate = true;

    const pf = this.puffs;
    for (let i = 0; i < pf.n; i++) {
      const p = pf.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 2.5);
      const t = 1 - Math.max(p.life, 0) / p.max;
      const sc = p.size * (0.6 + t * 1.8);
      q.setFromAxisAngle(s.set(0, 0, 1), p.rot.z + t);
      m.compose(p.pos, q, s.setScalar(sc));
      pf.mesh.setMatrixAt(i, m);
      // fade by darkening (additive blending)
      this._c.copy(p.color).multiplyScalar(Math.pow(1 - t, 1.5) * 0.5);
      pf.mesh.setColorAt(i, this._c);
    }
    pf.mesh.instanceMatrix.needsUpdate = true;
    pf.mesh.instanceColor.needsUpdate = true;
  }
}

// Final screen pass: chromatic aberration, boost speed-lines, vignette, grain.
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBoost: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uTilt: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uBoost;
    uniform float uTime;
    uniform float uAspect;
    uniform float uTilt;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      vec2 p = c * vec2(uAspect, 1.0);
      float r = length(p);
      vec2 off = c * (0.0006 + uBoost * 0.006) * r * 2.0;
      // tilt-shift: sharp band through the car, soft top and bottom (toy look)
      float blur = smoothstep(0.12, 0.5, abs(vUv.y - 0.55)) * uTilt * 0.0065;
      vec3 col;
      if (blur < 0.00005) {
        // racing view: no tilt-shift, just the (subtle) colour fringe
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else {
        col = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996;
          float rr = sqrt((float(i) + 0.5) / 12.0);
          vec2 o = vec2(cos(a), sin(a) * uAspect) * rr * blur;
          col.r += texture2D(tDiffuse, vUv + o + off).r;
          col.g += texture2D(tDiffuse, vUv + o).g;
          col.b += texture2D(tDiffuse, vUv + o - off).b;
        }
        col /= 12.0;
      }
      // radial speed lines while boosting
      float ang = atan(p.y, p.x);
      float lane = floor(ang * 70.0);
      float n = hash(vec2(lane, floor(uTime * 18.0 + hash(vec2(lane, 1.0)) * 10.0)));
      float streak = step(0.86, n) * smoothstep(0.32, 0.85, r);
      col += vec3(0.75, 0.85, 1.0) * streak * smoothstep(0.55, 0.95, r) * uBoost * 0.06;
      // vignette + grain
      col *= mix(1.0, smoothstep(1.1, 0.3, r), 0.55 + uBoost * 0.2);
      col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
