// CPU rivals. Each Driver exposes the same controls as a human controller
// (throttle, steer, boost, handbrake) and is updated once per frame:
//  - racing line: its own lane on the straights, the inside line in the bends
//  - traffic: moves over to pass a car in front instead of running into it
//  - pace: a skill-based speed cap with gentle rubber-banding to the human(s)
//  - nitro on the straights, power-ups when they make sense
//  - gets itself unstuck (reverse out, then reset to the road)
import { trackParam, trackPoint, trackDistance, curveAt, wrapSigned, TRACK_W } from './track.js';

export const DIFFICULTY = {
  rookie: { label: 'Rookie', pace: 0.8, band: 0.1, nitro: 0.3, aim: 0.45 },
  pro: { label: 'Pro', pace: 0.9, band: 0.08, nitro: 0.6, aim: 0.75 },
  legend: { label: 'Legend', pace: 0.98, band: 0.06, nitro: 1, aim: 1 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Driver {
  constructor(racer, { lane = TRACK_W / 2, level = 'pro', jitter = 0 } = {}) {
    this.racer = racer;
    this.home = lane;
    this.lane = lane;
    this.level = DIFFICULTY[level] ?? DIFFICULTY.pro;
    this.pace = this.level.pace * (1 + jitter);
    this.throttle = 0;
    this.steer = 0;
    this.boost = false;
    this.handbrake = false;
    this.stuck = 0;
    this.reverse = 0;
    this.push = 0;
    this.fire = false;
    this.holdItem = 0;
    this.boostFor = 0;
  }

  // ctx: { racers, target (progress the field is banded to), racing }
  update(dt, ctx) {
    const r = this.racer;
    const c = r.car;
    const pos = c.position;
    const speed = c.kmh / 3.6;
    if (!ctx.racing || r.finished) {
      this.throttle = r.finished ? 0.35 : 0;
      this.boost = false;
      this.#steerTo(trackParam(pos.x, pos.z) + 12, this.lane, c);
      return;
    }
    const s = trackParam(pos.x, pos.z);
    const here = trackDistance(pos.x, pos.z);
    // a fresh line every lap, so no one owns the pads and wings
    if (r.tracker.lapsDone !== this.lapSeen) {
      this.lapSeen = r.tracker.lapsDone;
      if (this.lapSeen > 0) this.home = 4 + Math.random() * (TRACK_W - 8);
    }

    // ---- unstick: back off a wall the nose is pointing at, otherwise drive
    // out on full lock; after a couple of failed tries, reset onto the road
    const p0 = trackPoint(s, here);
    const yawErr = Math.atan2(Math.sin(p0.yaw - Math.atan2(-c.forward.z, c.forward.x)), Math.cos(p0.yaw - Math.atan2(-c.forward.z, c.forward.x)));
    if (this.reverse > 0 || this.push > 0) {
      const rev = this.reverse > 0;
      if (rev) this.reverse -= dt; else this.push -= dt;
      this.throttle = rev ? -1 : 1;
      this.steer = Math.sign(yawErr || 1) * (rev ? -1 : 1);
      this.boost = false;
      this.fire = false;
      return;
    }
    this.stuck = speed < 2.5 && c.spin <= 0 ? this.stuck + dt : 0;
    if (this.stuck > 1.2) {
      this.stuck = 0;
      this.attempts = (this.attempts ?? 0) + 1;
      if (this.attempts >= 3) {
        this.attempts = 0;
        const p = trackPoint(s, clamp(here, 3, TRACK_W - 3));
        c.reset(p.x, p.z, p.yaw);
        return;
      }
      const p1 = trackPoint(s, here + 1);
      const noseOut = c.forward.x * (p1.x - p0.x) + c.forward.z * (p1.z - p0.z);
      const noseToWall = here > TRACK_W / 2 ? noseOut > 0.25 : noseOut < -0.25;
      if (noseToWall || Math.abs(yawErr) > 2.4) this.reverse = 1.0;
      else this.push = 1.0;
      return;
    }
    if (speed > 8) this.attempts = 0;

    // ---- line: own lane on straights, the inside of the bends
    const look = 9 + speed * 0.34;
    const bend = Math.max(curveAt(s + look), curveAt(s + look * 0.5));
    let target = this.home + (3.6 - this.home) * bend * 0.85;

    // ---- traffic: pick a side to pass anything just in front
    for (const o of ctx.racers) {
      if (o === r) continue;
      const op = o.car.position;
      const ds = wrapSigned(trackParam(op.x, op.z) - s);
      if (ds <= 0 || ds > 16) continue;
      const ol = trackDistance(op.x, op.z);
      const dl = ol - target;
      if (Math.abs(dl) < 2.8) {
        const side = ol > TRACK_W - 4 ? -1 : ol < 4 ? 1 : dl > 0 ? -1 : 1;
        target = ol + side * 3.2;
      }
    }
    target = clamp(target, 2.2, TRACK_W - 2.2);
    this.lane = damp(this.lane, target, 1.8, dt);
    this.#steerTo(s + look, this.lane, c);

    // ---- nitro on straights (more of it when behind)
    const gap = ctx.target - r.tracker.progress; // > 0: behind the humans
    const straight = curveAt(s + 40) < 0.15 && bend < 0.2;
    // no nitro off the line; plenty when behind the humans, little when well clear
    const urge = gap > 0 ? 1.8 : gap > -35 ? 0.8 : 0.12;
    if (this.boostFor > 0) this.boostFor -= dt;
    else if (ctx.clock > 2.5 && straight && r.nitro > 35 && Math.random() < dt * (0.6 + 1.6 * this.level.nitro) * urge) this.boostFor = 1.2 + Math.random() * 1.5;
    this.boost = this.boostFor > 0 && straight && r.nitro > 2;

    // ---- pace: skill cap, banded to the humans
    const band = clamp(gap / 140, -1, 1) * this.level.band;
    const base = this.boost || r.hawk > 0 || r.padBoost > 0 ? c.tuning.boostSpeed : c.tuning.maxSpeed;
    const top = base * clamp(this.pace + band, 0.6, 1.08) * (1 - bend * 0.06);
    this.throttle = speed < top ? 1 : speed < top + 2 ? 0.3 : 0;
    this.handbrake = false;

    // ---- power-ups
    this.fire = false;
    if (r.item && !r.rolling) {
      this.holdItem += dt;
      this.fire = this.#wantsToUse(r, s, straight, ctx);
    } else this.holdItem = 0;
  }

  #wantsToUse(r, s, straight, ctx) {
    const t = this.holdItem;
    if (t < 0.5 + (1 - this.level.aim) * 1.5) return false;
    const gaps = ctx.racers.filter((o) => o !== r).map((o) => o.tracker.progress - r.tracker.progress);
    switch (r.item) {
      case 'shield': return true;
      case 'turbo': return straight || t > 6;
      case 'hawk': return gaps.some((g) => g > 4 && g < 140) || t > 8;
      case 'mines': return gaps.some((g) => g < -2 && g > -40) || t > 7;
      default: return t > 5;
    }
  }

  #steerTo(sTarget, lane, c) {
    const p = trackPoint(sTarget, lane);
    const want = Math.atan2(-(p.z - c.position.z), p.x - c.position.x);
    const have = Math.atan2(-c.forward.z, c.forward.x);
    let d = want - have;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.steer = clamp(d * 2.6, -1, 1);
  }
}
