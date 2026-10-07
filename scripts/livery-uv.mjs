// Exports the livery atlas layout of both car shells as JSON, for
// scripts/livery_templates.py which renders the Canva templates.
//   node scripts/livery-uv.mjs <out.json>
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { VEHICLES, LIVERY, REGION_IDS, buildShell } from '../src/vehicles/shells.js';

const out = { size: LIVERY.size, regions: LIVERY.regions, cars: {} };
// each view is shaded as if lit from the viewer, so every panel reads clearly
const VIEW = {
  top: [0, 1, 0], front: [1, 0, 0], rear: [-1, 0, 0], right: [0, 0, 1], left: [0, 0, -1], under: [0, -1, 0],
};
const tilt = new THREE.Vector3(0.25, 0.35, 0.2);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();

for (const [key, spec] of Object.entries(VEHICLES)) {
  const t0 = performance.now();
  const geo = buildShell(spec);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const tris = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const px = [];
    for (let k = 0; k < 3; k++) px.push(+(uv.getX(i + k) * LIVERY.size).toFixed(1), +((1 - uv.getY(i + k)) * LIVERY.size).toFixed(1));
    const region = geo.userData.regions[i / 3];
    const light = new THREE.Vector3(...VIEW[REGION_IDS[region]]).add(tilt).normalize();
    tris.push([region, ...px, +Math.max(0, n.dot(light)).toFixed(2)]);
  }
  out.cars[key] = { name: spec.name, frame: geo.userData.frame, tris };
  console.log(key, spec.name, 'triangles:', pos.count / 3, 'built in', Math.round(performance.now() - t0), 'ms');
}
out.regionIds = REGION_IDS;
writeFileSync(process.argv[2] ?? 'livery-uv.json', JSON.stringify(out));
