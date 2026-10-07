// Hawk Racing: bootstraps renderer + physics, plays the intro, and runs the
// three modes:
//   GRAND PRIX   you vs three CPU rivals, three laps, Hawk Box power-ups
//   SCORE ATTACK 75 seconds of cans, bolts, gates, drifts and combos
//   DUEL         Blue (Classic Cruiser) vs Red (Ultra Buggy), split screen
// plus an in-engine trailer cut from a live race.
import './style.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import gsap from 'gsap';
import { createWorld, TRACK } from './world.js';
import { Car } from './car.js';
import { Pickups } from './pickups.js';
import { Items, POWERS, POWER_INFO } from './items.js';
import { Driver, DIFFICULTY } from './ai.js';
import { AirDrop } from './airdrop.js';
import { Particles } from './fx.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { View } from './views.js';
import { Trailer, TRAILER_LENGTH } from './trailer.js';
import { RaceTracker, trackPoint, trackParam, trackDistance, PERIM, LAPS } from './track.js';
import { COLORS, FLAVORS, loadBrandTextures, createNightEnvironment } from './brand.js';
import { settings, setSetting } from './settings.js';
import { PRESETS, AutoQuality, FrameStats } from './quality.js';

const RUN_TIME = 75;
const STEP = 1 / 120; // physics substep: stable contacts, smooth handling
const MAX_MULT = 5;
const HAWK_TIME = 6;
const GATE_TIME = 4;
const BOARD_KEY = 'nh-board';
const DUEL_KEY = 'nh-duel';
const CAREER_KEY = 'nh-career';
const BOARD_SIZE = 8;
const MODES = ['gp', 'solo', 'duel'];
const W_TRACK = TRACK.lanes * TRACK.lane;
const RANKS = [[0, 'Night Owl'], [5000, 'Street Runner'], [12000, 'Neon Racer'], [24000, 'Night Raptor'], [40000, 'Night Hawk']];
const SIDE = { classic: { label: 'BLUE', p: 'P1' }, ultra: { label: 'RED', p: 'P2' } };
// CPU rivals: two recoloured cars, plus whichever stock car the player isn't driving
const RIVALS = {
  midnight: { name: 'MIDNIGHT', flavor: 'classic', css: '#aab3d6', variant: { filter: 'saturate(0.12) brightness(0.42) contrast(1.4)', glow: 0xc8d0ff } },
  volt: { name: 'VOLT', flavor: 'ultra', css: '#b8f03c', variant: { filter: 'hue-rotate(105deg) saturate(1.3) brightness(1.08)', glow: COLORS.lime } },
};
const STOCK_NAME = { classic: 'BLUE HAWK', ultra: 'RED HAWK' };

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fmt = (t) => {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
const ordinal = (n) => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');

// =====================================================================
// 1. Mosaic loader
// =====================================================================
const COLS = 16;
const ROWS = 9;
const tilesEl = $('#tiles');
tilesEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
tilesEl.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
const tiles = Array.from({ length: COLS * ROWS }, () => tilesEl.appendChild(document.createElement('i')));
const order = tiles
  .map((el, i) => ({ el, k: Math.hypot((i % COLS) - COLS / 2 + 0.5, (Math.floor(i / COLS) - ROWS / 2 + 0.5) * 1.6) + Math.random() * 4 }))
  .sort((a, b) => a.k - b.k)
  .map((t) => t.el);
let cleared = 0;
let targetPct = 0;
const pct = { v: 0 };
const pctEl = $('#intro-pct');
const stageEl = $('.intro-label');
let stage = 'Starting';
let booted = false;
// Progress only moves forward; one tween at a time.
function progress(p, label) {
  if (label) { stage = label; stageEl.textContent = label; }
  if (p <= targetPct) return;
  targetPct = p;
  const target = Math.floor((p / 100) * order.length);
  while (cleared < target) gsap.to(order[cleared++], { scale: 0, rotate: 45, opacity: 0, duration: 0.45, ease: 'power3.in' });
  gsap.to(pct, { v: p, duration: 0.35, overwrite: true, onUpdate: () => { pctEl.textContent = Math.round(pct.v); } });
}
function bootError(err) {
  if (booted) { console.error(err); return; }
  console.error(err);
  const box = $('#boot-error');
  if (!box) { document.body.textContent = `Hawk Racing couldn't start (${stage}): ${err?.message ?? err}`; return; }
  $('#boot-stage').textContent = stage;
  $('#boot-msg').textContent = err?.message ?? String(err);
  box.classList.add('is-active');
}
addEventListener('error', (e) => bootError(e.error ?? e.message));
addEventListener('unhandledrejection', (e) => bootError(e.reason));
$('#boot-retry')?.addEventListener('click', () => location.reload());

gsap.fromTo('.keyart', { scale: 1.08 }, { scale: 1, duration: 6, ease: 'power2.out' });
progress(4, 'Starting physics engine');
if (!document.createElement('canvas').getContext('webgl2')) {
  bootError(new Error('This browser or device does not support WebGL 2, which Hawk Racing needs. Try a current Chrome, Edge, Firefox or Safari.'));
  throw new Error('WebGL2 unavailable');
}
const manager = new THREE.LoadingManager();
manager.onProgress = (_, loaded, total) => progress(20 + (loaded / total) * 40, 'Loading Night Hawk textures');
const loadImage = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
// Rapier's bundled wasm-bindgen init warns about its own call style; keep the console clean.
const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).includes('deprecated parameters for the initialization')) warn(...a); };
const [, , , trailerImages] = await Promise.all([
  RAPIER.init().then(() => { console.warn = warn; progress(18); }),
  document.fonts.ready.catch(() => {}),
  loadBrandTextures(manager).catch((e) => { throw new Error(`A brand texture failed to load (${e?.target?.src ?? e?.message ?? 'unknown'}).`); }),
  Promise.all(['/brand/logo-white.webp', '/brand/can-classic.webp', '/brand/can-ultra.webp'].map(loadImage)).then(([logo, classic, ultra]) => ({ logo, classic, ultra })),
]);
progress(62, 'Building the stadium');

// =====================================================================
// Renderer, world, cars
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('#scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = createNightEnvironment(renderer);
scene.environmentIntensity = 0.55;

const physics = new RAPIER.World({ x: 0, y: -18, z: 0 });
physics.timestep = STEP;
const world = createWorld(scene, physics, RAPIER);
progress(70, 'Building the cars');
const cars = { classic: new Car(scene, physics, RAPIER, 'classic'), ultra: new Car(scene, physics, RAPIER, 'ultra') };
progress(78, 'Building the rivals');
const rivalCars = Object.fromEntries(Object.entries(RIVALS).map(([k, r]) => [k, new Car(scene, physics, RAPIER, r.flavor, r.variant)]));
for (const c of Object.values(rivalCars)) c.setActive(false);
const allCars = [...Object.values(cars), ...Object.values(rivalCars)];
progress(86);
const pickups = new Pickups(scene, world.obstacles);
const airdrop = new AirDrop(scene);
const particles = new Particles(scene);
const items = new Items(scene, particles, allCars);
const input = new Input();
const audio = new Audio();
const trailer = new Trailer($('#titles'), trailerImages);
progress(92, 'Warming up shaders');

// ambient occlusion only sees solid geometry
const aoHidden = [];
scene.traverse((o) => {
  const m = o.material;
  const transparent = m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent);
  if (o.isSprite || o.isLine || o.isPoints || transparent) aoHidden.push(o);
});
const views = [0, 1].map(() => new View(renderer, scene, { dpr: DPR, aoHidden }));
// Compile every material and warm the real post-processing path once.
await (renderer.compileAsync ? renderer.compileAsync(scene, views[0].camera) : Promise.resolve(renderer.compile(scene, views[0].camera)));
views[0].setRect(0, 0, innerWidth, innerHeight);
views[0].render();
renderer.info.autoReset = false;

// ---------- quality presets + Auto ----------
const autoQ = new AutoQuality(settings.quality === 'auto' ? 'medium' : settings.quality);
const activePreset = () => PRESETS[settings.quality === 'auto' ? autoQ.level : settings.quality] ?? PRESETS.medium;
let qualityKey = '';
function applyQuality(split) {
  const pr = activePreset();
  for (const v of views) v.applyPreset(pr, split);
  const key = `${pr.name}-${split}`;
  if (key === qualityKey) return;
  qualityKey = key;
  if (world.sun.shadow.mapSize.x !== pr.shadow) {
    world.sun.shadow.mapSize.set(pr.shadow, pr.shadow);
    world.sun.shadow.map?.dispose();
    world.sun.shadow.map = null;
  }
  world.crowd.setDensity(pr.crowd * (split ? 0.85 : 1));
  particles.density = pr.particles;
  $('#diag-q').textContent = `${pr.name}${settings.quality === 'auto' ? ' (auto)' : ''}`;
}

// =====================================================================
// State
// =====================================================================
const savedMode = store.get('nh-mode', 'gp');
const game = {
  mode: MODES.includes(savedMode) ? savedMode : 'gp',
  state: 'intro', // intro | sound | menu | drop | landing | countdown | race | finish | results | paused | trailer
  time: RUN_TIME,
  clock: 0,
  players: [], // humans
  racers: [], // humans + CPU rivals
  winner: null,
};
let flavor = FLAVORS[store.get('nh-flavor', 'classic')] ? store.get('nh-flavor', 'classic') : 'classic';
let difficulty = DIFFICULTY[store.get('nh-diff', 'pro')] ? store.get('nh-diff', 'pro') : 'pro';

function makeRacer(idx, fl, name, car, extra = {}) {
  return {
    idx, flavor: fl, name, car, human: false, ctrl: null, driver: null, view: null, pane: null, css: FLAVORS[fl].css,
    nitro: 100, padBoost: 0, padCool: 0, hawk: 0, boosting: false, boostFx: 0, wasAir: false, maxAir: 0, shake: 0,
    score: 0, shownScore: 0, mult: 1, multIdle: 0, combo: 0, bestCombo: 0, comboTimer: 0, comboWindow: fl === 'classic' ? 3.2 : 2.6,
    style: 0, driftChain: 0, driftCharge: 0, draft: 0, topKmh: 0, landT: 0, landed: false, released: false,
    place: idx + 1, finished: false, finishTime: 0, outT: 0,
    item: null, rolling: 0, rollItem: null, shield: 0, firePrev: false,
    tracker: new RaceTracker(), wrongShown: false,
    stats: { cans: 0, bolts: 0, wings: 0, nitro: 0, gates: 0, drift: 0, hits: 0, items: 0, overtakes: 0, turbos: 0 },
    ...extra,
  };
}
function makePlayer(idx, fl, name) {
  return makeRacer(idx, fl, name, cars[fl], { human: true, ctrl: input.players[idx], view: views[idx], pane: panes[idx] });
}

