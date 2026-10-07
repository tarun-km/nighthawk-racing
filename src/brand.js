// Brand kit: palette, real label textures, high-poly can geometry and the
// procedural shapes / canvas textures used across the game.
import * as THREE from 'three';
import { seg } from './detail.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const COLORS = {
  navy: 0x050a3a,
  blue: 0x1f3dff,
  electric: 0x3d6bff,
  red: 0xe0222e,
  redDeep: 0x8c0d17,
  lime: 0x8dc63f,
  white: 0xf4f6ff,
  ink: 0x02030f,
};

// The two products double as the two car liveries / fuel choices.
export const FLAVORS = {
  classic: {
    key: 'classic',
    line: 'Classic',
    name: 'Tropical',
    caffeine: '50 mg',
    glow: 0x3d6bff,
    paint: 0x0d1a8c,
    accent: COLORS.lime,
    css: '#3d6bff',
    perk: 'Calm Focus: more grip, longer combo window',
    stats: { speed: 0.72, boost: 0.62, grip: 0.92 },
  },
  ultra: {
    key: 'ultra',
    line: 'Ultra',
    name: 'Berry Burst',
    caffeine: '75 mg',
    glow: 0xff3b2e,
    paint: 0x8c0d17,
    accent: COLORS.lime,
    css: '#ff3b2e',
    perk: 'High caffeine: stronger boost, hotter top speed',
    stats: { speed: 0.88, boost: 0.95, grip: 0.68 },
  },
};

// ---------- Texture loading ----------
const TEX = {};

export async function loadBrandTextures(manager) {
  const loader = new THREE.TextureLoader(manager);
  const list = {
    classic: '/brand/label-classic.jpg',
    ultra: '/brand/label-ultra.jpg',
    classicFront: '/brand/label-classic-front.jpg',
    ultraFront: '/brand/label-ultra-front.jpg',
    logo: '/brand/logo-white.webp',
  };
  await Promise.all(Object.entries(list).map(async ([k, url]) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    TEX[k] = t;
  }));
  return TEX;
}

export const tex = (k) => TEX[k];

// ---------- Night environment map ----------
// A tiny "studio" of emissive panels in brand colours, prefiltered with PMREM
// so every metal and clearcoat surface picks up blue / red / white reflections.
export function createNightEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x02030c);
  const panel = (color, intensity, w, h, pos, look = new THREE.Vector3()) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(look);
    env.add(m);
  };
  panel(0xffffff, 3.2, 14, 2, new THREE.Vector3(0, 9, 0));
  panel(COLORS.electric, 3.5, 3, 10, new THREE.Vector3(-10, 3, 2));
  panel(COLORS.red, 3.2, 3, 10, new THREE.Vector3(10, 3, -2));
  panel(COLORS.lime, 1.5, 8, 0.6, new THREE.Vector3(0, 1, 10));
  panel(0x9fb4ff, 1.2, 20, 4, new THREE.Vector3(0, 4, -12));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x050616 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  return rt.texture;
}

// ---------- High-poly can ----------
// Slim 250 ml can proportions (53 mm x 135 mm): radius 0.5, height 2.55 units.
export const CAN = { r: 0.5, h: 2.55, bodyBottom: 0.16, bodyTop: 2.24 };

function lathe(points, segs) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

// Level of detail: 'high' for close-ups (mascots, garage), 'medium' for the
// giant landmark cans, 'low' for the dozens of pickups and can-stack pins.
const CAN_LOD = { high: 160, medium: seg(80, 56), low: seg(32, 22) };
const canCache = {};

// Returns a merged geometry with two groups: 0 = printed label, 1 = aluminium.
export function canGeometry(lod = 'high') {
  if (canCache[lod]) return canCache[lod];
  const SEG = CAN_LOD[lod] ?? CAN_LOD.high;
  const detailed = lod !== 'low';
  const { r, bodyBottom, bodyTop } = CAN;
  const body = new THREE.CylinderGeometry(r, r, bodyTop - bodyBottom, SEG, 1, true);
  body.translate(0, (bodyTop + bodyBottom) / 2, 0);

  // Base: stacking ring with an inner pressure dome.
  const bottom = lathe([
    [0.0, 0.125], [0.1, 0.122], [0.2, 0.108], [0.28, 0.085], [0.335, 0.055], [0.37, 0.025],
    [0.388, 0.006], [0.405, 0.0], [0.425, 0.0], [0.442, 0.006], [0.462, 0.028], [0.48, 0.068],
    [0.493, 0.11], [r, bodyBottom],
  ].filter((_, i) => detailed || i % 2 === 0 || i === 13), SEG);
  // Shoulder neck-in, double-seam rim, countersunk lid with a raised panel.
  const top = lathe([
    [r, bodyTop], [0.4995, 2.27], [0.497, 2.3], [0.49, 2.34], [0.478, 2.38], [0.465, 2.42],
    [0.454, 2.46], [0.447, 2.495], [0.446, 2.515], [0.449, 2.53], [0.453, 2.543], [0.452, 2.553],
    [0.446, 2.558], [0.437, 2.556], [0.431, 2.548], [0.428, 2.534], [0.424, 2.522], [0.414, 2.516],
    [0.398, 2.514], [0.385, 2.517], [0.37, 2.522], [0.35, 2.523], [0.2, 2.524], [0.0, 2.526],
  ].filter((_, i) => detailed || i % 2 === 0 || i > 20), SEG);

  // Stay-on tab: rounded plate with a finger hole, rivet, and the score line.
  const tabShape = new THREE.Shape();
  tabShape.absarc(0, 0, 0.075, Math.PI * 0.5, Math.PI * 1.5, false);
  tabShape.lineTo(0.17, -0.06);
  tabShape.absarc(0.17, 0, 0.06, -Math.PI * 0.5, Math.PI * 0.5, false);
  tabShape.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0.155, 0, 0.04, 0.03, 0, Math.PI * 2, true);
  tabShape.holes.push(hole);
  const tab = new THREE.ExtrudeGeometry(tabShape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 3, curveSegments: 32 });
  tab.rotateX(-Math.PI / 2);
  tab.translate(-0.02, 2.532, 0);
  const rivet = new THREE.CylinderGeometry(0.028, 0.032, 0.02, 32);
  rivet.translate(0, 2.53, 0);
  const scorePts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    scorePts.push(new THREE.Vector3(-0.2 + Math.cos(a) * 0.13, 2.528, Math.sin(a) * 0.1 * (1 - 0.25 * Math.cos(a))));
  }
  const score = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(scorePts, true), 96, 0.005, 6, true);

  const parts = detailed ? [bottom, top, tab, rivet, score] : [bottom, top, tab];
  const metal = mergeGeometries(parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n.attributes.uv1) n.deleteAttribute('uv1');
    return n;
  }));
  metal.computeVertexNormals();
  const label = body.toNonIndexed();
  return (canCache[lod] = mergeGeometries([label, metal], true));
}

