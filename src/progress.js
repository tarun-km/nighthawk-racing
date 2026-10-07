// Pilot progression, stored on this device: XP and levels, paint jobs that
// unlock with levels, and the Hawk Cup (a three-round Grand Prix series).
const KEY = 'nh-profile';

// Paint filters start from greyscale + sepia so each one lands on the same
// colour on both cars (the stock liveries are blue and red).
export const PAINTS = [
  { id: 'stock', name: 'Stock', level: 1, filter: null },
  { id: 'stealth', name: 'Stealth', level: 2, filter: 'grayscale(1) brightness(0.42) contrast(1.5)', swatch: '#23252f' },
  { id: 'toxic', name: 'Toxic', level: 3, filter: 'grayscale(1) sepia(1) hue-rotate(48deg) saturate(3.2) brightness(1.08)', swatch: '#8dc63f' },
  { id: 'gold', name: 'Gold Rush', level: 5, filter: 'grayscale(1) sepia(1) saturate(2.6) brightness(1.15)', swatch: '#e2b23c' },
  { id: 'frost', name: 'Frost', level: 7, filter: 'grayscale(1) brightness(1.65) contrast(0.85)', swatch: '#e6ecff' },
  { id: 'sunset', name: 'Sunset', level: 9, filter: 'grayscale(1) sepia(1) hue-rotate(-20deg) saturate(4) brightness(1.05)', swatch: '#ff7438' },
  { id: 'royal', name: 'Royal', level: 12, filter: 'grayscale(1) sepia(1) hue-rotate(225deg) saturate(2.8)', swatch: '#7a4dff' },
];

// XP needed to go from `level` to the next one.
export const need = (level) => 300 + 150 * (level - 1);
export function levelOf(xp) {
  let level = 1;
  let into = Math.max(0, Math.floor(xp));
  while (into >= need(level)) { into -= need(level); level++; }
  return { level, into, next: need(level) };
}

function read() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY)) ?? {};
    return { xp: p.xp ?? 0, paint: { classic: 'stock', ultra: 'stock', ...(p.paint ?? {}) } };
  } catch {
    return { xp: 0, paint: { classic: 'stock', ultra: 'stock' } };
  }
}
function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

export const profile = () => read();
export const paintById = (id) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];
export const isUnlocked = (paint, xp = read().xp) => levelOf(xp).level >= paint.level;

export function setPaint(flavor, id) {
  const p = read();
  p.paint[flavor] = id;
  write(p);
}

// Adds XP and reports what changed (for the results screen).
export function addXP(gained) {
  const p = read();
  const before = levelOf(p.xp);
  p.xp += Math.max(0, Math.round(gained));
  write(p);
  const after = levelOf(p.xp);
  const unlocked = PAINTS.filter((x) => x.level > before.level && x.level <= after.level);
  return { gained: Math.round(gained), before, after, unlocked };
}

// ---- XP for each mode
const DIFF_XP = { rookie: 0.8, pro: 1, legend: 1.5 };
export function gpXP({ place, difficulty, overtakes = 0, hits = 0, perfect = false }) {
  const base = [300, 200, 140, 90][place - 1] ?? 60;
  return base * (DIFF_XP[difficulty] ?? 1) + overtakes * 15 + hits * 25 + (perfect ? 40 : 0);
}
export const soloXP = ({ score, gates = 0 }) => Math.min(650, score / 40) + gates * 10;
export const duelXP = ({ won }) => (won ? 160 : 110);

// ---- Hawk Cup: three rounds, points for every finish
export const CUP_POINTS = [10, 6, 3, 1];
export const CUP_ROUNDS = [
  { name: 'Daylight', theme: 'classic' },
  { name: 'Sunset', theme: 'ultra' },
  { name: 'Final', theme: 'classic' },
];
export function newCup() {
  return { round: 1, points: {}, roundDone: false, done: false };
}
