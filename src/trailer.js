// In-engine trailer: a ~37 s cut of a live four-car Grand Prix, with camera
// shots chosen around the action and kinetic titles drawn on a 2D canvas over
// the scene. Everything is a pure function of trailer time (plus the live
// race), so it plays the same in the menu and when recorded frame by frame.
import * as THREE from 'three';
import { trackParam, trackPoint, trackDistance, curveAt, TRACK_W } from './track.js';

export const TRAILER_LENGTH = 37;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = {
  out: (t) => 1 - Math.pow(1 - clamp01(t), 3),
  inOut: (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  back: (t) => { t = clamp01(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
const lerp = (a, b, t) => a + (b - a) * t;
const C = { white: '#f4f6ff', lime: '#8dc63f', blue: '#3d6bff', red: '#ff3348', navy: '#050a3a' };
const PLAZA = V(50, 0, 0);

// [name, start, end]
const SHOTS = [
  ['plaza', 0, 3.4],
  ['aerial', 3.4, 7],
  ['passby', 7, 10.4],
  ['classic', 10.4, 14],
  ['ultra', 14, 17.6],
  ['strike', 17.6, 21.6],
  ['drift', 21.6, 25],
  ['crowd', 25, 28.4],
  ['chase', 28.4, 31.4],
  ['endcard', 31.4, TRAILER_LENGTH],
];

export class Trailer {
  // canvas: the title layer; images: { logo, classic, ultra } (HTMLImageElement)
  constructor(canvas, images) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.img = images;
    this.active = false;
    this.t = 0;
    this._a = V(0, 0, 0);
    this._b = V(0, 0, 0);
  }

  // hooks: { cars: { classic, ultra }, fire(racer, item), boost(racer, s), heroYaw() }
  start(racers, hooks) {
    this.racers = racers;
    this.hooks = hooks;
    this.t = 0;
    this.active = true;
    this.shot = null;
    this.subject = null;
    this.cues = new Set();
    this.resize();
  }

  stop() {
    this.active = false;
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  resize(w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio, 2)) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  get done() { return this.t >= TRAILER_LENGTH; }

  // Advance and draw the titles. Returns false once the trailer is over.
  update(dt) {
    if (!this.active) return false;
    this.t += dt;
    const shot = SHOTS.find(([, a, b]) => this.t >= a && this.t < b) ?? SHOTS.at(-1);
    if (shot !== this.shot) { this.shot = shot; this.#pickSubject(shot[0]); }
    this.#cues();
    this.#draw();
    return !this.done;
  }

  // ---------- who the shot is about ----------
  #leader() { return [...this.racers].sort((a, b) => b.tracker.progress - a.tracker.progress)[0]; }
  #byCar(car) { return this.racers.find((r) => r.car === car) ?? this.#leader(); }
  #pickSubject(name) {
    const rs = this.racers;
    if (name === 'classic') this.subject = this.#byCar(this.hooks.cars.classic);
    else if (name === 'ultra') this.subject = this.#byCar(this.hooks.cars.ultra);
    else if (name === 'strike') {
      // the closest chase on track: a car with another just up the road
      const sorted = [...rs].sort((a, b) => b.tracker.progress - a.tracker.progress);
      let best = null, bestGap = Infinity;
      sorted.forEach((r, i) => {
        if (i === 0) return;
        const gap = sorted[i - 1].tracker.progress - r.tracker.progress;
        if (gap > 8 && gap < bestGap) { bestGap = gap; best = r; }
      });
      this.subject = best ?? sorted[1] ?? sorted[0];
      this.subject.shield = 0;
    } else if (name === 'drift') {
      this.subject = rs.find((r) => curveAt(trackParam(r.car.position.x, r.car.position.z) + 25) > 0.5) ?? this.#leader();
    } else this.subject = this.#leader();
    if (name === 'passby') {
      const p = this.subject.car.position;
      const s = trackParam(p.x, p.z);
      this.anchor = trackPoint(s + 75, TRACK_W - 1.4);
    }
  }

  #cues() {
    const local = this.t - this.shot[1];
    const once = (key, at, fn) => { if (local >= at && !this.cues.has(key)) { this.cues.add(key); fn(); } };
    const name = this.shot[0];
    if (name === 'strike') once('strike', 0.5, () => this.hooks.fire(this.subject, 'hawk'));
    if (name === 'drift') once('drift', 0.1, () => this.hooks.boost(this.subject, 3));
    if (name === 'classic' || name === 'ultra') once(name, 0.2, () => this.hooks.boost(this.subject, 2.2));
    if (name === 'chase') once('chase', 0.1, () => this.hooks.boost(this.subject, 2.6));
  }

  // ---------- cameras ----------
  // Sets view.camPos / view.camLook directly and returns a vertical fov.
  camera(view, dt) {
    const [name, a, b] = this.shot ?? SHOTS[0];
    const u = clamp01((this.t - a) / (b - a));
    const pos = view.camPos, look = view.camLook;
    const r = this.subject;
    const c = r?.car;
    const lateral = (car) => {
      const s = trackParam(car.position.x, car.position.z);
      const lane = trackDistance(car.position.x, car.position.z);
      const p0 = trackPoint(s, lane), p1 = trackPoint(s, lane + 1);
      const out = lane < TRACK_W / 2 ? 1 : -1; // side with more road
      return this._b.set((p1.x - p0.x) * out, 0, (p1.z - p0.z) * out).normalize();
    };
    const hfov = (deg) => (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(deg) / 2) / view.camera.aspect) * 180) / Math.PI;
    switch (name) {
      case 'plaza': {
        // low push-in on the label side of the colossal cans
        const k = ease.inOut(u);
        const yaw = this.hooks.heroYaw() + 0.35 - k * 0.25;
        const d = 34 - k * 9;
        pos.set(PLAZA.x + Math.sin(yaw) * d, 2 + k * 1.8, Math.cos(yaw) * d);
        look.set(PLAZA.x, 8.5 + k * 1.5, 0);
        return hfov(58);
      }
      case 'aerial': {
        const ang = 0.7 + u * 0.55;
        pos.set(Math.cos(ang) * 165, 78 - u * 16, Math.sin(ang) * 130);
        look.set(0, 0, 10);
        return hfov(58);
      }
      case 'passby': {
        // trackside telephoto: the pack fills the frame as it charges in
        pos.set(this.anchor.x, 1.1, this.anchor.z);
        look.lerp(c.position.clone().setY(0.9), u < 0.02 ? 1 : 1 - Math.exp(-10 * dt));
        const d = pos.distanceTo(c.position);
        return hfov(THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(9 / Math.max(d, 1))), 18, 72));
      }
      case 'classic':
      case 'ultra': {
        const side = lateral(c);
        const fwd = this._a.copy(c.forward).setY(0).normalize();
        const front = name === 'ultra';
        const target = this.#onRoad(c.position.clone()
          .addScaledVector(side, front ? 4.6 : 6.4)
          .addScaledVector(fwd, front ? 7.5 - u * 3 : 2.5 - u * 4))
          .setY(c.position.y + (front ? 0.9 : 1.3));
        if (u < 0.03) pos.copy(target); else pos.lerp(target, 1 - Math.exp(-12 * dt));
        look.copy(c.position).addScaledVector(fwd, 0.8).setY(c.position.y + 0.8);
        return hfov(64);
      }
      case 'strike':
      case 'chase': {
        // follow the road's direction, not the car's nose, so a spin or a
        // shunt doesn't whip the camera round
        const sNow = trackParam(c.position.x, c.position.z);
        const tp = trackPoint(sNow + 4, trackDistance(c.position.x, c.position.z));
        const fwd = this._a.set(Math.cos(tp.yaw), 0, -Math.sin(tp.yaw));
        const back = name === 'chase' ? 6 : 7.5;
        const target = c.position.clone().addScaledVector(fwd, -back).setY(c.position.y + (name === 'chase' ? 1.4 : 2.6));
        if (u < 0.03) pos.copy(target); else pos.lerp(target, 1 - Math.exp(-9 * dt));
        look.copy(c.position).addScaledVector(fwd, name === 'chase' ? 8 : 16).setY(c.position.y + 0.9);
        return hfov(name === 'chase' ? 84 : 62);
      }
      case 'drift': {
        const side = lateral(c);
        const fwd = this._a.copy(c.forward).setY(0).normalize();
        const target = this.#onRoad(c.position.clone().addScaledVector(fwd, 9 - u * 3).addScaledVector(side, 4)).setY(1.1);
        if (u < 0.03) pos.copy(target); else pos.lerp(target, 1 - Math.exp(-12 * dt));
        look.copy(c.position).setY(c.position.y + 0.7);
        return hfov(70);
      }
      case 'crowd': {
        // along the Blue stand, high over the outer lanes
        const x = lerp(-34, 14, ease.inOut(u));
        pos.set(x, 5.2, 74);
        look.set(x + 14, 3.4, 92);
        return hfov(62);
      }
      default: {
        // end card: low between the colossal cans, which tower either side
        const yaw = this.hooks.heroYaw() + 0.05;
        const d = 19 - ease.out(u) * 4;
        pos.set(PLAZA.x + Math.sin(yaw) * d, 2.6 + u * 0.8, Math.cos(yaw) * d);
        look.set(PLAZA.x, 9.6, 0);
        return hfov(68);
      }
    }
  }

  // Keep a camera inside the barriers (nothing on the road can block it).
  #onRoad(v) {
    const s = trackParam(v.x, v.z);
    const lane = Math.max(0.6, Math.min(TRACK_W - 0.6, trackDistance(v.x, v.z)));
    const p = trackPoint(s, lane);
    return v.set(p.x, v.y, p.z);
  }

  // ---------- titles ----------
  #draw() {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const t = this.t;
    const [name, a, b] = this.shot;
    const l = t - a; // shot-local time
    const u = l / (b - a);

    // letterbox
    const bar = H * 0.1 * ease.out(t / 0.8);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, bar);
    g.fillRect(0, H - bar, W, bar);

    // soft grade under lower-third titles so they read over any background
    if (['aerial', 'classic', 'ultra', 'drift'].includes(name)) {
      const gr = g.createLinearGradient(0, H * 0.45, 0, H);
      gr.addColorStop(0, 'rgba(2,3,15,0)');
      gr.addColorStop(1, 'rgba(2,3,15,0.6)');
      g.fillStyle = gr;
      g.fillRect(0, H * 0.45, W, H * 0.55);
    }
    if (['strike', 'crowd', 'chase', 'passby'].includes(name)) {
      const gr = g.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, H * 0.6);
      gr.addColorStop(0, 'rgba(2,3,15,0.35)');
      gr.addColorStop(1, 'rgba(2,3,15,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // a quick white flash on some cuts
    if (['passby', 'classic', 'ultra', 'strike', 'endcard'].includes(name) && l < 0.18) {
      g.fillStyle = `rgba(255,255,255,${0.55 * (1 - l / 0.18)})`;
      g.fillRect(0, 0, W, H);
    }
    // fade in from black at the very start
    if (t < 0.6) { g.fillStyle = `rgba(0,0,0,${1 - t / 0.6})`; g.fillRect(0, 0, W, H); }

    const S = H / 1000; // type scale
    switch (name) {
      case 'plaza': {
        const k1 = ease.out((l - 0.3) / 0.7);
        this.#text('NIGHT HAWK ENERGY', W / 2, H * 0.36, { font: `700 ${30 * S}px "Chakra Petch"`, color: C.white, alpha: k1, tracking: 0.42 * 30 * S });
        const k2 = ease.back((l - 1.0) / 0.7);
        if (this.img.logo && l > 1) {
          const lw = H * 0.34 * lerp(1.25, 1, k2), lh = lw * (this.img.logo.height / this.img.logo.width);
          g.globalAlpha = clamp01((l - 1) / 0.4);
          g.drawImage(this.img.logo, W / 2 - lw / 2, H * 0.52 - lh / 2, lw, lh);
          g.globalAlpha = 1;
        }
        this.#text('PRESENTS', W / 2, H * 0.71, { font: `700 ${24 * S}px "Chakra Petch"`, color: C.lime, alpha: ease.out((l - 2.1) / 0.5), tracking: 0.5 * 24 * S });
        break;
      }
      case 'aerial': {
        const k = ease.out((l - 0.2) / 0.6);
        const x = W * 0.07 - (1 - k) * W * 0.2;
        this.#text('WELCOME TO THE', x, H * 0.66, { font: `700 ${30 * S}px "Chakra Petch"`, color: C.lime, align: 'left', alpha: k, tracking: 0.3 * 30 * S });
        const k2 = ease.out((l - 0.45) / 0.6);
        this.#text('NIGHT HAWK STADIUM', W * 0.07 - (1 - k2) * W * 0.3, H * 0.76, { font: `italic 900 ${78 * S}px Unbounded`, color: C.white, align: 'left', alpha: k2, skew: -0.12 });
        g.fillStyle = C.lime;
        g.fillRect(W * 0.07, H * 0.8, W * 0.42 * ease.inOut((l - 0.9) / 0.8), 8 * S);
        this.#fadeOut(l, b - a);
        break;
      }
      case 'passby': {
        const words = ['4 RACERS', '3 LAPS', '1 CROWN'];
        const i = Math.min(2, Math.floor(l / 1.05));
        const k = ease.back((l - i * 1.05) / 0.35);
        this.#text(words[i], W / 2, H * 0.53, { font: `italic 900 ${lerp(170, 120, k) * S}px Unbounded`, color: i === 2 ? C.lime : C.white, alpha: clamp01((l - i * 1.05) / 0.12), skew: -0.12, shadow: true });
        break;
      }
      case 'classic':
      case 'ultra': {
        const blue = name === 'classic';
        const col = blue ? C.blue : C.red;
        const left = blue;
        const x = left ? W * 0.07 : W * 0.93;
        const align = left ? 'left' : 'right';
        const k = ease.out((l - 0.15) / 0.5);
        const slide = (1 - k) * W * 0.25 * (left ? -1 : 1);
        this.#text(blue ? 'P1 · BLUE' : 'P2 · RED', x + slide, H * 0.6, { font: `700 ${26 * S}px "Chakra Petch"`, color: C.white, align, alpha: k, tracking: 0.3 * 26 * S });
        this.#text(blue ? 'CLASSIC' : 'ULTRA', x + slide * 1.3, H * 0.72, { font: `italic 900 ${120 * S}px Unbounded`, color: col, align, alpha: k, skew: -0.12, shadow: true });
        const k2 = ease.out((l - 0.45) / 0.5);
        this.#text(blue ? 'CRUISER' : 'BUGGY', x + slide * 1.6, H * 0.83, { font: `italic 900 ${84 * S}px Unbounded`, color: C.white, align, alpha: k2, skew: -0.12, outline: true });
        const can = this.img[name];
        if (can) {
          const ch = H * 0.62, cw = ch * (can.width / can.height);
          const k3 = ease.out((l - 0.3) / 0.7);
          const cx = left ? W * 0.93 - cw : W * 0.07;
          g.globalAlpha = k3;
          g.drawImage(can, cx, H * 0.2 + (1 - k3) * H * 0.3, cw, ch);
          g.globalAlpha = 1;
        }
        this.#fadeOut(l, b - a);
        break;
      }
      case 'strike': {
        const k = ease.out((l - 0.2) / 0.4);
        this.#text('UNLEASH', W / 2, H * 0.24, { font: `700 ${46 * S}px "Chakra Petch"`, color: C.lime, alpha: k, tracking: 0.5 * 46 * S, shadow: true });
        const k2 = ease.back((l - 0.45) / 0.45);
        this.#text('THE HAWK', W / 2, H * 0.36, { font: `italic 900 ${lerp(150, 104, k2) * S}px Unbounded`, color: C.white, alpha: clamp01((l - 0.45) / 0.15), skew: -0.12, shadow: true });
        this.#fadeOut(l, b - a);
        break;
      }
      case 'drift': {
        ['NITRO.', 'DRIFT.', 'REPEAT.'].forEach((w, i) => {
          const k = ease.back((l - 0.2 - i * 0.7) / 0.35);
          this.#text(w, W * 0.07, H * (0.58 + i * 0.1), { font: `italic 900 ${86 * S}px Unbounded`, color: i === 1 ? C.white : C.lime, align: 'left', alpha: clamp01((l - 0.2 - i * 0.7) / 0.12), skew: -0.12, scale: lerp(1.4, 1, k), shadow: true });
        });
        this.#fadeOut(l, b - a);
        break;
      }
      case 'crowd': {
        const k = ease.out((l - 0.3) / 0.6);
        this.#text('THE CROWD IS', W / 2, H * 0.29, { font: `700 ${46 * S}px "Chakra Petch"`, color: C.lime, alpha: k, tracking: 0.4 * 46 * S, shadow: true });
        const k2 = ease.back((l - 0.6) / 0.45);
        this.#text('ON ITS FEET', W / 2, H * 0.42, { font: `italic 900 ${lerp(140, 100, k2) * S}px Unbounded`, color: C.white, alpha: clamp01((l - 0.6) / 0.15), skew: -0.12, shadow: true });
        this.#fadeOut(l, b - a);
        break;
      }
      case 'chase': {
        const first = l < 1.5;
        const ll = first ? l : l - 1.5;
        const k = ease.back(ll / 0.4);
        this.#text(first ? 'BEAT THE RIVALS.' : 'OWN THE CROWN.', W / 2, H * 0.3, { font: `italic 900 ${lerp(120, 84, k) * S}px Unbounded`, color: first ? C.white : C.lime, alpha: clamp01(ll / 0.12), skew: -0.12, shadow: true });
        break;
      }
      default: { // end card
        const dim = ease.out(l / 0.8);
        g.fillStyle = `rgba(5,10,58,${0.3 * dim})`;
        g.fillRect(0, 0, W, H);
        const gr = g.createRadialGradient(W / 2, H * 0.56, 0, W / 2, H * 0.56, H * 0.62);
        gr.addColorStop(0, `rgba(2,3,15,${0.72 * dim})`);
        gr.addColorStop(1, 'rgba(2,3,15,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        if (this.img.logo) {
          const k = ease.out((l - 0.1) / 0.6);
          const lw = H * 0.16, lh = lw * (this.img.logo.height / this.img.logo.width);
          g.globalAlpha = k;
          g.drawImage(this.img.logo, W / 2 - lw / 2, H * 0.2, lw, lh);
          g.globalAlpha = 1;
        }
        const k1 = ease.back((l - 0.35) / 0.5);
        this.#text('HAWK', W / 2, H * 0.5, { font: `italic 900 ${lerp(260, 170, k1) * S}px Unbounded`, color: C.white, alpha: clamp01((l - 0.35) / 0.12), skew: -0.12, shadow: true });
        const k2 = ease.back((l - 0.65) / 0.5);
        this.#text('RACING', W / 2, H * 0.66, { font: `italic 900 ${lerp(200, 132, k2) * S}px Unbounded`, color: C.lime, alpha: clamp01((l - 0.65) / 0.12), skew: -0.12, shadow: true });
        const k3 = ease.out((l - 1.4) / 0.6);
        this.#text('A NIGHT HAWK ENERGY RACING GAME', W / 2, H * 0.75, { font: `700 ${24 * S}px "Chakra Petch"`, color: C.white, alpha: k3, tracking: 0.35 * 24 * S });
        // CTA pill
        const k4 = ease.back((l - 2) / 0.5);
        if (l > 2) {
          g.font = `italic 900 ${24 * S}px Unbounded`;
          const pw = (g.measureText('PLAY NOW · FREE IN YOUR BROWSER').width + 90 * S) * k4, ph = 74 * S * k4;
          g.save();
          g.translate(W / 2, H * 0.835);
          g.transform(1, 0, -0.18, 1, 0, 0);
          g.fillStyle = C.lime;
          this.#round(-pw / 2, -ph / 2, pw, ph, ph / 2);
          g.fill();
          g.restore();
          this.#text('PLAY NOW · FREE IN YOUR BROWSER', W / 2, H * 0.835, { font: `italic 900 ${24 * S * k4}px Unbounded`, color: C.navy, alpha: clamp01((l - 2.1) / 0.2) });
        }
        // fade to black
        const out = clamp01((t - (TRAILER_LENGTH - 0.8)) / 0.8);
        if (out > 0) { g.fillStyle = `rgba(0,0,0,${out})`; g.fillRect(0, 0, W, H); }
      }
    }
  }

  #fadeOut(l, len) {
    const k = clamp01((l - (len - 0.35)) / 0.35);
    if (k <= 0) return;
    // titles slide off via a lime wipe
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#8dc63f';
    const x = lerp(-W * 0.2, W * 1.2, ease.inOut(k));
    g.save();
    g.transform(1, 0, -0.35, 1, 0, 0);
    g.fillRect(x, H * 0.1, W * 0.06, H * 0.8);
    g.restore();
  }

  #round(x, y, w, h, r) {
    const g = this.g;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  #text(str, x, y, { font, color, align = 'center', alpha = 1, skew = 0, tracking = 0, scale = 1, shadow = false, outline = false } = {}) {
    if (alpha <= 0.001) return;
    const g = this.g;
    g.save();
    g.globalAlpha = clamp01(alpha);
    g.translate(x, y);
    g.transform(scale, 0, skew * scale, scale, 0, 0);
    g.font = font;
    g.textAlign = align;
    g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = `${tracking}px`;
    if (shadow) { g.shadowColor = 'rgba(2,3,15,0.55)'; g.shadowOffsetY = 6 * (this.canvas.height / 1000); g.shadowBlur = 18 * (this.canvas.height / 1000); }
    if (outline) {
      g.lineWidth = Math.max(2, this.canvas.height / 330);
      g.strokeStyle = color;
      g.strokeText(str, 0, 0);
    } else {
      g.fillStyle = color;
      g.fillText(str, 0, 0);
    }
    g.restore();
  }
}
