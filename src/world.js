// The Night Hawk Stadium. Design language from the campaign shoots: a sunlit
// blue sports court (Classic) / berry court at sunset (Ultra) with white lane
// lines, lime accents, orange spheres, tennis balls and the cans themselves.
// Little animations everywhere: crowd of mini cans, waving flags, circling
// hawks, scrolling nitro pads, a stadium light sweep, a holo logo.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, CAN, tex, canGeometry, canMaterials, faceFrontYaw, radialTexture, wingShape, canvasTexture } from './brand.js';
import { createCrowd } from './crowd.js';
import { seg, DETAIL } from './detail.js';

export const ARENA = 220; // half-size in metres
import { TRACK, TRACK_W, trackDistance, trackPoint, PERIM } from './track.js';
export { TRACK, trackDistance };

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const THEMES = {
  classic: {
    court: 0x2456e0, courtDark: 0x1a43b8, track: 0x153a9c, surround: 0x0f2c7c,
    skyTop: 0x2f6cff, horizon: 0xcfe2ff, fog: 0xa9c6ff,
    sun: 0xfff1dc, sunI: 3.0, sunDir: [-0.45, 1, 0.55], hemiSky: 0xd9e6ff, hemiGround: 0x18306e, hemiI: 1.1,
  },
  ultra: {
    court: 0xc8283c, courtDark: 0xa31d30, track: 0x82122a, surround: 0x5c0c1c,
    skyTop: 0x5a2a86, horizon: 0xffb08a, fog: 0xe8948a,
    sun: 0xffc29a, sunI: 2.6, sunDir: [-0.8, 0.55, 0.35], hemiSky: 0xffd2c4, hemiGround: 0x4a0c1c, hemiI: 1.0,
  },
};

// ---------------------------------------------------------------------------
// Ground: court + running track + markings, painted in a shader injected into
// a standard material so it still receives the sun's shadows.
// ---------------------------------------------------------------------------
function groundMaterial(u) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec2 vXZ;
        uniform vec3 uCourt, uCourtDark, uTrack, uSurround, uLine, uLime;
        uniform vec2 uCar;
        uniform float uTime, uBoost;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float line(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
        float stadium(vec2 p, float L, float R) { return length(vec2(max(abs(p.x) - L, 0.0), p.y)) - R; }
        float hexEdge(vec2 p) {
          vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
          vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
          vec2 g = dot(a, a) < dot(b, b) ? a : b;
          g = abs(g);
          return 0.5 - max(dot(g, normalize(r)), g.x);
        }
      `)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          vec2 p = vXZ;
          float aa = fwidth(p.x) * 1.5;
          float d = stadium(p, ${TRACK.L.toFixed(1)}, ${TRACK.R.toFixed(1)});
          float W = ${(TRACK.lanes * TRACK.lane).toFixed(2)};
          vec3 col = uSurround;
          // surround: faint brand hex pattern
          col = mix(col, uSurround * 1.25, (1.0 - smoothstep(0.0, 0.04, hexEdge(p / 9.0))) * 0.35);
          // infield court with two-tone halves
          float inf = 1.0 - smoothstep(-aa, aa, d);
          vec3 court = mix(uCourt, uCourtDark, step(0.0, p.x) * 0.6);
          col = mix(col, court, inf);
          // running track
          float trk = smoothstep(-aa, aa, d) * (1.0 - smoothstep(W - aa, W + aa, d));
          col = mix(col, uTrack, trk);
          // lane lines + inner lime curb + outer white edge
          float laneD = d - floor(d / ${TRACK.lane.toFixed(1)} + 0.5) * ${TRACK.lane.toFixed(1)};
          float lanes = line(laneD, 0.07, aa) * step(0.2, d) * step(d, W - 0.2);
          col = mix(col, uLine, lanes * 0.92);
          col = mix(col, uLime, line(d + 0.35, 0.35, aa));
          col = mix(col, uLine, line(d - W, 0.18, aa));
          // checkered start / finish line across the bottom straight
          if (abs(p.x) < 1.2 && p.y > ${TRACK.R.toFixed(1)} && p.y < ${TRACK.R.toFixed(1)} + W) {
            float ch = mod(floor(p.x / 0.6) + floor(p.y / 0.6), 2.0);
            col = mix(vec3(0.05), vec3(0.96), ch);
          }
          // infield court markings
          float mk = 0.0;
          mk += line(length(p) - 13.0, 0.14, aa);
          mk += line(length(p) - 4.0, 0.1, aa);
          mk += line(p.x, 0.12, aa) * step(abs(p.y), 46.0);
          float bx = max(abs(p.x) - 78.0, abs(p.y) - 46.0);
          mk += line(bx, 0.14, aa);
          mk += line(length(vec2(abs(p.x) - 78.0, p.y)) - 20.0, 0.12, aa) * step(abs(p.x), 78.0);
          col = mix(col, uLine, clamp(mk, 0.0, 1.0) * inf * 0.9);
          // rubber granules
          col *= 0.93 + 0.1 * h21(floor(p * 18.0));
          // slow stadium light sweep
          float sweep = mod(uTime * 34.0, 1100.0) - 550.0;
          col *= 1.0 + 0.08 * exp(-pow((p.x * 0.8 + p.y * 0.6 - sweep) / 26.0, 2.0));
          // nitro: lines near the car glow lime while boosting
          float near = exp(-length(p - uCar) * 0.06);
          col = mix(col, uLime * 1.6, (lanes + line(d - W, 0.18, aa)) * uBoost * near);
          diffuseColor.rgb = col;
        }
      `);
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Canvas textures used by props
// ---------------------------------------------------------------------------
function tennisTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#c9e83a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(${200 + Math.random() * 55},255,${80 + Math.random() * 60},0.25)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = '#f6f8ee';
    g.lineWidth = 14;
    g.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.28;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  });
}