// =====================================================================
// HUD panes: one per human player, built from a template
// =====================================================================
const panes = [0, 1].map((i) => {
  const el = $('#pane-tpl').content.firstElementChild.cloneNode(true);
  el.dataset.p = i;
  $('#panes').appendChild(el);
  const q = (s) => $(s, el);
  return {
    el,
    tag: q('.p-tag'), name: q('.p-name'), pos: q('.p-pos b'), posSup: q('.p-pos sup'),
    lap: q('.p-lap b'), lapTime: q('.p-lap .lap-time'), best: q('.p-lap .best'),
    score: q('.p-score b'), mult: q('.p-mult b'), combo: q('.p-combo'), drift: q('.p-drift'),
    kmh: q('.g-kmh'), speedArc: q('.g-speed'), nitroArc: q('.g-nitro'), needle: q('.g-needle'),
    msg: q('.p-msg'), hawk: q('.p-hawk'), styleBar: q('.p-style i'), draft: q('.p-draft'),
    item: q('.p-item'), itemUse: q('.p-item use'), itemName: q('.p-item-name'), itemKey: q('.p-item kbd'),
    arrow: q('.gate-arrow'), arrowSvg: q('.gate-arrow svg'), gateDist: q('.gate-dist'),
    lastItem: undefined,
  };
});
panes[0].itemKey.textContent = 'E';
panes[1].itemKey.textContent = 'Enter';
const ARC = 2 * Math.PI * 62 * 0.75;
const NITRO_ARC = 2 * Math.PI * 50 * 0.75;

// =====================================================================
// Menu: mode, fuel, difficulty, names
// =====================================================================
const nameInput = $('#pilot-name');
const p1Input = $('#p1-name');
const p2Input = $('#p2-name');
let pilot = store.get('nh-name', '');
if (!pilot) { pilot = `PILOT-${String(Math.floor(Math.random() * 900) + 100)}`; store.set('nh-name', pilot); }
nameInput.value = p1Input.value = pilot;
p2Input.value = store.get('nh-name2', `RIVAL-${String(Math.floor(Math.random() * 900) + 100)}`);
for (const el of [nameInput, p1Input, p2Input]) {
  el.addEventListener('input', () => {
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '');
    if (el === p2Input) store.set('nh-name2', el.value);
    else { store.set('nh-name', el.value); nameInput.value = p1Input.value = el.value; }
  });
}
$('#welcome-name').textContent = pilot.slice(0, 14);

const fuelsEl = $('#fuels');
for (const f of Object.values(FLAVORS)) {
  const b = document.createElement('button');
  b.className = 'fuel';
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.key = f.key;
  b.style.setProperty('--c', f.css);
  const bar = (k, v) => `<div class="bar"><span>${k}</span><u style="--v:${Math.round(v * 100)}%"></u></div>`;
  b.innerHTML = `
    <img src="/brand/can-${f.key}.webp" alt="" />
    <div class="fuel-body">
      <div class="line">${f.line} · ${f.key === 'classic' ? 'Cruiser' : 'Buggy'}</div>
      <div class="name">${f.name}</div>
      <div class="caf">${f.caffeine} caffeine</div>
      <div class="bars">${bar('Speed', f.stats.speed)}${bar('Boost', f.stats.boost)}${bar('Grip', f.stats.grip)}</div>
    </div>`;
  b.addEventListener('click', () => setFlavor(f.key, true));
  fuelsEl.appendChild(b);
}

function setFlavor(key, animate = false) {
  flavor = key;
  store.set('nh-flavor', key);
  $$('.fuel', fuelsEl).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === key)));
  $('#res-can').src = `/brand/can-${key}.webp`;
  applyTheme();
  if (game.state === 'menu') layoutGarage();
  if (animate) {
    audio.sfx('can');
    const c = cars[key];
    particles.burst(c.position.clone().setY(1.2), FLAVORS[key].glow, 40, 8);
    gsap.fromTo(c.group.scale, { x: 0.92, y: 1.12, z: 0.92 }, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
  }
}

function setMode(mode) {
  game.mode = mode;
  store.set('nh-mode', mode);
  input.mode = mode === 'duel' ? 'duel' : 'solo';
  for (const m of MODES) document.body.classList.toggle(`mode-${m}`, m === mode);
  $$('.mode').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  applyTheme();
  renderTally();
  renderCareer();
  if (game.state === 'menu') layoutGarage();
}
$$('.mode').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); audio.sfx('count'); }));

// Grand Prix difficulty + career (stored on this device)
function career() {
  const c = store.get(CAREER_KEY, null) ?? {};
  return { races: c.races ?? 0, podiums: c.podiums ?? 0, wins: { rookie: 0, pro: 0, legend: 0, ...(c.wins ?? {}) }, bestLap: c.bestLap ?? null };
}
const unlocked = (k) => k !== 'legend' || career().wins.pro > 0 || career().wins.legend > 0;
function setDifficulty(k) {
  if (!unlocked(k)) { toast('Win a Pro Grand Prix to unlock Legend.'); return; }
  difficulty = k;
  store.set('nh-diff', k);
  renderDiff();
}
function renderDiff() {
  $$('.diff').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.diff === difficulty));
    b.classList.toggle('is-locked', !unlocked(b.dataset.diff));
  });
}
$$('.diff').forEach((b) => b.addEventListener('click', () => { setDifficulty(b.dataset.diff); audio.sfx('count'); }));
function renderCareer() {
  const c = career();
  $('#car-wins').textContent = c.wins.rookie + c.wins.pro + c.wins.legend;
  $('#car-podiums').textContent = c.podiums;
  $('#car-races').textContent = c.races;
  $('#car-best').textContent = fmt(c.bestLap);
  renderDiff();
}

// The court colours follow the selected fuel; the duel uses Blue.
function applyTheme() {
  world.setFlavor(game.mode === 'duel' ? 'classic' : flavor);
  document.body.classList.toggle('flavor-ultra', game.mode !== 'duel' && flavor === 'ultra');
}

function renderTally() {
  const t = store.get(DUEL_KEY, { blue: 0, red: 0 });
  $('#tally-blue').textContent = t.blue;
  $('#tally-red').textContent = t.red;
}

if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('is-touch');
input.bindTouch($('#stick'), $('#stick-knob'), $('#btn-boost'), $('#btn-drift'), $('#btn-item'));