// Angle (radians around +Y) where the front panel of the label sits, so a can
// can be turned to show its logo to the camera.
export const LABEL_FRONT_U = 0.7;
export function faceFrontYaw(targetAngle = 0) {
  return targetAngle - LABEL_FRONT_U * Math.PI * 2;
}

// Condensation droplets as a tiling normal map (like the chilled-can shots).
let dropletMap = null;
function droplets() {
  if (dropletMap) return dropletMap;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, S, S);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + Math.pow(rnd(), 3) * 9;
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
      if (x + ox < -r || x + ox > S + r || y + oy < -r || y + oy > S + r) continue;
      // encode a small dome: normal tilts away from the centre
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        grd.addColorStop(t, `rgba(${128 + 90 * t},${128 + 90 * t},${255 - 60 * t},${k === 4 ? 0 : 0.9})`);
      }
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  dropletMap = new THREE.CanvasTexture(c);
  dropletMap.wrapS = dropletMap.wrapT = THREE.RepeatWrapping;
  dropletMap.repeat.set(5, 3);
  return dropletMap;
}

export function canMaterials(flavor, { wet = true } = {}) {
  const map = TEX[flavor];
  const label = new THREE.MeshPhysicalMaterial({
    map,
    metalness: 0.5,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    emissive: 0xffffff,
    emissiveMap: map,
    emissiveIntensity: 0.06,
  });
  if (wet) {
    label.clearcoatNormalMap = droplets();
    label.clearcoatNormalScale = new THREE.Vector2(0.8, 0.8);
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dbe4, metalness: 1, roughness: 0.2 });
  return [label, metal];
}

// ---------- Logo shapes ----------
// Single feathered wing traced from the Night Hawk mark. Mirror on X.
export function wingShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.35, 0.05, 1.1, 0.45, 1.6, 1.35);
  s.bezierCurveTo(1.52, 1.18, 1.38, 1.08, 1.28, 1.02);
  s.quadraticCurveTo(1.4, 0.92, 1.36, 0.8);
  s.quadraticCurveTo(1.2, 0.76, 1.02, 0.66);
  s.quadraticCurveTo(1.14, 0.56, 1.08, 0.46);
  s.quadraticCurveTo(0.9, 0.44, 0.74, 0.38);
  s.quadraticCurveTo(0.82, 0.28, 0.76, 0.2);
  s.quadraticCurveTo(0.56, 0.2, 0.38, 0.17);
  s.quadraticCurveTo(0.36, 0.1, 0.3, 0.06);
  s.closePath();
  return s;
}

export function boltShape() {
  const s = new THREE.Shape();
  s.moveTo(0.1, 1);
  s.lineTo(-0.45, -0.05);
  s.lineTo(-0.05, -0.05);
  s.lineTo(-0.2, -1);
  s.lineTo(0.45, 0.15);
  s.lineTo(0.05, 0.15);
  s.closePath();
  return s;
}

// ---------- Canvas textures ----------
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Soft radial blob used for contact shadows and glows.
export function radialTexture(inner = 'rgba(0,0,0,0.85)', outer = 'rgba(0,0,0,0)') {
  return canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

// Chevron strip for the arena barriers.
export function chevronTexture() {
  const t = canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#04061a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#8dc63f';
    for (let x = -h; x < w + h; x += 64) {
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + 26, 0); g.lineTo(x + 26 + h / 2, h / 2);
      g.lineTo(x + 26, h); g.lineTo(x, h); g.lineTo(x + h / 2, h / 2);
      g.closePath();
      g.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Lit-window facade for the skyline towers.
export function facadeTexture() {
  const t = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#03040f';
    g.fillRect(0, 0, w, h);
    const palette = ['#9fb4ff', '#3d6bff', '#ffffff', '#ff3b2e', '#8dc63f'];
    for (let y = 8; y < h; y += 14) {
      for (let x = 8; x < w; x += 12) {
        const r = Math.random();
        if (r < 0.62) continue;
        g.globalAlpha = 0.25 + Math.random() * 0.75;
        g.fillStyle = palette[r < 0.9 ? 0 : Math.floor(Math.random() * palette.length)];
        g.fillRect(x, y, 7, 8);
      }
    }
    g.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