function chevronPadTexture() {
  const t = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#0b1a14';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#8dc63f';
    for (let y = -h; y < h * 2; y += 128) {
      g.beginPath();
      g.moveTo(w * 0.15, y + 60); g.lineTo(w * 0.5, y); g.lineTo(w * 0.85, y + 60);
      g.lineTo(w * 0.85, y + 100); g.lineTo(w * 0.5, y + 40); g.lineTo(w * 0.15, y + 100);
      g.closePath();
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textTexture(str, { w = 512, h = 512, font = '900 380px Unbounded, sans-serif', color = '#ffffff' } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = color;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(str, w / 2, h / 2 + h * 0.04);
  });
}

function cloudTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    for (let i = 0; i < 14; i++) {
      const x = w * (0.2 + Math.random() * 0.6), y = h * (0.45 + Math.random() * 0.2), r = 20 + Math.random() * 36;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  });
}

// Low-detail can for the crowd: cylinder with the label texture.
function crowdCanGeometry() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, CAN.h, 18, 1, false);
  g.translate(0, CAN.h / 2, 0);
  return g;
}

// ---------------------------------------------------------------------------
export function createWorld(scene, physics, R) {
  const rand = rng(11);
  let theme = THEMES.classic;
  const animated = []; // (time, dt) => void
  const obstacles = []; // { x, z, r } for spawn avoidance / radar

  // ---------- Sky, fog, light ----------
  scene.fog = new THREE.Fog(theme.fog, 140, 420);
  scene.background = new THREE.Color(theme.fog);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTop: { value: new THREE.Color(theme.skyTop) }, uHorizon: { value: new THREE.Color(theme.horizon) }, uSun: { value: V(...theme.sunDir).normalize() }, uSunCol: { value: new THREE.Color(theme.sun) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uTop, uHorizon, uSun, uSunCol; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uTop, pow(h, 0.55));
        float s = max(dot(d, uSun), 0.0);
        c += uSunCol * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 160 });
  scene.add(sun, sun.target);
  const sunOffset = V(...theme.sunDir).normalize().multiplyScalar(60);

  // Sculpted cumulus clouds (seen during the airplane drop): clusters of
  // soft spheres with flattened bottoms, lit by the sun like everything else.
  const cloudGeos = [0, 1, 2].map((v) => {
    const puffs = [];
    const n = 9 + v * 3;
    for (let i = 0; i < n; i++) {
      const r = 5 + rand() * 6;
      const g = new THREE.SphereGeometry(r, seg(20, 12), seg(13, 8));
      const a = rand() * Math.PI * 2, d = rand() * (16 + v * 6);
      g.translate(Math.cos(a) * d * 1.6, rand() * 6 + (r > 8 ? 3 : 0), Math.sin(a) * d * 0.8);
      puffs.push(g);
    }
    const g = mergeGeometries(puffs);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -1.5) p.setY(i, -1.5 + (p.getY(i) + 1.5) * 0.15);
    g.computeVertexNormals();
    return g;
  });
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.18 });
  const clouds = cloudGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, cloudMat, 14);
    m.userData.items = Array.from({ length: 14 }, () => {
      // two layers: a sea of clouds under the flight level and a few high
      // ones above it, so the plane flies between them with a clear view
      const high = rand() < 0.3;
      // the low layer rings the stadium so the drop zone stays clear
      const a = rand() * Math.PI * 2, r = high ? 30 + rand() * 300 : 230 + rand() * 160;
      return { x: Math.cos(a) * r, y: high ? 100 + rand() * 25 : 34 + rand() * 18, z: Math.sin(a) * r, s: 0.8 + rand() * 0.8, yaw: rand() * Math.PI, v: 1.5 + rand() * 2 };
    });
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  const cm4 = new THREE.Matrix4(), cq = new THREE.Quaternion(), cs = new THREE.Vector3();
  const placeClouds = (dt) => {
    for (const m of clouds) {
      m.userData.items.forEach((c, i) => {
        c.x += c.v * dt;
        if (c.x > 340) c.x = -340;
        cq.setFromAxisAngle(V(0, 1, 0), c.yaw);
        cm4.compose(V(c.x, c.y, c.z), cq, cs.set(c.s, c.s * 0.8, c.s));
        m.setMatrixAt(i, cm4);
      });
      m.instanceMatrix.needsUpdate = true;
    }
  };
  placeClouds(0);
  animated.push((t, dt) => placeClouds(dt));

  // ---------- Ground ----------
  const U = {
    uCourt: { value: new THREE.Color(theme.court) }, uCourtDark: { value: new THREE.Color(theme.courtDark) },
    uTrack: { value: new THREE.Color(theme.track) }, uSurround: { value: new THREE.Color(theme.surround) },
    uLine: { value: new THREE.Color(0xf4f6ff) }, uLime: { value: new THREE.Color(COLORS.lime) },
    uCar: { value: new THREE.Vector2() }, uTime: { value: 0 }, uBoost: { value: 0 },
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMaterial(U));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  physics.createCollider(R.ColliderDesc.cuboid(ARENA + 60, 0.5, ARENA + 60).setTranslation(0, -0.5, 0).setFriction(1));

  // painted decals: centre logo, HAWK RACING lettering, lane numbers
  const decal = (map, w, h, x, z, rot = 0, opacity = 0.92) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, transparent: true, opacity, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, 0.01, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  decal(tex('logo'), 18, 18 * (952 / 1400), 0, 0, -Math.PI / 2, 0.55);
  const word = canvasTexture(2048, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.font = 'italic 900 200px Unbounded, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('HAWK RACING', w / 2, h / 2 + 10);
  });
  decal(word, 56, 7, -40, -28, 0, 0.5);
  decal(word, 56, 7, 40, 28, Math.PI, 0.5);
  for (let i = 0; i < TRACK.lanes; i++) {
    decal(textTexture(String(i + 1), { font: '900 300px Unbounded, sans-serif' }), 2.4, 2.4, -3, TRACK.R + TRACK.lane * (i + 0.5), -Math.PI / 2, 0.85);
  }

  // ---------- Barrier: padded wall ----------
  const padMat = new THREE.MeshStandardMaterial({ color: theme.surround, roughness: 0.75 });
  const padTop = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.5 });
  for (const [x, z, rot] of [[0, ARENA, 0], [0, -ARENA, Math.PI], [ARENA, 0, Math.PI / 2], [-ARENA, 0, -Math.PI / 2]]) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new RoundedBoxGeometry(ARENA * 2, 2.4, 1.4, 4, 0.5), padMat);
    wall.position.y = 1.2;
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, ARENA * 2, 8, 24), padTop);
    cap.rotation.z = Math.PI / 2;
    cap.position.y = 2.45;
    wall.receiveShadow = wall.castShadow = true;
    g.add(wall, cap);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(g);
    const along = rot % Math.PI === 0;
    physics.createCollider(R.ColliderDesc.cuboid(along ? ARENA : 0.7, 2.4, along ? 0.7 : ARENA).setTranslation(x, 1.2, z).setRestitution(0.4));
  }

  // ---------- Grandstands with the mascot crowd ----------
  // Bottom straight (start line side) is the Blue stand, the far side Red.
  const W = TRACK.lanes * TRACK.lane;
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xe6e9f2, roughness: 0.75 });
  const seatMats = { classic: new THREE.MeshStandardMaterial({ color: 0x1f3dff, roughness: 0.45 }), ultra: new THREE.MeshStandardMaterial({ color: 0xd0182c, roughness: 0.45 }) };
  const railMat = new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.35, metalness: 0.3 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.5, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x23252e, roughness: 0.4, metalness: 0.6 });
  const fascia = canvasTexture(2048, 160, (g, w, h) => {
    g.fillStyle = '#0b0c14';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = 'italic 900 96px Unbounded, sans-serif';
    g.textBaseline = 'middle';
    for (let x = 40; x < w; x += 760) {
      g.fillText('HAWK RACING', x, h / 2 + 4);
      g.fillStyle = '#8dc63f';
      g.fillText('•', x + 690, h / 2);
      g.fillStyle = '#ffffff';
    }
  });
  const seats = [];
  const TIERS = 4, LEN = 150, DEPTH = 2.8, RISE = 1.0;
  for (const side of [1, -1]) {
    const home = side > 0 ? 'classic' : 'ultra';
    const away = side > 0 ? 'ultra' : 'classic';
    const z0 = side * (TRACK.R + W + 7);
    const stand = new THREE.Group();
    for (let tier = 0; tier < TIERS; tier++) {
      const z = z0 + side * tier * DEPTH;
      const step = new THREE.Mesh(new RoundedBoxGeometry(LEN, RISE * (tier + 1), DEPTH, 3, 0.12), stepMat);
      step.position.set(0, (RISE * (tier + 1)) / 2, z);
      const bench = new THREE.Mesh(new RoundedBoxGeometry(LEN - 2, 0.22, 0.9, 3, 0.08), seatMats[home]);
      bench.position.set(0, RISE * (tier + 1) + 0.11, z + side * 0.5);
      stand.add(step, bench);
      for (let x = -LEN / 2 + 3; x <= LEN / 2 - 3; x += 2.7) {
        if (rand() < 0.1) continue;
        seats.push({ x: x + (rand() - 0.5) * 0.6, y: RISE * (tier + 1) + 0.22, z: z + side * 0.5, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, flavor: rand() < 0.8 ? home : away });
      }
    }
    // lime railing along the front
    const railZ = z0 - side * (DEPTH / 2 + 0.2);
    const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, LEN, 6, 16), railMat);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.25, railZ);
    stand.add(rail);
    for (let x = -LEN / 2; x <= LEN / 2; x += 6) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.25, 12), railMat);
      post.position.set(x, 0.62, railZ);
      stand.add(post);
    }
    // curved roof canopy on posts, with the HAWK RACING fascia
    const back = z0 + side * TIERS * DEPTH;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, LEN + 4, 64, 1, true, 0, Math.PI * 0.42), roofMat);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = side > 0 ? Math.PI : 0;
    roof.position.set(0, RISE * TIERS + 2.4, back - side * 9);
    const fasciaMesh = new THREE.Mesh(new THREE.PlaneGeometry(LEN + 4, 1.4), new THREE.MeshBasicMaterial({ map: fascia }));
    fasciaMesh.position.set(0, RISE * TIERS + 7.6, z0 - side * (DEPTH / 2 - 1.6));
    fasciaMesh.rotation.y = side > 0 ? Math.PI : 0;
    stand.add(roof, fasciaMesh);
    for (let x = -LEN / 2; x <= LEN / 2; x += 25) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, RISE * TIERS + 9, 16), postMat);
      post.position.set(x, (RISE * TIERS + 9) / 2, back + side * 0.4);
      stand.add(post);
    }
    stand.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(stand);
    physics.createCollider(R.ColliderDesc.cuboid(LEN / 2, RISE * TIERS / 2 + 0.5, (TIERS * DEPTH) / 2).setTranslation(0, RISE * TIERS / 2, z0 + side * ((TIERS - 1) * DEPTH) / 2));
    physics.createCollider(R.ColliderDesc.cuboid(LEN / 2, 0.8, 0.1).setTranslation(0, 0.8, railZ));
    for (let x = -60; x <= 60; x += 20) obstacles.push({ x, z: z0 + side * 5, r: 10 });
  }
  const crowd = createCrowd(scene, seats);

  // ---------- Stadium screens with the campaign posters ----------
  const posters = ['locker', 'duo', 'splash', 'focus', 'court', 'inside', 'tasted', 'more', 'studio', 'twopack'];
  const loader = new THREE.TextureLoader();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x14151c, metalness: 0.6, roughness: 0.35 });
  const screens = [];
  const placeScreen = (x, z, yawToCentre, idx) => {
    const g = new THREE.Group();
    const H = 13, Wd = 13;
    const mat = new THREE.MeshBasicMaterial({ color: 0x888888, toneMapped: false });
    loader.load(`/brand/posters/${posters[idx % posters.length]}.webp`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      mat.map = t;
      mat.color.set(0xffffff);
      const a = t.image.width / t.image.height;
      screen.scale.set(H * a, H, 1);
      frame.scale.set(H * a + 1, H + 1, 1);
      mat.needsUpdate = true;
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    screen.scale.set(Wd, H, 1);
    screen.position.y = 9 + H / 2;
    const frame = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 0.6, 2, 0.1), frameMat);
    frame.scale.set(Wd + 1, H + 1, 1);
    frame.position.set(0, screen.position.y, -0.35);
    const legGeo = new THREE.CylinderGeometry(0.35, 0.45, 9.5, 24);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(s * 4, 4.75, -0.4);
      g.add(leg);
    }
    g.add(screen, frame);
    g.position.set(x, 0, z);
    g.rotation.y = yawToCentre;
    g.traverse((o) => { if (o.isMesh && o !== screen) o.castShadow = true; });
    scene.add(g);
    screens.push(screen);
    physics.createCollider(R.ColliderDesc.cuboid(5, 5, 0.8).setTranslation(x, 5, z));
    obstacles.push({ x, z, r: 7 });
  };
  let si = 0;
  for (const side of [1, -1]) {
    for (const x of [-50, 0, 50]) placeScreen(x, side * (TRACK.R + W + 22), side > 0 ? Math.PI : 0, si++);
  }
  for (const side of [1, -1]) {
    for (const a of [-0.6, 0, 0.6]) {
      const r = TRACK.R + W + 18;
      const x = side * (TRACK.L + Math.cos(a) * r), z = Math.sin(a) * r;
      placeScreen(x, z, Math.atan2(-x, -z), si++);
    }
  }

  // ---------- Light towers ----------
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 34, 24), frameMat);
    pole.position.y = 17;
    const head = new THREE.Mesh(new RoundedBoxGeometry(8, 4, 1, 3, 0.3), frameMat);
    head.position.set(0, 34, 0);
    const lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.9).multiplyScalar(3) }), 12);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) {
      m4.makeTranslation(-3 + (i % 6) * 1.2, 34.8 - Math.floor(i / 6) * 1.5, 0.52);
      lamps.setMatrixAt(i, m4);
    }
    g.add(pole, head, lamps);
    const px = x * (TRACK.L + TRACK.R + W + 18), pz = z * (TRACK.R + W + 24);
    g.position.set(px, 0, pz);
    g.lookAt(0, 20, 0);
    g.rotation.x = 0;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    physics.createCollider(R.ColliderDesc.cylinder(17, 0.9).setTranslation(px, 17, pz));
    obstacles.push({ x: px, z: pz, r: 4 });
  }

  // ---------- Feather flags (vertex-animated) ----------
  const flagTime = { value: 0 };
  const flagMat = new THREE.MeshStandardMaterial({ map: tex('logo'), color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
  const flagBg = new THREE.MeshStandardMaterial({ color: COLORS.lime, side: THREE.DoubleSide, roughness: 0.8 });
  const wave = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = flagTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float k = clamp(position.x / 2.6, 0.0, 1.0);
          transformed.z += sin(uTime * 4.0 + position.x * 1.6 + position.y * 0.4 + modelMatrix[3][0] * 0.1) * 0.35 * k;`);
    };
  };
  wave(flagMat);
  wave(flagBg);
  const flagGeo = new THREE.PlaneGeometry(2.6, 6.5, 16, 8);
  flagGeo.translate(1.3, 0, 0);
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 9.5, 12);
  for (let i = 0; i < 28; i++) {
    // alternate just outside the outer wall and just inside the inner kerb
    const outerSide = i % 2 === 0;
    const fp = trackPoint((i / 28) * PERIM + 9, outerSide ? W + 4.4 : -4.6);
    if (outerSide && Math.abs(fp.z) > TRACK.R && Math.abs(fp.x) < 80) continue; // grandstands there
    const x = fp.x, z = fp.z;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, frameMat);
    pole.position.y = 4.75;
    const bg = new THREE.Mesh(flagGeo, i % 2 ? flagBg : new THREE.MeshStandardMaterial({ color: 0x0e1f8a, side: THREE.DoubleSide, roughness: 0.8 }));
    if (i % 2 === 0) wave(bg.material);
    bg.position.set(0.1, 6, 0);
    const logo = new THREE.Mesh(flagGeo, flagMat);
    logo.scale.set(0.85, 0.6, 1);
    logo.position.set(0.25, 6, 0.01);
    g.add(pole, bg, logo);
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
  animated.push((t) => { flagTime.value = t; });

  // ---------- Hawk Plaza: the infield monument ----------
  // Everything here sits inside the inner barrier (or outside the outer one),
  // so none of it can ever be on the road. Colossal Classic + Ultra cans on a
  // turning plinth, a can pyramid under floating chrome wings, standing cans
  // along both sides, and big tennis balls / orange spheres in the bends.
  const towers = [];
  const clearOfTrack = (x, z, pad) => {
    const d = trackDistance(x, z);
    return d < -pad || d > W + pad;
  };
  const canGeo = canGeometry('medium');
  const canGeoFar = canGeometry('low'); // pyramid + outer scatter sit far from the road
  const canMats = { classic: canMaterials('classic'), ultra: canMaterials('ultra') };
  const contactMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.45)'), transparent: true, depthWrite: false });
  const up = V(0, 1, 0);
  const contactGeo = new THREE.PlaneGeometry(1, 1);
  const contact = (x, z, r) => {
    const m = new THREE.Mesh(contactGeo, contactMat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(r * 3.2, r * 3.2, 1);
    m.position.set(x, 0.03, z);
    scene.add(m);
  };
  const standingCan = (flavor, s, yaw, geo = canGeo) => {
    const m = new THREE.Mesh(geo, canMats[flavor]);
    m.scale.setScalar(s);
    m.rotation.y = faceFrontYaw(yaw);
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0x0b1035, roughness: 0.32, metalness: 0.65 });
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.lime).multiplyScalar(2.2) });
  const bandTex = canvasTexture(2048, 128, (g, w, h) => {
    g.fillStyle = '#060a2a';
    g.fillRect(0, 0, w, h);
    g.font = 'italic 900 78px Unbounded, sans-serif';
    g.textBaseline = 'middle';
    const items = [['NIGHT HAWK', '#ffffff'], ['•', '#8dc63f'], ['CLASSIC', '#3d6bff'], ['•', '#8dc63f'], ['ULTRA', '#ff3348'], ['•', '#8dc63f']];
    let x = 30;
    for (const [t, c] of items) { g.fillStyle = c; g.fillText(t, x, h / 2 + 4); x += g.measureText(t).width + 40; }
  });
  bandTex.wrapS = THREE.RepeatWrapping;
  bandTex.repeat.set(3, 1);

  // hero turntable: the two colossal cans
  const PLAZA_X = 50;
  const hero = new THREE.Group();
  hero.position.set(PLAZA_X, 0, 0);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(17, 18, 1.4, 128), plinthMat);
  plinth.position.y = 0.7;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(17.03, 18.03, 1.1, 128, 1, true), new THREE.MeshBasicMaterial({ map: bandTex }));
  band.position.y = 0.7;
  const led = new THREE.Mesh(new THREE.TorusGeometry(17, 0.16, 12, 256), ledMat);
  led.rotation.x = Math.PI / 2;
  led.position.y = 1.42;
  const turntable = new THREE.Group();
  turntable.position.y = 1.4;
  const heroGeo = canGeometry(DETAIL === 'low' ? 'medium' : 'high');
  const heroA = standingCan('classic', 6.6, 0, heroGeo);
  heroA.position.set(-6.2, 0, 0);
  const heroB = standingCan('ultra', 6.6, 0, heroGeo);
  heroB.position.set(6.2, 0, 0);
  turntable.add(heroA, heroB);
  // up-lights: soft additive cones washing the cans
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beamGeo = new THREE.CylinderGeometry(4.5, 0.6, 30, 32, 1, true);
  beamGeo.translate(0, 15, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.Mesh(beamGeo, beamMat);
    b.position.set(Math.cos(a) * 13, 1.4, Math.sin(a) * 13);
    b.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    hero.add(b);
  }
  plinth.castShadow = plinth.receiveShadow = true;
  hero.add(plinth, band, led, turntable);
  scene.add(hero);
  animated.push((t) => { turntable.rotation.y = t * 0.12; });

  // can pyramid (4-3-2-1, back to back) under floating chrome wings
  const PYR = { x: -50, s: 2.3 };
  {
    const all = [];
    for (const side of [1, -1]) {
      let i = 0;
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4 - row; k++) all.push({ row, k, side, flavor: (i++ + row) % 2 ? 'ultra' : 'classic' });
      }
    }
    for (const flavor of ['classic', 'ultra']) {
      const items = all.filter((e) => e.flavor === flavor);
      const inst = new THREE.InstancedMesh(canGeoFar, canMats[flavor], items.length);
      inst.castShadow = inst.receiveShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      items.forEach((e, i) => {
        const n = 4 - e.row;
        const zz = (e.k - (n - 1) / 2) * CAN.r * 2 * PYR.s * 1.04;
        q.setFromAxisAngle(up, faceFrontYaw(e.side > 0 ? Math.PI / 2 : -Math.PI / 2));
        m4.compose(V(PYR.x + e.side * CAN.r * PYR.s * 1.02, e.row * CAN.h * PYR.s, zz), q, V(PYR.s, PYR.s, PYR.s));
        inst.setMatrixAt(i, m4);
      });
      scene.add(inst);
    }
  }
  const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, 0.8, 96), plinthMat);
  plinth2.position.set(PYR.x, -0.2, 0);
  plinth2.receiveShadow = true;
  const led2 = led.clone();
  led2.scale.setScalar(13 / 17);
  led2.position.set(PYR.x, 0.22, 0);
  scene.add(plinth2, led2);
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, clearcoat: 1, envMapIntensity: 1.4 });
  const bigWingGeo = new THREE.ExtrudeGeometry(wingShape(), { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 48 });
  const wings = new THREE.Group();
  for (const sgn of [1, -1]) {
    const w = new THREE.Mesh(bigWingGeo, chrome);
    w.scale.set(5 * sgn, 5, 5);
    w.position.set(0.3 * sgn, -2.8, -0.45);
    w.castShadow = true;
    wings.add(w);
  }
  wings.position.set(PYR.x, 29, 0);
  scene.add(wings);
  animated.push((t) => { wings.rotation.y = t * 0.35; wings.position.y = 29 + Math.sin(t * 0.8) * 0.8; });

  // standing cans along both long sides of the infield, facing the road
  for (const side of [1, -1]) {
    [-76, -38, 0, 38, 76].forEach((x, i) => {
      const flavor = (i + (side > 0 ? 0 : 1)) % 2 ? 'ultra' : 'classic';
      const m = standingCan(flavor, 3.1, side > 0 ? 0 : Math.PI);
      m.position.set(x, 0, side * 44);
      scene.add(m);
      contact(x, side * 44, CAN.r * 3.1);
      towers.push({ x, z: side * 44, r: CAN.r * 3.1, s: 3.1 });
    });
  }

  // the bends: lying giant cans, big tennis balls, orange spheres
  const ballMat = new THREE.MeshPhysicalMaterial({ map: tennisTexture(), roughness: 0.9, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xf4ffb0) });
  const orange = new THREE.MeshPhysicalMaterial({ color: 0xff6a2a, roughness: 0.45, sheen: 1, sheenColor: new THREE.Color(0xffb27a), clearcoat: 0.3 });
  const sphereGeo = new THREE.SphereGeometry(1, 72, 48);
  for (const sx of [1, -1]) {
    const lying = new THREE.Mesh(canGeo, canMats[sx > 0 ? 'ultra' : 'classic']);
    lying.scale.setScalar(3.6);
    lying.rotation.set(Math.PI / 2, 0, sx * 0.5, 'YXZ');
    lying.position.set(sx * 122 - Math.sin(sx * 0.5) * CAN.h * 1.8, CAN.r * 3.6, -Math.cos(sx * 0.5) * CAN.h * 1.8);
    lying.castShadow = lying.receiveShadow = true;
    scene.add(lying);
    for (const [dx, dz, r, mat] of [[-8, 26, 3.2, ballMat], [16, -24, 2.6, ballMat], [-12, -28, 5, orange], [12, 22, 4, orange]]) {
      const m = new THREE.Mesh(sphereGeo, mat);
      m.scale.setScalar(r);
      m.position.set(sx * (114 + dx), r * 0.92, dz);
      m.rotation.set(rand() * 3, rand() * 3, 0);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }

  // outside the outer wall: a scatter of giant cans beyond the stands
  const outside = [];
  let guard = 0;
  while (outside.length < 16 && guard++ < 4000) {
    const x = (rand() * 2 - 1) * (ARENA - 16);
    const z = (rand() * 2 - 1) * (ARENA - 16);
    if (trackDistance(x, z) < W + 14) continue;
    if (Math.abs(z) < TRACK.R + W + 45 && Math.abs(x) < 95) continue; // stands + screens
    if ([...outside, ...obstacles].some((t) => Math.hypot(t.x - x, t.z - z) < (t.r ?? 4) + 14)) continue;
    const s = 3.2 + rand() * 2.4;
    outside.push({ x, z, s, r: s * CAN.r, flavor: rand() < 0.5 ? 'classic' : 'ultra' });
  }
  for (const flavor of ['classic', 'ultra']) {
    const list = outside.filter((t) => t.flavor === flavor);
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(canGeoFar, canMats[flavor], list.length);
    inst.castShadow = inst.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, faceFrontYaw(Math.atan2(-t.x, -t.z)) + (rand() - 0.5) * 0.6);
      m4.compose(V(t.x, 0, t.z), q, V(t.s, t.s, t.s));
      inst.setMatrixAt(i, m4);
      contact(t.x, t.z, t.r);
    });
    scene.add(inst);
  }
  towers.push(...outside);

  // ---------- Night Hawk can airship circling the stadium ----------
  const blimp = new THREE.Group();
  const hull = new THREE.Mesh(heroGeo, canMats.classic);
  hull.scale.setScalar(5.2);
  hull.rotation.z = -Math.PI / 2;
  hull.position.x = (-CAN.h * 5.2) / 2;
  const finMat = new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new RoundedBoxGeometry(3.2, 2.6, 0.18, 2, 0.08), finMat);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(-CAN.h * 5.2 * 0.42, Math.cos(a) * 3.2, Math.sin(a) * 3.2);
    fin.rotation.x = -a;
    blimp.add(fin);
  }
  const gondola = new THREE.Mesh(new RoundedBoxGeometry(3.6, 1.1, 1.4, 4, 0.4), plinthMat);
  gondola.position.y = -CAN.r * 5.2 - 0.4;
  blimp.add(hull, gondola);
  blimp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(blimp);
  animated.push((t) => {
    const a = t * 0.035;
    blimp.position.set(Math.cos(a) * 165, 58 + Math.sin(t * 0.3) * 1.5, Math.sin(a) * 120);
    blimp.rotation.y = -a - Math.PI / 2;
    blimp.rotation.z = Math.sin(t * 0.4) * 0.03;
  });

  // ---------- The racing course: everything drivable lives on the oval ----------
  // Features are placed by arc length s (metres from the start line) and lane
  // offset (metres from the inner edge), so they always sit on the road.
  // The road itself stays clear: lanes, lines and flat nitro pads only.
  const ramps = [];
  const rampMat = new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.55 });

  // nitro pads, alternating inner and outer lines through every corner
  const padTex = chevronPadTexture();
  padTex.repeat.set(1, 2);
  const padMatN = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -3 });
  const pads = [];
  for (const [s, lane] of [[30, W / 2], [150, 14.5], [250, 4.8], [485, 4.8], [560, 14.5], [650, 4.8], [800, W / 2]]) {
    const p = trackPoint(s, lane);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.4), padMatN);
    plane.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    const g = new THREE.Group();
    g.add(plane);
    g.position.set(p.x, 0.02, p.z);
    g.rotation.y = p.yaw;
    scene.add(g);
    pads.push({ x: p.x, z: p.z, yaw: p.yaw });
  }
  animated.push((t, dt) => { padTex.offset.y -= dt * 1.4; });

  // ---------- Course barriers: nobody leaves the road ----------
  // Visual: swept profiles along the oval. Physics: a chain of tall boxes
  // (taller than any jump) on both edges.
  const SAMPLES = seg(380, 240);
  const sweep = (profile, laneBase, { uScale = 8, closed = true } = {}) => {
    const n = profile.length;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const s = (i / SAMPLES) * PERIM;
      for (let j = 0; j < n; j++) {
        const [lat, y] = profile[j];
        const p = trackPoint(s, laneBase + lat);
        pos.push(p.x, y, p.z);
        uv.push(s / uScale, j / (n - 1));
      }
    }
    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + n, c = b + 1, d = a + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // inner: low lime/white kerb wall just inside the curb
  const kerbTex = canvasTexture(256, 32, (g, w, h) => {
    g.fillStyle = '#8dc63f'; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = '#f4f6ff'; g.fillRect(w / 2, 0, w / 2, h);
  });
  kerbTex.wrapS = THREE.RepeatWrapping;
  // rounded profiles: a half-pipe kerb and a padded wall with a soft roll top
  const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const innerProfile = [[0.8, 0], ...arc(0.4, 0.42, 0.4, 0, Math.PI, seg(12, 6)), [0, 0]];
  const inner = new THREE.Mesh(sweep(innerProfile, -1.5, { uScale: 4 }), new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.55 }));
  // outer: padded wall with Night Hawk banner boards facing the road
  const banner = canvasTexture(2048, 128, (g, w, h) => {
    g.fillStyle = '#0b1452'; g.fillRect(0, 0, w, h);
    const logo = tex('logo').image;
    const cells = [
      () => { g.drawImage(logo, 0, 0, logo.width, logo.height, 40, 10, 160, 108); },
      () => { g.fillStyle = '#ffffff'; g.font = 'italic 900 64px Unbounded, sans-serif'; g.fillText('HAWK RACING', 0, 86); },
      () => { g.fillStyle = '#8dc63f'; g.font = '400 84px "Bebas Neue", sans-serif'; g.fillText('NIGHT HAWK ENERGY', 0, 92); },
      () => { g.fillStyle = '#3a64ff'; g.fillRect(0, 26, 22, 76); g.fillStyle = '#ff3348'; g.fillRect(30, 26, 22, 76); g.fillStyle = '#ffffff'; g.font = '400 70px "Bebas Neue", sans-serif'; g.fillText('CLASSIC · ULTRA', 70, 90); },
    ];
    const widths = [240, 560, 560, 520];
    let x = 20;
    cells.forEach((draw, i) => { g.save(); g.translate(x, 0); draw(); g.restore(); x += widths[i] + 40; });
    g.fillStyle = '#8dc63f'; g.fillRect(0, h - 8, w, 8);
  });
  banner.wrapS = THREE.RepeatWrapping;
  const outerProfile = [[0, 0], [0, 1.1], ...arc(0.4, 1.1, 0.4, Math.PI, 0, seg(14, 6)).slice(1, -1), [0.8, 1.1], [0.8, 0]];
  const outer = new THREE.Mesh(sweep(outerProfile, W + 0.5, { uScale: 30 }), new THREE.MeshStandardMaterial({ color: 0x0b1452, roughness: 0.6 }));
  const boards = new THREE.Mesh(sweep([[0, 0.14], [0, 1.08]], W + 0.49, { uScale: 46 }), new THREE.MeshStandardMaterial({ map: banner, roughness: 0.5, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
  const capStrip = new THREE.Mesh(sweep(arc(0.4, 1.1, 0.415, Math.PI * 0.72, Math.PI * 0.28, seg(6, 3)), W + 0.5, { uScale: 30 }), new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.4, side: THREE.DoubleSide }));
  for (const m of [inner, outer, boards, capStrip]) { m.castShadow = m !== boards; m.receiveShadow = true; scene.add(m); }

  const wallBoxes = (laneCentre, halfThick, halfHeight) => {
    const N = 220;
    for (let i = 0; i < N; i++) {
      const a = trackPoint((i / N) * PERIM, laneCentre);
      const b = trackPoint(((i + 1) / N) * PERIM, laneCentre);
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dz, dx);
      const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
      physics.createCollider(
        R.ColliderDesc.cuboid(len / 2 + 0.25, halfHeight, halfThick)
          .setTranslation((a.x + b.x) / 2, halfHeight - 0.2, (a.z + b.z) / 2)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.1)
          .setRestitution(0.25),
      );
    }
  };
  // colliders run far above the visible barrier so no jump can clear them
  wallBoxes(-1.1, 0.45, 6);
  wallBoxes(W + 0.9, 0.45, 6);

  // ---------- Start / finish gantry ----------
  {
    const g = new THREE.Group();
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x0b1452, roughness: 0.4, metalness: 0.4 });
    const a = trackPoint(0, -3), b = trackPoint(0, W + 3);
    for (const p of [a, b]) {
      const pylon = new THREE.Mesh(new RoundedBoxGeometry(1.2, 9, 1.6, 4, 0.2), pylonMat);
      pylon.position.set(p.x, 4.5, p.z);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.3, 1.64), rampMat);
      stripe.position.set(p.x, 7.2, p.z);
      g.add(pylon, stripe);
    }
    const span = Math.abs(b.z - a.z);
    const beam = new THREE.Mesh(new RoundedBoxGeometry(1.4, 2.4, span + 1.6, 4, 0.25), pylonMat);
    beam.position.set(0, 9.6, (a.z + b.z) / 2);
    g.add(beam);
    const title = canvasTexture(1024, 160, (c, w, h) => {
      c.fillStyle = '#0b1452'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff'; c.font = 'italic 900 92px Unbounded, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('HAWK RACING', w / 2, h / 2 + 4);
      c.fillStyle = '#8dc63f'; c.fillRect(0, h - 10, w, 10);
    });
    for (const sgn of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(span - 2, 2.1), new THREE.MeshBasicMaterial({ map: title }));
      face.position.set(sgn * 0.72, 9.6, (a.z + b.z) / 2);
      face.rotation.y = sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(face);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  // ---------- Tyre walls behind the outer barrier in both bends ----------
  // Stacks of three racing tyres in navy / lime / white; one instanced mesh
  // per bend so each can be culled on its own.
  {
    const tyreGeo = new THREE.TorusGeometry(0.42, 0.17, seg(12, 8), seg(28, 16));
    tyreGeo.rotateX(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    const cols = [new THREE.Color(0x0b1452), new THREE.Color(COLORS.lime), new THREE.Color(0xf4f6ff)];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1);
    for (const [s0, s1] of [[TRACK.L + 6, TRACK.L + Math.PI * (TRACK.R + W / 2) - 6], [3 * TRACK.L + Math.PI * (TRACK.R + W / 2) + 6, 3 * TRACK.L + 2 * Math.PI * (TRACK.R + W / 2) - 6]]) {
      const stacks = Math.floor((s1 - s0) / 7);
      const mesh = new THREE.InstancedMesh(tyreGeo, tyreMat, stacks * 3);
      let k = 0;
      for (let i = 0; i < stacks; i++) {
        const p = trackPoint(s0 + i * 7 + 3.5, W + 2.35);
        for (let h = 0; h < 3; h++) {
          q.setFromAxisAngle(up, rand() * Math.PI);
          m4.compose(V(p.x + (rand() - 0.5) * 0.08, 0.17 + h * 0.33, p.z + (rand() - 0.5) * 0.08), q, one);
          mesh.setMatrixAt(k, m4);
          mesh.setColorAt(k++, cols[(i + h) % 3]);
        }
      }
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
  }

  // ---------- Inflatable arches over the bends ----------
  // Feet stand outside both barriers; the sign hangs well above car height.
  const archTex = canvasTexture(512, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f6ff' : '#8dc63f'; g.fillRect((i * w) / 8, 0, w / 8, h); }
  });
  archTex.wrapS = THREE.RepeatWrapping;
  archTex.repeat.set(6, 1);
  const archMat = new THREE.MeshStandardMaterial({ map: archTex, roughness: 0.55 });
  const archBanner = canvasTexture(1024, 160, (c, w, h) => {
    c.fillStyle = '#0b1452';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.font = 'italic 900 74px Unbounded, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('NIGHT HAWK', w / 2, h / 2 + 4);
    c.fillStyle = '#8dc63f';
    c.fillRect(0, h - 10, w, 10);
    c.fillRect(0, 0, w, 10);
  });
  const archBannerMat = new THREE.MeshBasicMaterial({ map: archBanner });
  const archR = W / 2 + 12.6;
  for (const s0 of [205, 612]) {
    const p = trackPoint(s0, W / 2);
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.TorusGeometry(archR, 1.15, 28, 128, Math.PI), archMat);
    tube.scale.y = 0.62;
    const sign = new THREE.Mesh(new RoundedBoxGeometry(15, 2.4, 0.5, 3, 0.2), plinthMat);
    sign.position.y = archR * 0.62 - 1.2;
    for (const sgn of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 2.1), archBannerMat);
      face.position.set(0, sign.position.y, sgn * 0.26);
      if (sgn < 0) face.rotation.y = Math.PI;
      g.add(face);
    }
    for (const sx of [1, -1]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 1.2, 48), plinthMat);
      foot.position.set(sx * archR, 0.6, 0);
      g.add(foot);
    }
    g.add(tube, sign);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw + Math.PI / 2;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  // ---------- Circling hawks (with ground shadows) ----------
  const hawkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.8, side: THREE.DoubleSide });
  const wingGeo = new THREE.ExtrudeGeometry(wingShape(), { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 24 });
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.scale(1.4, 1, 1.4);
  const hawkShadowMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.35)'), transparent: true, depthWrite: false });
  const hawks = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 8, 16), hawkMat);
    body.rotation.z = Math.PI / 2;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 12), hawkMat);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -0.9;
    const wl = new THREE.Group(), wr = new THREE.Group();
    const a = new THREE.Mesh(wingGeo, hawkMat);
    a.rotation.y = -Math.PI / 2;
    const b = a.clone();
    b.scale.z = -1;
    wl.add(a); wr.add(b);
    wl.position.z = 0.15; wr.position.z = -0.15;
    g.add(body, tail, wl, wr);
    g.scale.setScalar(1.6);
    scene.add(g);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), hawkShadowMat);
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);
    hawks.push({ g, wl, wr, shadow, r: 30 + rand() * 90, h: 24 + rand() * 18, w: (0.08 + rand() * 0.06) * (rand() < 0.5 ? 1 : -1), ph: rand() * 6, cx: (rand() - 0.5) * 120, cz: (rand() - 0.5) * 60 });
  }
  animated.push((t) => {
    for (const h of hawks) {
      const a = h.ph + t * h.w;
      const x = h.cx + Math.cos(a) * h.r, z = h.cz + Math.sin(a) * h.r * 0.7;
      h.g.position.set(x, h.h + Math.sin(t * 0.7 + h.ph) * 2, z);
      h.g.rotation.set(0, -a - (h.w > 0 ? Math.PI / 2 : -Math.PI / 2), Math.sign(h.w) * 0.25);
      const flap = Math.sin(t * 6 + h.ph) * 0.5 * (0.5 + 0.5 * Math.sin(t * 0.5 + h.ph));
      h.wl.rotation.x = flap;
      h.wr.rotation.x = -flap;
      h.shadow.position.set(x + 4, 0.04, z - 3);
      h.shadow.rotation.z = -a;
    }
  });

  // ---------- Holographic logo over the start pad ----------
  const holo = new THREE.Group();
  const holoLogo = new THREE.Mesh(new THREE.PlaneGeometry(6, 6 * (952 / 1400)), new THREE.MeshBasicMaterial({ map: tex('logo'), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color(COLORS.lime).multiplyScalar(1.4) }));
  holoLogo.position.y = 7;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.lime).multiplyScalar(1.5), transparent: true, opacity: 0.6, depthWrite: false });
  const rings = [0, 1, 2].map((i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3.2 + i * 0.6, 0.05, 8, 96), ringMat);
    r.rotation.x = Math.PI / 2;
    holo.add(r);
    return r;
  });
  holo.add(holoLogo);
  holo.position.set(-14, 0, 0);
  scene.add(holo);
  animated.push((t) => {
    holoLogo.rotation.y = t * 0.8;
    rings.forEach((r, i) => {
      const k = ((t * 0.5 + i / 3) % 1);
      r.position.y = 1 + k * 9;
      r.scale.setScalar(1 - k * 0.4);
      r.material.opacity = 0.6 * (1 - k);
    });
  });

  // ---------- Theme switching ----------
  function setFlavor(key) {
    theme = THEMES[key] ?? THEMES.classic;
    U.uCourt.value.set(theme.court);
    U.uCourtDark.value.set(theme.courtDark);
    U.uTrack.value.set(theme.track);
    U.uSurround.value.set(theme.surround);
    padMat.color.set(theme.surround);
    scene.fog.color.set(theme.fog);
    scene.background.set(theme.fog);
    skyMat.uniforms.uTop.value.set(theme.skyTop);
    skyMat.uniforms.uHorizon.value.set(theme.horizon);
    skyMat.uniforms.uSun.value.set(...theme.sunDir).normalize();
    skyMat.uniforms.uSunCol.value.set(theme.sun);
    hemi.color.set(theme.hemiSky);
    hemi.groundColor.set(theme.hemiGround);
    hemi.intensity = theme.hemiI;
    sun.color.set(theme.sun);
    sun.intensity = theme.sunI;
    sunOffset.set(...theme.sunDir).normalize().multiplyScalar(60);
  }

  return {
    towers,
    ramps,
    obstacles,
    pads,
    sun,
    setFlavor,
    crowd,
    // which way the colossal cans' labels face right now (for cameras)
    heroYaw: () => turntable.rotation.y,
    cheer(amount = 1) { crowd.hype(amount); },
    // The nitro pad under a position, if any (cooldowns are per racer).
    checkPad(pos) {
      for (const p of pads) if (Math.hypot(pos.x - p.x, pos.z - p.z) < 3.2 && pos.y < 2.5) return p;
      return null;
    },
    // Per-view: centre the sun's shadow frustum, sky and ground glow on a car.
    focus(pos, boost = 0) {
      U.uCar.value.set(pos.x, pos.z);
      U.uBoost.value = boost;
      sun.target.position.copy(pos);
      sun.position.copy(pos).add(sunOffset);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      sky.position.copy(pos);
    },
    update(time, carPos, boost, dt = 0) {
      U.uTime.value = time;
      for (const fn of animated) fn(time, dt);
    },
  };
}