// =====================================================================
// Screens, leaderboard
// =====================================================================
const SCREENS = ['intro', 'welcome', 'sound', 'menu', 'hud', 'pause', 'results', 'duel-results', 'gp-results', 'drop', 'trailer'];
function show(...ids) {
  for (const id of SCREENS) $(`#${id}`).classList.toggle('is-active', ids.includes(id));
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function renderBoard(el, highlight) {
  const board = store.get(BOARD_KEY, []);
  el.innerHTML = board.length
    ? board.map((e) => `<li class="${e.id === highlight ? 'me' : ''}"><b>${escapeHtml(e.name)}</b><span>${e.score.toLocaleString()}</span></li>`).join('')
    : '<li class="empty">No runs yet. Be the first.</li>';
}
function submitScore(name, score) {
  const id = Date.now();
  const board = store.get(BOARD_KEY, []);
  board.push({ id, name, score });
  board.sort((a, b) => b.score - a.score);
  store.set(BOARD_KEY, board.slice(0, BOARD_SIZE));
  return id;
}

const popupsEl = $('#popups');
const bigEl = $('#big-text');
function popup(p, text, worldPos, color = 'white') {
  if (!p?.view) return;
  const s = p.view.toScreen(worldPos);
  if (!s.visible) return;
  const el = document.createElement('div');
  el.className = `popup ${color}`;
  el.textContent = text;
  popupsEl.appendChild(el);
  gsap.fromTo(el,
    { x: s.x, y: s.y, xPercent: -50, yPercent: -50, scale: 0.5, opacity: 1, rotate: -6 },
    { y: s.y - 80, scale: 1.1, rotate: 0, duration: 0.9, ease: 'back.out(2)', onComplete: () => el.remove() });
  gsap.to(el, { opacity: 0, delay: 0.55, duration: 0.35 });
}
function bigText(text, { hold = 0.5, color } = {}) {
  bigEl.textContent = text;
  bigEl.style.color = color ?? '';
  gsap.killTweensOf(bigEl);
  return gsap.timeline()
    .fromTo(bigEl, { opacity: 0, scale: 1.7, skewX: -20 }, { opacity: 1, scale: 1, skewX: -10, duration: 0.28, ease: 'back.out(2)' })
    .to(bigEl, { opacity: 0, scale: 0.85, duration: 0.25, delay: hold });
}
function paneMsg(p, text, color) {
  if (!p?.pane) return;
  const el = p.pane.msg;
  el.textContent = text;
  el.style.color = color ?? '';
  gsap.killTweensOf(el);
  gsap.timeline()
    .fromTo(el, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(2)' })
    .to(el, { opacity: 0, duration: 0.3, delay: 1.1 });
}

function updatePane(p, dt) {
  const ui = p.pane;
  const kmh = p.car.kmh;
  ui.kmh.textContent = Math.round(kmh);
  const sp = Math.min(1, kmh / 200);
  ui.speedArc.style.strokeDasharray = `${ARC * sp} ${ARC + 10}`;
  ui.nitroArc.style.strokeDasharray = `${NITRO_ARC * (p.nitro / 100)} ${NITRO_ARC + 10}`;
  ui.needle.style.transform = `rotate(${-135 + sp * 270}deg)`;
  ui.el.classList.toggle('is-boost', p.boosting);
  ui.hawk.classList.toggle('is-on', p.hawk > 0);
  const racing = game.state === 'race';
  ui.drift.classList.toggle('is-on', p.car.drifting && racing);
  ui.drift.classList.toggle('lvl-1', p.driftCharge > 0.7 && p.driftCharge <= 1.6);
  ui.drift.classList.toggle('lvl-2', p.driftCharge > 1.6);
  ui.draft.classList.toggle('is-on', p.draft > 0.5 && racing);
  if (game.mode === 'solo') {
    p.shownScore += (p.score - p.shownScore) * Math.min(1, dt * 10);
    ui.score.textContent = Math.round(p.shownScore).toLocaleString();
    ui.mult.textContent = `x${p.mult.toFixed(1)}`;
    ui.styleBar.style.width = `${p.style}%`;
    const g = pickups.gate;
    ui.arrow.classList.toggle('is-on', g.active && racing);
    if (g.active) {
      const f = camForward(p.view);
      const dx = g.root.position.x - p.car.position.x;
      const dz = g.root.position.z - p.car.position.z;
      ui.arrowSvg.style.transform = `rotate(${Math.atan2(dx * -f.y + dz * f.x, dx * f.x + dz * f.y)}rad)`;
      ui.gateDist.textContent = `${Math.round(Math.hypot(dx, dz))} m`;
    }
    return;
  }
  const tr = p.tracker;
  if (ui.pos.textContent !== String(p.place)) {
    ui.pos.textContent = p.place;
    ui.posSup.textContent = ordinal(p.place);
    gsap.fromTo(ui.pos.parentElement, { scale: 1.35 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
  }
  ui.lap.textContent = `${tr.lap}/${LAPS}`;
  ui.lapTime.textContent = fmt(tr.finished ? tr.lapTimes.at(-1) : Math.max(0, game.clock - (tr.lapStart - tr.raceStart)));
  ui.best.textContent = `Best ${fmt(tr.best)}`;
  const wrong = tr.wrongWay > 1 && !tr.finished && racing;
  if (wrong !== p.wrongShown) { p.wrongShown = wrong; ui.el.classList.toggle('is-wrong', wrong); }
  // power-up slot: a quick roulette, then the item
  const it = p.rolling > 0 ? POWERS[Math.floor(elapsed * 14) % POWERS.length] : p.item;
  if (it !== ui.lastItem) {
    if (p.rolling > 0) audio.sfx('tick');
    ui.lastItem = it;
    ui.itemUse.setAttribute('href', `#ic-${it ?? 'none'}`);
    ui.itemName.textContent = it ? POWER_INFO[it].name : 'Hawk Box';
    ui.item.style.setProperty('--ic', it ? POWER_INFO[it].color : 'rgba(244,246,255,.35)');
    if (it && !(p.rolling > 0)) gsap.fromTo(ui.item, { scale: 1.3 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' });
  }
  ui.item.classList.toggle('is-empty', !it);
  ui.item.classList.toggle('is-rolling', p.rolling > 0);
  ui.item.classList.toggle('is-ready', !!p.item && !(p.rolling > 0));
}

const _f2 = new THREE.Vector2();
function camForward(view) {
  return _f2.set(view.camLook.x - view.camPos.x, view.camLook.z - view.camPos.z).normalize();
}

// Track minimap: the oval and every racer (plus the gate + pickups in score attack).
const mini = $('#minimap');
const mctx = mini.getContext('2d');
const ovalPts = Array.from({ length: 120 }, (_, i) => trackPoint((i / 120) * PERIM, W_TRACK / 2));
function drawMinimap() {
  const Wd = mini.width, Hd = mini.height;
  const s = Math.min((Wd - 40) / ((TRACK.L + TRACK.R + W_TRACK) * 2), (Hd - 30) / ((TRACK.R + W_TRACK) * 2));
  const to = (x, z) => [Wd / 2 + x * s, Hd / 2 + z * s];
  mctx.clearRect(0, 0, Wd, Hd);
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';
  mctx.strokeStyle = 'rgba(244,246,255,.18)';
  mctx.lineWidth = W_TRACK * s + 6;
  mctx.beginPath();
  ovalPts.forEach((p, i) => { const [x, y] = to(p.x, p.z); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); });
  mctx.closePath();
  mctx.stroke();
  mctx.strokeStyle = 'rgba(244,246,255,.55)';
  mctx.lineWidth = 2;
  mctx.stroke();
  const [lx, ly] = to(0, TRACK.R);
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(lx - 2, ly, 4, W_TRACK * s);
  if (game.mode === 'solo') {
    for (const it of pickups.items) {
      if (!it.active || it.disabled) continue;
      const [x, y] = to(it.root.position.x, it.root.position.z);
      mctx.fillStyle = it.type === 'can' ? 'rgba(244,246,255,.55)' : it.type === 'bolt' ? '#8dc63f' : it.type === 'nitro' ? '#3d6bff' : '#ffffff';
      mctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    const g = pickups.gate;
    if (g.active) {
      const [x, y] = to(g.root.position.x, g.root.position.z);
      mctx.strokeStyle = '#8dc63f'; mctx.lineWidth = 3;
      mctx.beginPath(); mctx.arc(x, y, 7, 0, Math.PI * 2); mctx.stroke();
    }
  }
  // CPU first, humans on top
  for (const p of [...game.racers].sort((a, b) => a.human - b.human)) {
    const [x, y] = to(p.car.position.x, p.car.position.z);
    mctx.fillStyle = p.css;
    mctx.strokeStyle = p.human ? '#ffffff' : 'rgba(2,3,15,.8)';
    mctx.lineWidth = p.human ? 3 : 2;
    mctx.beginPath(); mctx.arc(x, y, p.human ? 8 : 6, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
  }
}

// Grand Prix standings tower
const standingsEl = $('#standings');
function drawStandings() {
  const sorted = [...game.racers].sort((a, b) => a.place - b.place);
  const lead = sorted[0];
  standingsEl.innerHTML = sorted.map((r) => {
    const gap = r === lead ? 'Leader' : r.finished ? fmt(r.finishTime) : `+${Math.max(0, (lead.tracker.progress - r.tracker.progress) / 38).toFixed(1)}s`;
    return `<li class="${r.human ? 'me' : ''}${r.finished ? ' done' : ''}"><b>${r.place}</b><i style="--c:${r.css}"></i><span>${escapeHtml(r.name)}</span><em>${gap}</em></li>`;
  }).join('');
}

// =====================================================================
// Scoring (score attack) and rewards (races)
// =====================================================================
function addScore(p, base, pos, color) {
  const pts = Math.round(base * p.mult * (1 + Math.min(p.combo, 20) * 0.1));
  p.score += pts;
  popup(p, `+${pts}`, pos, color);
  return pts;
}
function bumpCombo(p) {
  p.combo += 1;
  p.comboTimer = p.comboWindow;
  p.bestCombo = Math.max(p.bestCombo, p.combo);
  flashCombo(p);
}
function flashCombo(p) {
  if (!p.pane) return;
  const el = p.pane.combo;
  if (p.combo < 2) { el.textContent = ''; return; }
  el.textContent = `${p.combo} COMBO`;
  gsap.fromTo(el, { scale: 1.4 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
}
function addStyle(p, v) {
  p.style += v;
  if (p.style >= 100) {
    p.style = 0;
    const pts = Math.round(1000 * p.mult);
    p.score += pts;
    bigText('STYLE!', { hold: 0.3, color: '#8dc63f' });
    popup(p, `+${pts} STYLE`, p.car.position.clone().setY(3), 'lime');
    audio.sfx('wings');
  }
}
const addNitro = (p, v) => { p.nitro = Math.min(100, p.nitro + v); };

function handleEvent(e) {
  const p = game.racers[e.who ?? 0];
  if (!p || p.finished) return;
  e.pos.y += 1;
  const glow = FLAVORS[p.flavor].glow;
  const solo = game.mode === 'solo';
  switch (e.type) {
    case 'can':
      if (!solo) return;
      p.stats.cans++;
      addNitro(p, 8);
      bumpCombo(p);
      addScore(p, 100, e.pos, 'red');
      particles.burst(e.pos, glow, 18, 8);
      p.car.react('hop');
      break;
    case 'bolt':
      if (!solo) return;
      p.stats.bolts++;
      p.mult = Math.min(MAX_MULT, p.mult + 0.5);
      p.multIdle = 0;
      bumpCombo(p);
      popup(p, `x${p.mult.toFixed(1)}`, e.pos, 'lime');
      p.car.react('hop');
      particles.burst(e.pos, COLORS.lime, 26, 10);
      if (p.pane) gsap.fromTo(p.pane.mult.parentElement, { scale: 1.3 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
      break;
    case 'nitro':
      p.stats.nitro++;
      addNitro(p, 40);
      if (solo) bumpCombo(p);
      popup(p, 'NITRO +40', e.pos, 'lime');
      particles.burst(e.pos, 0x3d6bff, 30, 9);
      p.car.react('hop');
      break;
    case 'wings':
      p.stats.wings++;
      p.hawk = solo ? HAWK_TIME : 3.5;
      addNitro(p, 100);
      if (p.human) world.cheer(1);
      p.car.react('cheer');
      particles.burst(e.pos, 0xffffff, 60, 14);
      if (!solo) paneMsg(p, 'HAWK MODE', '#f4f6ff');
      else { game.time += 5; bumpCombo(p); addScore(p, 500, e.pos, 'white'); bigText('HAWK MODE', { hold: 0.5 }); }
      break;
    case 'gate':
      if (!solo) return;
      world.cheer(0.6);
      p.stats.gates++;
      game.time += GATE_TIME;
      bumpCombo(p);
      addScore(p, 400 + p.stats.gates * 50, e.pos, 'lime');
      popup(p, `+${GATE_TIME}s`, e.pos.clone().setY(7), 'white');
      particles.burst(e.pos, COLORS.lime, 70, 16);
      pickups.spawnGate(p.car);
      p.car.react('cheer');
      break;
  }
  if (p.human) audio.sfx({ gate: 'wings', nitro: 'bolt' }[e.type] ?? e.type);
}

// Power-ups
function useItem(r) {
  const e = items.use(r, game.racers);
  if (!e) return;
  r.stats.items++;
  handleItemEvent(e);
}
function handleItemEvent(e) {
  const r = e.racer;
  const me = r.human;
  switch (e.type) {
    case 'item': if (me) audio.sfx('item'); break;
    case 'turbo': {
      r.padBoost = Math.max(r.padBoost, 2.4);
      r.car.body.applyImpulse({ x: r.car.forward.x * 1100, y: 0, z: r.car.forward.z * 1100 }, true);
      particles.burst(r.car.position.clone().setY(0.6), COLORS.lime, 20, 7);
      if (me) { audio.sfx('turbo'); paneMsg(r, 'TURBO!', '#8dc63f'); r.shake = Math.max(r.shake, 0.25); }
      break;
    }
    case 'hawk':
      if (me || e.target?.human) audio.sfx('fire');
      if (e.target?.human) paneMsg(e.target, 'HAWK INCOMING!', '#f4f6ff');
      break;
    case 'mines': if (me) audio.sfx('crate'); break;
    case 'shield': if (me) audio.sfx('shield'); break;
    case 'hit':
      if (e.by) e.by.stats.hits++;
      if (me || e.by?.human) audio.sfx('hit');
      if (me) { paneMsg(r, 'SPUN OUT!', '#ff3348'); r.shake = 0.7; }
      if (e.by?.human && e.by !== r) { paneMsg(e.by, 'DIRECT HIT!', '#8dc63f'); popup(e.by, 'HIT!', e.pos, 'lime'); world.cheer(0.7); }
      break;
    case 'block':
      if (me) { paneMsg(r, 'BLOCKED!', '#3d6bff'); audio.sfx('shield'); }
      break;
  }
}

// =====================================================================
// Garage layout (menu)
// =====================================================================
function layoutGarage() {
  for (const c of Object.values(rivalCars)) c.setActive(false);
  if (game.mode === 'duel') {
    cars.classic.setActive(true);
    cars.ultra.setActive(true);
    cars.classic.reset(0, -2.6, 0.18);
    cars.ultra.reset(0, 2.6, -0.18);
  } else {
    for (const k in cars) cars[k].setActive(k === flavor);
    cars[flavor].reset(0, 0, 0);
  }
}

// =====================================================================
// Flow
// =====================================================================
let countdownTl = null;
let modeBeforeTrailer = null;

// CPU rivals for the Grand Prix (all four cars in the trailer).
function addRivals(all) {
  const other = flavor === 'classic' ? 'ultra' : 'classic';
  const list = [
    { car: cars[other], flavor: other, name: STOCK_NAME[other], css: FLAVORS[other].css },
    { car: rivalCars.midnight, flavor: 'classic', name: RIVALS.midnight.name, css: RIVALS.midnight.css },
    { car: rivalCars.volt, flavor: 'ultra', name: RIVALS.volt.name, css: RIVALS.volt.css },
  ];
  if (all) list.unshift({ car: cars[flavor], flavor, name: STOCK_NAME[flavor], css: FLAVORS[flavor].css });
  const lanes = [5.2, 14, 9.6, 7.4];
  list.forEach((b, i) => {
    const r = makeRacer(game.racers.length, b.flavor, b.name, b.car, { css: b.css });
    r.driver = r.ctrl = new Driver(r, { lane: lanes[i % lanes.length], level: all ? 'pro' : difficulty, jitter: (i - 1) * 0.012 });
    game.racers.push(r);
  });
}

function startRun({ trailer: isTrailer = false } = {}) {
  if (['intro', 'sound', 'drop', 'landing', 'countdown', 'trailer'].includes(game.state)) return;
  audio.unlock();
  countdownTl?.kill();
  popupsEl.innerHTML = '';
  const mode = game.mode;
  const duel = mode === 'duel', gp = mode === 'gp';
  input.mode = duel ? 'duel' : 'solo';
  applyTheme();
  game.players = isTrailer ? []
    : duel ? [makePlayer(0, 'classic', (p1Input.value || pilot).slice(0, 14)), makePlayer(1, 'ultra', (p2Input.value || 'RIVAL').slice(0, 14))]
    : [makePlayer(0, flavor, (nameInput.value || pilot).slice(0, 14))];
  game.racers = [...game.players];
  if (gp) addRivals(isTrailer);
  Object.assign(game, { time: RUN_TIME, clock: 0, winner: null, finishAt: 0 });
  for (const c of allCars) c.setActive(game.racers.some((r) => r.car === c));
  for (const p of game.players) {
    const ui = p.pane;
    ui.el.style.setProperty('--c', FLAVORS[p.flavor].css);
    ui.name.textContent = p.name;
    ui.tag.querySelector('b').textContent = duel ? SIDE[p.flavor].p : 'P1';
    ui.tag.querySelector('span').textContent = duel ? SIDE[p.flavor].label : FLAVORS[p.flavor].line.toUpperCase();
    ui.combo.textContent = '';
    ui.lastItem = undefined;
    ui.pos.textContent = '';
    ui.el.classList.remove('is-wrong');
  }

  // grid: four cars two by two in the Grand Prix (you start at the back),
  // side by side in the duel, centred in score attack
  input.assignPads();
  input.clear();
  const grid = gp ? [[18, 4.8], [18, 14.4], [8, 4.8], [8, 14.4]] : duel ? [[6, 4.8], [6, 14.4]] : [[6, W_TRACK / 2]];
  const slots = gp && !isTrailer ? [2, 0, 1, 3] : [0, 1, 2, 3];
  game.racers.forEach((r, i) => {
    const [s, lane] = grid[slots[i]];
    const pt = trackPoint(s, lane);
    r.spawn = pt;
    r.car.reset(pt.x, pt.z, pt.yaw);
    r.tracker.reset(0, s);
    // CPU drivers hold their grid lane off the line instead of cutting across
    if (r.driver) r.driver.home = r.driver.lane = lane;
  });
  if (gp || duel) pickups.layoutRace();
  else pickups.scatter(V3(game.racers[0].spawn.x, 0, game.racers[0].spawn.z));
  items.setEnabled(gp || duel);

  if (isTrailer) {
    game.state = 'trailer';
    show('trailer');
    for (const r of game.racers) r.tracker.start(0);
    trailer.start(game.racers, {
      cars,
      fire: (r, item) => { r.item = item; r.rolling = 0; useItem(r); },
      boost: (r, s) => { r.padBoost = Math.max(r.padBoost, s); },
      heroYaw: world.heroYaw,
    });
    audio.music('race');
    audio.playTrack('/audio/full-throttle-apex.mp3');
    return;
  }

  game.state = 'drop';
  show('drop');
  audio.music(true);
  airdrop.start(game.players.map((p) => ({
    car: p.car,
    target: V3(p.spawn.x, 0, p.spawn.z),
    yaw: p.spawn.yaw,
    height: p.car.spec.rest + p.car.spec.wheelRadius,
    chute: p.flavor === 'classic' ? 0 : 1,
  })), {
    onChute: (i) => { audio.sfx('wings'); game.players[i]?.car.react('cheer'); },
    onRelease: (i, vel, pos, quat) => {
      const p = game.players[i];
      if (!p) return;
      p.car.hold(pos, quat);
      p.car.release(vel);
      p.landT = 0;
      p.released = true;
    },
  });
}

function landedAll() {
  game.state = 'countdown';
  show('hud');
  for (const p of game.players) {
    particles.burst(p.car.position.clone().setY(0.3), 0xf4f6ff, 40, 9);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      particles.puff(p.car.position.clone().add(V3(Math.cos(a) * 1.8, 0.2, Math.sin(a) * 1.4)), 0xbfc6e0, 2.2, 1.6);
    }
    p.shake = 0.6;
    p.car.react('cheer');
  }
  world.cheer(1);
  audio.sfx('crate');
  startLights();
}

// Start gantry: five reds light up, then lights out and GO.
function startLights() {
  const lamps = $$('#lights i');
  lamps.forEach((l) => l.classList.remove('on', 'go'));
  $('#lights').classList.add('is-on');
  countdownTl = gsap.timeline({ delay: 0.5 });
  lamps.forEach((l, i) => countdownTl.call(() => { l.classList.add('on'); audio.sfx('count'); }, null, i * 0.55));
  countdownTl.call(() => {
    lamps.forEach((l) => { l.classList.remove('on'); l.classList.add('go'); });
    bigText('GO!', { hold: 0.35, color: '#8dc63f' });
    audio.sfx('go');
    game.state = 'race';
    game.clock = 0;
    for (const r of game.racers) r.tracker.start(0);
    if (game.mode === 'solo') pickups.spawnGate(game.players[0].car);
  }, null, lamps.length * 0.55 + 0.45 + Math.random() * 0.4);
  countdownTl.call(() => $('#lights').classList.remove('is-on'), null, '+=1.2');
}

function endSolo() {
  game.state = 'results';
  pickups.gate.hide();
  audio.sfx('end');
  audio.music(false);
  bigText('TIME!', { hold: 0.6 });
  const p = game.players[0];
  const id = submitScore(p.name, p.score);
  $('#res-rank').textContent = RANKS.filter(([min]) => p.score >= min).pop()[1];
  const s = p.stats;
  $('#res-stats').innerHTML = [
    ['Cans', s.cans], ['Gates', s.gates], ['Bolts', s.bolts], ['Wings', s.wings],
    ['Nitro', s.nitro], ['Drift (s)', s.drift.toFixed(1)], ['Best combo', p.bestCombo], ['Top km/h', Math.round(p.topKmh)],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><small>${k}</small></div>`).join('');
  renderBoard($('#board-results'), id);
  renderBoard($('#board-menu'), id);
  const resScore = $('#res-score');
  const counter = { v: 0 };
  setTimeout(() => {
    show('hud', 'results');
    gsap.from('#results .panel', { y: 40, opacity: 0, duration: 0.5, ease: 'power3.out' });
    gsap.from('#res-stats .stat', { y: 16, opacity: 0, stagger: 0.04, duration: 0.4, delay: 0.2 });
    gsap.to(counter, { v: p.score, duration: 1.2, ease: 'power2.out', onUpdate: () => (resScore.textContent = Math.round(counter.v).toLocaleString()) });
  }, 1200);
}

// A racer crossed the line for the last time.
function finishRacer(r) {
  r.finished = true;
  r.finishTime = r.tracker.finishTime;
  r.place = game.racers.filter((x) => x.finished).length;
  r.car.react('cheer');
  if (game.state === 'trailer') return;
  if (game.mode === 'duel') { finishPlayer(r); return; }
  if (!r.human) return;
  world.cheer(1);
  const win = r.place === 1;
  bigText(win ? 'WINNER!' : `${r.place}${ordinal(r.place)}`, { hold: 1.2, color: win ? '#8dc63f' : undefined });
  paneMsg(r, win ? 'CHEQUERED FLAG' : 'FINISHED', '#f4f6ff');
  audio.sfx('end');
  game.state = 'finish';
  game.finishAt = game.clock;
  setTimeout(endGP, 2800);
}

function finishPlayer(p) {
  p.car.react('cheer');
  world.cheer(1);
  if (!game.winner) {
    game.winner = p;
    bigText(`${SIDE[p.flavor].label} WINS!`, { hold: 1.2, color: FLAVORS[p.flavor].css });
    paneMsg(p, 'WINNER!', '#8dc63f');
    audio.sfx('end');
    const t = store.get(DUEL_KEY, { blue: 0, red: 0 });
    t[p.flavor === 'classic' ? 'blue' : 'red']++;
    store.set(DUEL_KEY, t);
    game.finishAt = game.clock;
  } else paneMsg(p, `${p.place}${ordinal(p.place)}`, '#f4f6ff');
}

function endDuel() {
  if (game.state !== 'finish') return;
  game.state = 'results';
  audio.music(false);
  const w = game.winner ?? [...game.players].sort((a, b) => b.tracker.progress - a.tracker.progress)[0];
  $('#duel-results').style.setProperty('--c', FLAVORS[w.flavor].css);
  $('#dr-winner').textContent = `${SIDE[w.flavor].label} WINS`;
  $('#dr-name').textContent = w.name;
  $('#dr-can').src = `/brand/can-${w.flavor}.webp`;
  $('#dr-table').innerHTML = game.players.map((p) => {
    const tr = p.tracker;
    return `<div class="dr-col${p === w ? ' is-win' : ''}" style="--c:${FLAVORS[p.flavor].css}">
      <header><b>${SIDE[p.flavor].p} · ${SIDE[p.flavor].label}</b><span>${escapeHtml(p.name)}</span></header>
      <dl>
        <div><dt>Finish</dt><dd>${tr.finished ? fmt(tr.finishTime) : 'DNF'}</dd></div>
        <div><dt>Best lap</dt><dd>${fmt(tr.best)}</dd></div>
        <div><dt>Top speed</dt><dd>${Math.round(p.topKmh)} km/h</dd></div>
        <div><dt>Power-ups</dt><dd>${p.stats.items}</dd></div>
        <div><dt>Hits landed</dt><dd>${p.stats.hits}</dd></div>
        <div><dt>Nitro tanks</dt><dd>${p.stats.nitro}</dd></div>
      </dl>
    </div>`;
  }).join('');
  renderTally();
  show('hud', 'duel-results');
  gsap.from('#duel-results .panel', { y: 40, opacity: 0, duration: 0.5, ease: 'power3.out' });
}

function endGP() {
  if (game.state !== 'finish') return;
  game.state = 'results';
  audio.music(false);
  const me = game.players[0];
  const order = [...game.racers].sort((a, b) => b.tracker.progress - a.tracker.progress);
  const place = me.place;
  // career, on this device
  const c = career();
  const proBefore = c.wins.pro;
  c.races++;
  if (place <= 3) c.podiums++;
  if (place === 1) c.wins[difficulty]++;
  if (isFinite(me.tracker.best)) c.bestLap = c.bestLap ? Math.min(c.bestLap, me.tracker.best) : me.tracker.best;
  store.set(CAREER_KEY, c);
  const unlockedNow = difficulty === 'pro' && place === 1 && proBefore === 0 && c.wins.legend === 0;

  const panel = $('#gp-results');
  panel.dataset.medal = place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : 'none';
  $('#gp-place').textContent = place;
  $('#gp-sup').textContent = ordinal(place);
  $('#gp-title').textContent = place === 1 ? 'Victory' : place <= 3 ? 'Podium' : 'Finished';
  $('#gp-sub').textContent = `${DIFFICULTY[difficulty].label} Grand Prix · ${me.name}`;
  $('#gp-unlock').hidden = !unlockedNow;
  const leadT = order[0].finished ? order[0].finishTime : null;
  $('#gp-table').innerHTML = order.map((r, i) => {
    const t = r.finished ? (i === 0 || leadT == null ? fmt(r.finishTime) : `+${(r.finishTime - leadT).toFixed(2)}s`) : 'Running';
    return `<li class="${r.human ? 'me' : ''}"><b>${i + 1}</b><i style="--c:${r.css}"></i><span>${escapeHtml(r.name)}${r.human ? ' <em>YOU</em>' : ''}</span><small>${fmt(r.tracker.best)}</small><strong>${t}</strong></li>`;
  }).join('');
  $('#gp-stats').innerHTML = [
    ['Race time', fmt(me.finishTime)], ['Best lap', fmt(me.tracker.best)], ['Top km/h', Math.round(me.topKmh)],
    ['Overtakes', me.stats.overtakes], ['Power-ups', me.stats.items], ['Hits landed', me.stats.hits],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><small>${k}</small></div>`).join('');
  renderCareer();
  show('hud', 'gp-results');
  gsap.from('#gp-results .panel', { y: 40, opacity: 0, duration: 0.5, ease: 'power3.out' });
  gsap.from('#gp-table li', { x: -24, opacity: 0, stagger: 0.07, duration: 0.4, delay: 0.25 });
}

function pause() {
  if (!['race', 'countdown'].includes(game.state)) return;
  game.resumeTo = game.state;
  game.state = 'paused';
  input.clear();
  countdownTl?.pause();
  audio.music('pause');
  show('hud', 'pause');
}
function resume() {
  if (game.state !== 'paused') return;
  game.state = game.resumeTo;
  countdownTl?.resume();
  audio.music(true);
  show('hud');
}
function toGarage() {
  countdownTl?.kill();
  pickups.gate.hide();
  items.setEnabled(false);
  trailer.stop();
  airdrop.active = false;
  airdrop.plane.group.visible = false;
  for (const c of airdrop.chutes) { c.group.visible = false; c.lines.visible = false; }
  $('#lights').classList.remove('is-on');
  game.state = 'menu';
  game.players = [];
  game.racers = [];
  if (modeBeforeTrailer) { const m = modeBeforeTrailer; modeBeforeTrailer = null; setMode(m); }
  input.mode = game.mode === 'duel' ? 'duel' : 'solo';
  input.clear();
  audio.music(false);
  layoutGarage();
  renderBoard($('#board-menu'));
  renderCareer();
  show('menu');
  revealMenu();
}
function revealMenu() {
  gsap.fromTo('.menu-left > *', { y: 26, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.7, ease: 'power3.out' });
  gsap.fromTo('.menu-right > *:not([hidden])', { x: 30, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.08, duration: 0.7, ease: 'power3.out', delay: 0.15 });
  gsap.fromTo('.topbar', { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 });
}
function setMuteUi() {
  $$('[data-action="mute"]').forEach((b) => b.classList.toggle('is-off', audio.muted));
}
function startTrailer() {
  if (!['menu', 'results'].includes(game.state)) return;
  modeBeforeTrailer = game.mode;
  if (game.mode !== 'gp') setMode('gp');
  startRun({ trailer: true });
}

const actions = {
  play: startRun,
  pause,
  resume,
  garage: toGarage,
  skip: () => (game.state === 'trailer' ? toGarage() : airdrop.skip()),
  trailer: startTrailer,
  settings: openSettings,
  'close-settings': closeSettings,
  help: openHelp,
  'close-help': closeHelp,
  stats: () => setStats(!settings.stats),
  mute: () => { audio.unlock(); audio.setMuted(!audio.muted); setMuteUi(); },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  actions[b.dataset.action]?.();
  b.blur();
});
setMuteUi();

input.on('Enter', () => {
  if (isSettingsOpen()) return;
  if (game.state === 'drop') airdrop.skip();
  else if (game.state === 'trailer') toGarage();
  else if (game.state === 'sound') chooseSound(true);
  else if (['menu', 'results'].includes(game.state)) startRun();
});
input.on('NumpadEnter', () => { if (['menu', 'results'].includes(game.state)) startRun(); });
input.on('Escape', () => {
  if (helpDlg.classList.contains('is-active')) closeHelp();
  else if (dlg.classList.contains('is-active')) closeSettings();
  else if (game.state === 'sound') chooseSound(false);
  else if (game.state === 'trailer') toGarage();
  else if (game.state === 'paused') resume();
  else pause();
});
input.on('KeyP', () => (game.state === 'paused' ? resume() : pause()));
input.on('Digit1', () => { if (game.state === 'menu') setMode('gp'); });
input.on('Digit2', () => { if (game.state === 'menu') setMode('solo'); });
input.on('Digit3', () => { if (game.state === 'menu') setMode('duel'); });
input.on('KeyT', () => { if (game.state === 'menu') startTrailer(); });
input.on('KeyR', () => { if (game.state === 'race') game.players[0]?.car.resetUpright(); });
input.on('Backspace', () => { if (game.state === 'race' && game.mode === 'duel') game.players[1]?.car.resetUpright(); });
for (const el of [nameInput, p1Input, p2Input]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { el.blur(); startRun(); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); input.clear(); }
  clock.getDelta(); // swallow the hidden time: no catch-up burst on return
});

// =====================================================================
// Intro: mosaic -> welcome -> iris into the scene -> sound?
// =====================================================================
function splitChars(el) {
  el.innerHTML = [...el.textContent].map((c) => `<span class="ch">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  return el.querySelectorAll('.ch');
}
function playIntro() {
  const iris = $('#iris');
  gsap.timeline()
    .to('.intro-foot', { opacity: 0, duration: 0.3 }, 0.5)
    .to('.keyart', { scale: 1.12, opacity: 0, duration: 0.6, ease: 'power3.in' }, 0.7)
    .call(() => {
      show('welcome');
      gsap.fromTo(splitChars($('.welcome-top')), { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: 0.04, duration: 0.5, ease: 'power3.out' });
      gsap.fromTo(splitChars($('#welcome-name')), { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: 0.035, duration: 0.5, ease: 'power3.out', delay: 0.2 });
    })
    .to('#welcome p', { opacity: 0, y: -30, duration: 0.4, ease: 'power2.in', stagger: 0.05 }, '+=1.5')
    .call(() => {
      show();
      iris.classList.add('is-active');
      iris.style.setProperty('--r', '0px');
      const o = { r: 0 };
      gsap.to(o, {
        r: Math.hypot(innerWidth, innerHeight) * 0.6, duration: 1.4, ease: 'power3.inOut',
        onUpdate: () => iris.style.setProperty('--r', `${o.r}px`),
        onComplete: () => iris.classList.remove('is-active'),
      });
    })
    .call(() => {
      game.state = 'sound';
      show('sound');
      gsap.fromTo('.sound-q', { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(2)' });
      gsap.fromTo('.sound-opt', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, delay: 0.2 });
    }, null, '+=1.0');
}
function chooseSound(on) {
  if (game.state !== 'sound') return;
  audio.unlock();
  audio.setMuted(!on);
  setMuteUi();
  if (on) audio.sfx('go');
  game.state = 'menu';
  layoutGarage();
  gsap.to('#sound > *', {
    opacity: 0, y: -20, duration: 0.3, stagger: 0.05,
    onComplete: () => { gsap.set('#sound > *', { clearProps: 'all' }); show('menu'); revealMenu(); },
  });
}
$$('.sound-opt').forEach((b) => b.addEventListener('click', () => chooseSound(b.dataset.sound === 'on')));

// =====================================================================
// Simulation
// =====================================================================
const _rear = V3(0, 0, 0);
const LIVE = ['race', 'finish', 'results', 'trailer'];
const isRacing = (p) => !p.finished && (game.state === 'race' || game.state === 'trailer' || (game.state === 'finish' && !p.human));

function simulatePlayer(p, dt) {
  const racing = isRacing(p);
  const solo = game.mode === 'solo';
  if (racing) {
    if (p.hawk > 0) p.hawk = Math.max(0, p.hawk - dt);
    if (solo) {
      if (p.comboTimer > 0) { p.comboTimer -= dt; if (p.comboTimer <= 0) { p.combo = 0; flashCombo(p); } }
      p.multIdle += dt;
      if (p.multIdle > 5 && p.mult > 1) p.mult = Math.max(1, p.mult - dt * 0.15);
    }
    if (p.car.drifting) {
      p.driftChain += dt;
      p.stats.drift += dt;
      if (solo) { addStyle(p, dt * 22); p.score += Math.round(dt * 80 * p.mult); }
      else addNitro(p, dt * 7); // drifting charges nitro in races
      // holding a drift charges a mini-turbo
      if (p.ctrl?.handbrake) p.driftCharge += dt;
    } else if (p.driftChain > 0) {
      if (p.driftChain > 1 && solo) { bumpCombo(p); addScore(p, Math.round(p.driftChain * 120), p.car.position.clone().setY(2.5), 'red'); }
      p.driftChain = 0;
    }
    if (!p.car.drifting && p.driftCharge > 0) {
      if (p.driftCharge > 0.7) {
        const lvl = p.driftCharge > 1.6 ? 2 : 1;
        p.padBoost = Math.max(p.padBoost, lvl === 2 ? 1.3 : 0.7);
        p.stats.turbos++;
        p.turboPop = lvl;
      }
      p.driftCharge = 0;
    }
    p.topKmh = Math.max(p.topKmh, p.car.kmh);
  } else p.driftCharge = 0;
  if (p.padBoost > 0) p.padBoost = Math.max(0, p.padBoost - dt);
  const wants = racing && p.ctrl?.boost;
  const boosting = racing && (p.hawk > 0 || p.padBoost > 0 || (wants && p.nitro > 0));
  const burn = p.flavor === 'ultra' ? 26 : 20;
  if (racing && wants && p.hawk <= 0 && p.padBoost <= 0) p.nitro = Math.max(0, p.nitro - dt * burn);
  else if (racing) p.nitro = Math.min(100, p.nitro + dt * (game.mode === 'solo' ? 3 : game.mode === 'gp' ? 2 : 1.5));
  p.boosting = boosting;
  return boosting;
}

// Slipstream: tucked in close behind another car gives a gentle pull and nitro.
function slipstream(p, dt) {
  let tucked = false;
  if (isRacing(p) && p.car.kmh > 70) {
    const c = p.car;
    for (const o of game.racers) {
      if (o === p) continue;
      const dx = o.car.position.x - c.position.x, dz = o.car.position.z - c.position.z;
      const along = dx * c.forward.x + dz * c.forward.z;
      const lat = Math.abs(dx * c.right.x + dz * c.right.z);
      if (along > 3 && along < 16 && lat < 2.2) { tucked = true; break; }
    }
  }
  p.draft = tucked ? Math.min(1.5, p.draft + dt) : Math.max(0, p.draft - dt * 2);
  if (p.draft > 0.5) {
    p.car.body.applyImpulse({ x: p.car.forward.x * 320 * dt, y: 0, z: p.car.forward.z * 320 * dt }, true);
    addNitro(p, dt * 6);
  }
}

function trackAir(p) {
  if (game.state !== 'race' || game.mode !== 'solo') { p.wasAir = false; return; }
  if (p.car.airborne) p.maxAir = Math.max(p.maxAir, p.car.airTime);
  else if (p.wasAir) {
    const t = p.maxAir;
    if (t > 0.45) {
      const pos = p.car.position.clone().setY(3);
      bumpCombo(p);
      addStyle(p, 18);
      addScore(p, Math.round(t * 400), pos, 'white');
      popup(p, `AIR ${t.toFixed(1)}s`, pos.clone().setY(5), 'lime');
      particles.burst(p.car.position.clone().setY(0.3), FLAVORS[p.flavor].glow, 30, 7);
      p.shake = Math.max(p.shake, 0.3);
      audio.sfx('crate');
    }
    p.maxAir = 0;
  }
  p.wasAir = p.car.airborne;
}

// Safety net behind the barriers: a car that still ends up off the road (a
// wild bounce, a physics glitch) is put back on the nearest bit of track.
function keepOnTrack(p, dt) {
  if (!['race', 'countdown', 'finish', 'results', 'trailer'].includes(game.state)) { p.outT = 0; return; }
  const c = p.car.position;
  const d = trackDistance(c.x, c.z);
  const out = d < -2.5 || d > W_TRACK + 2.5 || c.y < -3;
  p.outT = out ? (p.outT ?? 0) + dt : 0;
  if (p.outT < 0.5) return;
  p.outT = 0;
  p.rescues = (p.rescues ?? 0) + 1;
  const pt = trackPoint(trackParam(c.x, c.z), THREE.MathUtils.clamp(d, 3, W_TRACK - 3));
  p.car.reset(pt.x, pt.z, pt.yaw);
  p.shake = 0;
  paneMsg(p, 'BACK ON TRACK', '#f4f6ff');
}

// Laps, finishing order and positions for both kinds of race.
function updateRace(dt) {
  for (const r of game.racers) {
    if (r.finished) continue;
    const ev = r.tracker.update(r.car.position, game.clock, dt);
    if (ev === 'lap' && r.human) {
      const last = r.tracker.lapsDone === LAPS - 1;
      paneMsg(r, last ? 'FINAL LAP' : `LAP ${r.tracker.lap}`, last ? '#8dc63f' : '#f4f6ff');
      audio.sfx('go');
      world.cheer(0.5);
    } else if (ev === 'finish') finishRacer(r);
  }
  [...game.racers].sort((a, b) => b.tracker.progress - a.tracker.progress).forEach((r, i) => {
    if (r.finished) return;
    const place = i + 1;
    if (r.human && game.state === 'race' && place < r.place && game.clock > 3) r.stats.overtakes++;
    r.place = place;
  });
}

// =====================================================================
// Cameras
// =====================================================================
let debugCam = null; // dev only: pin view 0 for inspection

// Racing camera, arcade style: low and close behind the car, which sits in
// the lower middle of the frame, looking well down the road so the horizon
// stays high. It follows the car's heading (blended with its velocity, so
// drifts show the car side-on), and a ray against the static world pulls it
// in rather than through barriers.
const CAM = { dist: 5.4, distSpeed: 0.6, distBoost: 0.5, height: 1.95, heightSpeed: 0.25, ahead: 8, lookY: 0.55, turn: 5.5, hfovSolo: 74, hfovDuel: 68 };
const camRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
const _fwd = V3(0, 0, 0), _vel = V3(0, 0, 0), _org = V3(0, 0, 0), _dir = V3(0, 0, 0);
function chaseCamera(view, p, dt) {
  const car = p.car;
  const speed = car.kmh / 3.6;
  const speedK = Math.min(speed / 50, 1);
  _fwd.copy(car.forward).setY(0).normalize();
  _vel.set(car.velocity.x, 0, car.velocity.z);
  if (_vel.lengthSq() > 16 && _vel.dot(_fwd) > 0) _fwd.lerp(_vel.normalize(), 0.35).normalize();
  view.heading ??= _fwd.clone();
  // while spinning out, hold the old heading instead of whipping round
  if (car.spin <= 0) view.heading.lerp(_fwd, 1 - Math.exp(-(car.airborne ? 1.5 : CAM.turn) * dt)).normalize();
  const dist = CAM.dist + speedK * CAM.distSpeed + p.boostFx * CAM.distBoost;
  const height = CAM.height + speedK * CAM.heightSpeed;
  _target.copy(car.position).addScaledVector(view.heading, -dist);
  _target.y = Math.max(car.position.y, 0.6) + height;
  // camera collision against the static world (barriers, stands)
  _org.copy(car.position).setY(car.position.y + 1.2);
  _dir.copy(_target).sub(_org);
  const len = _dir.length();
  _dir.multiplyScalar(1 / len);
  camRay.origin = { x: _org.x, y: _org.y, z: _org.z };
  camRay.dir = { x: _dir.x, y: _dir.y, z: _dir.z };
  const hit = physics.castRay(camRay, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
  if (hit) _target.copy(_org).addScaledVector(_dir, Math.max(1.6, hit.timeOfImpact - 0.35));
  const settle = ['countdown', 'landing'].includes(game.state) ? 3 : 10;
  view.camPos.lerp(_target, 1 - Math.exp(-settle * dt));
  _rear.copy(car.position).addScaledVector(view.heading, CAM.ahead);
  _rear.y = car.position.y * 0.6 + CAM.lookY;
  view.camLook.lerp(_rear, 1 - Math.exp(-14 * dt));
  // keep the same horizontal field of view in full and split views
  const motion = settings.reducedMotion ? 0.3 : 1;
  const hfov = (game.mode === 'duel' ? CAM.hfovDuel : CAM.hfovSolo) + speedK * 8 * motion + p.boostFx * 7 * motion;
  const vfov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / view.camera.aspect) * 180) / Math.PI;
  return THREE.MathUtils.clamp(vfov, 40, 82);
}
const _target = V3(0, 0, 0);
let camYaw = 0.9;

function updateCamera(view, p, dt, time) {
  const cam = view.camera;
  let fov = 38;
  let snap = false;
  if (game.state === 'trailer') {
    fov = trailer.camera(view, dt);
    snap = true;
  } else if (game.state === 'drop' || (game.state === 'landing' && airdrop.active && game.players.some((pp) => pp.landT < 0.4))) {
    view.camPos.lerp(airdrop.camPos, 1 - Math.exp(-6 * dt));
    view.camLook.lerp(airdrop.camLook, 1 - Math.exp(-8 * dt));
    fov = 48;
  } else if (game.state === 'intro' || game.state === 'sound') {
    const c = cars[game.mode === 'duel' ? 'classic' : flavor].position;
    _target.set(c.x + 4.2 + Math.sin(time * 0.3) * 0.4, 2.2 + Math.sin(time * 0.3) * 0.15, c.z + 2.4 * Math.sin(0.75 + Math.sin(time * 0.25) * 0.25));
    view.camPos.lerp(_target, 1 - Math.exp(-2 * dt));
    view.camLook.lerp(_rear.set(c.x, 1.1, c.z), 1 - Math.exp(-4 * dt));
    fov = 34;
  } else if (game.state === 'menu') {
    camYaw += dt * 0.18;
    const narrow = innerWidth < 860;
    const duel = game.mode === 'duel';
    const r = (narrow ? 9.5 : 7.4) * (duel ? 1.45 : 1);
    _target.set(Math.cos(camYaw) * r, 3.4 + Math.sin(time * 0.4) * 0.3 + (duel ? 1.2 : 0), Math.sin(camYaw) * r);
    view.camPos.lerp(_target, 1 - Math.exp(-1.6 * dt));
    const side = innerWidth < 980 ? 0 : -0.7;
    _rear.set(Math.sin(camYaw) * side, narrow ? 1.8 : 0.9, -Math.cos(camYaw) * side);
    view.camLook.lerp(_rear, 1 - Math.exp(-3 * dt));
    fov = 34;
  } else if (p) {
    fov = chaseCamera(view, p, dt);
  }
  if (import.meta.env.DEV && debugCam && view === views[0]) {
    view.camPos.copy(debugCam.pos);
    view.camLook.copy(debugCam.look);
    fov = debugCam.fov ?? fov;
  }
  cam.position.copy(view.camPos);
  if (p && p.shake > 0 && !settings.shake) p.shake = 0;
  if (p && p.shake > 0) {
    p.shake = Math.max(0, p.shake - dt * 1.5);
    cam.position.x += (Math.random() - 0.5) * p.shake;
    cam.position.y += (Math.random() - 0.5) * p.shake;
  }
  cam.lookAt(view.camLook);
  // never let a bad frame (e.g. a 0x0 window mid-resize) poison the lens
  if (!Number.isFinite(fov)) fov = 60;
  if (!Number.isFinite(cam.fov)) cam.fov = fov;
  cam.fov = snap ? fov : cam.fov + (fov - cam.fov) * (1 - Math.exp(-3 * dt));
  cam.updateProjectionMatrix();
}

// =====================================================================
// Diagnostics overlay (F3): CPU frame/sim/render timings + renderer counts
// =====================================================================
const diagEl = $('#diag');
function updateDiag(split) {
  const i = renderer.info;
  const f = (v) => v.toFixed(1);
  diagEl.querySelector('pre').textContent = [
    `fps        ${f(1000 / Math.max(1, frameStats.pct(0.5)))}`,
    `frame ms   p50 ${f(frameStats.pct(0.5))}  p95 ${f(frameStats.pct(0.95))}  p99 ${f(frameStats.pct(0.99))}`,
    `sim ms     p50 ${f(simStats.pct(0.5))}  p95 ${f(simStats.pct(0.95))}   (CPU)`,
    `render ms  p50 ${f(renderStats.pct(0.5))}  p95 ${f(renderStats.pct(0.95))}   (CPU submit)`,
    `draw calls ${i.render.calls}   triangles ${(i.render.triangles / 1000).toFixed(0)}k   (all views + passes)`,
    `geometries ${i.memory.geometries}   textures ${i.memory.textures}   programs ${i.programs?.length ?? '-'}`,
    `views ${split ? 2 : 1}   dpr ${f(DPR)}   scale ${activePreset().scale}   msaa ${activePreset().msaa}`,
    `mode ${game.mode}   state ${game.state}   racers ${game.racers.length}   ${innerWidth}x${innerHeight}`,
  ].join('\n');
}
function setStats(on) {
  setSetting('stats', on);
  diagEl.classList.toggle('is-on', on);
  $('#set-stats').checked = on;
}
diagEl.classList.toggle('is-on', settings.stats);
addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); setStats(!settings.stats); } });

// =====================================================================
// Settings dialog
// =====================================================================
const dlg = $('#settings');
let dlgReturn = null;
function openSettings() {
  dlgReturn = document.activeElement;
  dlg.classList.add('is-active');
  dlg.querySelector(`[name="quality"][value="${settings.quality}"]`)?.focus();
}
function closeSettings() {
  dlg.classList.remove('is-active');
  dlgReturn?.focus?.();
}
const helpDlg = $('#help');
function openHelp() { dlgReturn = document.activeElement; helpDlg.classList.add('is-active'); helpDlg.querySelector('button')?.focus(); }
function closeHelp() { helpDlg.classList.remove('is-active'); dlgReturn?.focus?.(); }
const isSettingsOpen = () => dlg.classList.contains('is-active') || helpDlg.classList.contains('is-active');
for (const r of dlg.querySelectorAll('[name="quality"]')) {
  r.checked = r.value === settings.quality;
  r.addEventListener('change', () => { setSetting('quality', r.value); if (r.value !== 'auto') autoQ.level = r.value; qualityKey = ''; });
}
const bindToggle = (id, key, after) => {
  const el = $(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => { setSetting(key, el.checked); after?.(el.checked); });
};
bindToggle('#set-shake', 'shake');
bindToggle('#set-motion', 'reducedMotion', (v) => document.body.classList.toggle('reduced-motion', v));
bindToggle('#set-stats', 'stats', (v) => diagEl.classList.toggle('is-on', v));
document.body.classList.toggle('reduced-motion', settings.reducedMotion);
for (const [id, key] of [['#set-music', 'music'], ['#set-sfx', 'sfx']]) {
  const el = $(id);
  el.value = Math.round(settings[key] * 100);
  el.addEventListener('input', () => { setSetting(key, el.value / 100); audio.setVolumes(settings.music, settings.sfx); });
}
audio.setVolumes(settings.music, settings.sfx);

// Controller notices
const toastEl = $('#toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3200);
}
input.onPad = (i, connected) => {
  const who = game.mode === 'duel' ? (i === 0 ? 'P1 Blue' : 'P2 Red') : 'Controller';
  if (!connected) {
    toast(`${who}: controller disconnected. Reconnect it, or press Esc to continue on keyboard.`);
    pause();
  } else toast(`${who}: controller reconnected.`);
};

// Arrow keys move through radio groups (modes, fuels, difficulty, quality)
document.addEventListener('keydown', (e) => {
  const group = e.target.closest?.('[role="radiogroup"]');
  if (!group || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const list = [...group.querySelectorAll('[role="radio"]')];
  const i = list.indexOf(e.target.closest('[role="radio"]'));
  if (i < 0) return;
  e.preventDefault();
  const next = list[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length];
  next.focus();
  next.click();
});

// =====================================================================
// Loop
// =====================================================================
const clock = new THREE.Clock();
let acc = 0;
let elapsed = 0;
let puffT = 0;
const isSplit = () => game.mode === 'duel' && ['countdown', 'race', 'finish', 'results', 'paused'].includes(game.state);

const frameStats = new FrameStats();
const simStats = new FrameStats();
const renderStats = new FrameStats();
let lastRender = performance.now();
let hudAcc = 0;
let hudTick = true;
let diagAcc = 0;

let recording = false; // dev trailer capture owns the clock while true

function frame(fixedDt) {
  if (recording && fixedDt === undefined) { lastFrame = performance.now(); schedule(); return; }
  const now = performance.now();
  const interval = now - lastRender;
  lastRender = now;
  lastFrame = now;
  const dt = fixedDt ?? Math.min(clock.getDelta(), 0.1);
  frameStats.push(interval);
  if (settings.quality === 'auto' && ['race', 'menu', 'countdown'].includes(game.state) && autoQ.sample(interval, dt)) qualityKey = '';
  renderer.info.reset();
  const simStart = performance.now();
  const paused = game.state === 'paused';
  const players = game.players;
  const racers = game.racers;
  const activeCars = allCars.filter((c) => c.active);
  const live = LIVE.includes(game.state);

  if (!paused) {
    elapsed += dt;
    acc += dt;
    if (airdrop.active) airdrop.update(dt);

    // CPU drivers (and finished humans on autopilot) think once per frame
    if (live) {
      const humans = players.filter((p) => !p.finished);
      const target = humans.length ? Math.max(...humans.map((p) => p.tracker.progress)) : racers.reduce((a, r) => a + r.tracker.progress, 0) / Math.max(1, racers.length);
      const ctx = { racers, target, clock: game.state === 'trailer' ? 99 : game.clock, racing: game.state === 'race' || game.state === 'trailer' || game.state === 'finish' };
      for (const r of racers) {
        if (r.human && !r.finished) continue;
        r.driver ??= new Driver(r, { lane: 9.6 });
        r.driver.update(dt, ctx);
        if (r.driver.fire && isRacing(r)) useItem(r);
      }
    }
    // humans fire power-ups on a fresh press
    for (const p of players) {
      const f = !!p.ctrl.fire;
      if (f && !p.firePrev && game.state === 'race' && !p.finished && game.mode !== 'solo') useItem(p);
      p.firePrev = f;
    }

    while (acc >= STEP) {
      for (const c of activeCars) c.capturePrev();
      world.capturePrev?.();
      for (const p of racers) simulatePlayer(p, STEP);
      if (game.state === 'race' && game.mode === 'solo') {
        game.time -= STEP;
        if (game.time <= 0) { game.time = 0; endSolo(); }
      }
      if (['race', 'finish', 'trailer'].includes(game.state)) game.clock += STEP;
      // hold every car still riding the plane or hanging under a chute
      if (game.state === 'drop' || game.state === 'landing') {
        airdrop.cargo?.forEach((c) => { if (!c.released) c.car.hold(c.pos, c.quat); });
      }
      for (const c of activeCars) {
        const r = racers.find((rr) => rr.car === c);
        const auto = r && (!r.human || r.finished);
        const ctrl = r ? (auto ? r.driver ?? input.players[0] : r.ctrl) : input.players[0];
        const frozen = !r || !(r.human && !r.finished ? game.state === 'race' : live);
        c.prePhysics(ctrl, STEP, { boost: r?.boosting ?? false, hawk: (r?.hawk ?? 0) > 0 && live, frozen });
      }
      physics.step();
      acc -= STEP;
    }
    const alpha = acc / STEP;
    for (const c of activeCars) {
      c.idle = game.state === 'menu' || game.state === 'sound';
      c.sync(dt, elapsed, alpha);
    }
    airdrop.cargo?.forEach((c) => {
      if (!c.released && airdrop.active && game.state === 'drop') { c.car.group.position.copy(c.pos); c.car.group.quaternion.copy(c.quat); }
    });
    for (const p of players) trackAir(p);
    for (const r of racers) { keepOnTrack(r, dt); slipstream(r, dt); }

    // drop -> landing -> countdown
    if (game.state === 'drop' && players.length && players.every((p) => p.released)) game.state = 'landing';
    if (game.state === 'landing') {
      for (const p of players) {
        p.landT += dt;
        if (!p.landed && ((p.landT > 0.15 && !p.car.airborne) || p.landT > 3)) p.landed = true;
      }
      if (players.every((p) => p.landed)) landedAll();
    }

    const magnets = racers.map((p) => (p.hawk > 0 ? 16 : 0));
    const events = pickups.update(dt, elapsed, racers.length ? racers.map((p) => p.car) : [cars[flavor]], magnets);
    if (live && game.state !== 'results') events.forEach(handleEvent);

    if (items.enabled) {
      const ranks = new Map(racers.map((r) => [r, racers.length > 1 ? (r.place - 1) / (racers.length - 1) : 0]));
      for (const e of items.update(dt, elapsed, live ? racers : [], ranks)) handleItemEvent(e);
    }

    if (live && game.state !== 'results') {
      for (const p of racers) {
        if (p.finished) continue;
        // nitro pads: free burst + a kick forward (per-racer cooldown)
        p.padCool = Math.max(0, p.padCool - dt);
        if (p.padCool <= 0 && world.checkPad(p.car.position)) {
          p.padCool = 1.2;
          p.padBoost = Math.max(p.padBoost, 1.3);
          p.car.body.applyImpulse({ x: p.car.forward.x * 900, y: 0, z: p.car.forward.z * 900 }, true);
          if (p.human) {
            popup(p, 'NITRO PAD!', p.car.position.clone().setY(2.5), 'lime');
            audio.sfx('bolt');
            p.shake = Math.max(p.shake, 0.2);
          }
        }
        if (p.turboPop) {
          if (p.human) { popup(p, p.turboPop === 2 ? 'SUPER TURBO!' : 'MINI TURBO', p.car.position.clone().setY(2.4), 'lime'); audio.sfx('turbo'); }
          p.turboPop = 0;
        }
      }
      if (game.mode !== 'solo') updateRace(dt);
      if (game.mode === 'duel' && game.state === 'race' && game.winner && (players.every((p) => p.finished) || game.clock - game.finishAt > 8)) {
        game.state = 'finish';
        setTimeout(endDuel, 1500);
      }
    }

    // exhaust / tyre smoke / mini-turbo sparks
    puffT -= dt;
    if (puffT <= 0) {
      puffT = 0.025;
      for (const p of racers) {
        const c = p.car;
        if (c.drifting) for (const s of [1, -1]) {
          _rear.copy(c.position).addScaledVector(c.forward, -0.95).addScaledVector(c.right, 0.9 * s).setY(0.25);
          particles.puff(_rear, 0x9aa3cc, 1.4, 1.1);
          if (p.driftCharge > 0.7) particles.spark(_rear, p.driftCharge > 1.6 ? COLORS.lime : COLORS.electric);
        }
        if (p.boosting) for (const z of [0.32, -0.32]) {
          _rear.copy(c.position).addScaledVector(c.forward, -1.75).addScaledVector(c.right, z).setY(c.position.y - 0.2);
          particles.puff(_rear, p.hawk > 0 ? 0xffffff : FLAVORS[p.flavor].glow, 0.5, 0.6);
        }
      }
    }
    const lead = (players[0]?.car ?? racers[0]?.car ?? cars[flavor]).position;
    world.update(elapsed, lead, 0, dt);
    world.crowd.update(elapsed, lead, (players[1] ?? racers[1])?.car.position);
    particles.update(dt);
    if (game.state === 'trailer' && !trailer.update(dt)) toGarage();
  }

  simStats.push(performance.now() - simStart);
  const renderStart = performance.now();
  // ---- render one or two views
  const split = isSplit();
  applyQuality(split);
  const w = innerWidth, h = innerHeight;
  views[0].setRect(0, 0, split ? Math.floor(w / 2) - 2 : w, h);
  views[1].setRect(Math.ceil(w / 2) + 2, 0, Math.floor(w / 2) - 2, h);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.setClearColor(0x02030f, 1);
  renderer.clear();
  for (let i = 0; i < (split ? 2 : 1); i++) {
    const v = views[i];
    const p = players[i] ?? null;
    if (p) p.boostFx += ((p.boosting ? 1 : 0) - p.boostFx) * Math.min(1, dt * 6);
    updateCamera(v, p, dt, elapsed);
    const trailerFocus = game.state === 'trailer' ? v.camLook : null;
    const focus = trailerFocus ?? (game.state === 'drop' ? airdrop.camLook : p ? p.car.position : cars[game.mode === 'duel' ? 'classic' : flavor].position);
    // tilt-shift (toy look) only in the garage; racing views stay sharp
    const tilt = game.state === 'drop' ? 0.3 : ['race', 'countdown', 'landing', 'finish', 'paused', 'results', 'trailer'].includes(game.state) ? 0 : 1.7;
    v.final.uniforms.uTilt.value += (tilt - v.final.uniforms.uTilt.value) * Math.min(1, dt * 3);
    v.final.uniforms.uBoost.value = game.state === 'drop' ? 0.4 : p?.boostFx ?? 0;
    v.final.uniforms.uTime.value = elapsed;
    v.bloom.strength = 0.28 + (p?.boostFx ?? 0) * 0.2 + ((p?.hawk ?? 0) > 0 ? 0.15 : 0);
    v.render(() => world.focus(focus, p?.boosting ? 1 : 0));
  }
  renderer.setScissorTest(false);
  renderStats.push(performance.now() - renderStart);

  // ---- audio + HUD
  if (audio.ctx) {
    const pool = players.length ? players : racers;
    const lp = pool.reduce((a, p) => (!a || p.car.kmh > a.car.kmh ? p : a), null);
    const active = game.state === 'race';
    audio.engine(Math.min((lp?.car.kmh ?? 0) / 180, 1), active ? lp?.ctrl.throttle ?? 0 : 0, lp?.boosting ?? false, active);
  }
  // DOM-heavy HUD bits (minimap, standings) refresh at ~30 Hz; gauges every frame
  hudAcc += dt;
  hudTick = hudAcc > 1 / 30;
  if (hudTick) hudAcc = 0;
  diagAcc += dt;
  if (settings.stats && diagAcc > 0.25) { diagAcc = 0; updateDiag(split); }
  if (['countdown', 'race', 'finish', 'paused', 'results'].includes(game.state) && players.length) {
    $('#hud-time').textContent = game.mode === 'solo' ? Math.max(0, game.time).toFixed(1) : fmt(game.clock);
    $('.hud-clock').classList.toggle('is-low', game.mode === 'solo' && game.time < 10 && game.state === 'race');
    for (const p of players) updatePane(p, dt);
    if (hudTick) {
      drawMinimap();
      if (game.mode === 'gp') drawStandings();
    }
  }
  if (game.state === 'drop') $('#drop').classList.toggle('can-skip', airdrop.t > 0.8);
  schedule();
}

let rafPending = false;
let lastFrame = performance.now();
function schedule() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; frame(); });
}
addEventListener('resize', () => {
  if (!(innerWidth > 0 && innerHeight > 0)) return;
  renderer.setSize(innerWidth, innerHeight);
  if (trailer.active) trailer.resize();
});

if (import.meta.env.DEV) {
  // The desktop preview pane stops delivering animation frames when it is
  // behind other windows; keep ticking so automated checks still run.
  let devHold = false;
  setInterval(() => {
    if (devHold || document.hidden || performance.now() - lastFrame < 250) return;
    gsap.updateRoot(gsap.globalTimeline.time() + 0.033);
    frame(0.033);
  }, 33);
  // Manual stepping for automated checks: advances GSAP and the game together.
  let gsapTime = 0;
  const step = (n = 1, dt = 1 / 60) => {
    gsap.ticker.lagSmoothing(0);
    for (let i = 0; i < n; i++) {
      gsapTime = Math.max(gsapTime, gsap.globalTimeline.time()) + dt;
      gsap.updateRoot(gsapTime);
      frame(dt);
    }
    return game.state;
  };
  // Trailer capture: render fixed-step frames, composite scene + titles and
  // post them to the dev server (see vite.config.js), in resumable chunks.
  const rec = {
    i: 0,
    canvas: document.createElement('canvas'),
    // Frames come out at exactly innerWidth x innerHeight on High quality.
    begin() {
      devHold = true;
      recording = true;
      rec.i = 0;
      settings.quality = 'high';
      qualityKey = '';
      renderer.setPixelRatio(1);
      renderer.setSize(innerWidth, innerHeight);
      for (const v of views) { v.dpr = 1; v.presetKey = null; }
      if (game.state !== 'menu') toGarage();
      startTrailer();
      trailer.resize(innerWidth, innerHeight, 1);
      return [game.state, renderer.domElement.width, renderer.domElement.height];
    },
    // synchronous on purpose: background tabs throttle async callbacks
    chunk(n = 60, fps = 30, quality = 0.92) {
      const src = renderer.domElement;
      rec.canvas.width = src.width;
      rec.canvas.height = src.height;
      const g = rec.canvas.getContext('2d');
      for (let k = 0; k < n && game.state === 'trailer'; k++) {
        step(1, 1 / fps);
        if (game.state !== 'trailer') break;
        g.drawImage(src, 0, 0);
        g.drawImage($('#titles'), 0, 0, src.width, src.height);
        const bin = atob(rec.canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/__frame?i=${rec.i++}`, false);
        xhr.send(bytes);
      }
      if (game.state !== 'trailer') recording = false;
      return { frame: rec.i, t: trailer.t.toFixed(2), of: TRAILER_LENGTH, state: game.state };
    },
  };
  window.__nh = {
    THREE, Driver, trackPoint, trackParam, trackDistance, CAM, game, cars, rivalCars, views, pickups, items, world, airdrop, input, trailer,
    setFlavor, setMode, setDifficulty, startRun, startTrailer, toGarage, step, rec,
    hold: (v) => { devHold = v; },
    cam: (pos, look, fov) => { debugCam = pos ? { pos: V3(...pos), look: V3(...look), fov } : null; },
  };
}

// =====================================================================
// Boot
// =====================================================================
setMode(game.mode);
setFlavor(flavor);
layoutGarage();
pickups.scatter(V3(0, 0, 0));
renderBoard($('#board-menu'));
renderTally();
renderCareer();
schedule();
progress(100, 'Ready');
booted = true;
gsap.delayedCall(0.9, playIntro);
