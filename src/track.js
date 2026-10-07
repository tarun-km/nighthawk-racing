// Race geometry for the stadium oval: arc-length parameter along the lane
// centre line, start positions, and a per-car tracker for checkpoints, laps,
// lap times and race position. Cars race anticlockwise as seen from above:
// along the bottom straight (z > 0) towards +X.
export const TRACK = { L: 95, R: 60, lanes: 6, lane: 3.2 }; // stadium oval

// Signed distance to the oval's inner edge (negative = infield).
export function trackDistance(x, z) {
  const qx = Math.max(Math.abs(x) - TRACK.L, 0);
  return Math.hypot(qx, z) - TRACK.R;
}

const L = TRACK.L;
export const TRACK_W = TRACK.lanes * TRACK.lane;
const W = TRACK_W;
const RC = TRACK.R + W / 2; // centre-line radius
export const PERIM = 4 * L + 2 * Math.PI * RC;
export const LAPS = 3;
const CHECKPOINTS = 16;
const CP = Array.from({ length: CHECKPOINTS }, (_, i) => (i / CHECKPOINTS) * PERIM);

const wrap = (v, m) => ((v % m) + m) % m;
const wrapSigned = (v) => wrap(v + PERIM / 2, PERIM) - PERIM / 2;

// Distance travelled along the oval from the start/finish line (x = 0, z > 0).
export function trackParam(x, z) {
  if (x >= L) {
    const th = Math.atan2(z, x - L); // +π/2 at the bottom straight
    return L + (Math.PI / 2 - th) * RC;
  }
  if (x <= -L) {
    const th = Math.atan2(z, x + L);
    return 3 * L + Math.PI * RC + wrap(-Math.PI / 2 - th, Math.PI * 2) * RC;
  }
  if (z >= 0) return x >= 0 ? x : 3 * L + 2 * Math.PI * RC + (x + L);
  return L + Math.PI * RC + (L - x);
}

// World position + heading at arc length s, offset `lane` metres from the
// inner edge (0 = inner curb, W = outer edge).
export function trackPoint(s, lane = W / 2) {
  s = wrap(s, PERIM);
  const r = TRACK.R + lane;
  if (s < L) return { x: s, z: r, yaw: 0 };
  s -= L;
  if (s < Math.PI * RC) {
    const th = Math.PI / 2 - s / RC;
    return { x: L + Math.cos(th) * r, z: Math.sin(th) * r, yaw: Math.PI / 2 - th };
  }
  s -= Math.PI * RC;
  if (s < 2 * L) return { x: L - s, z: -r, yaw: Math.PI };
  s -= 2 * L;
  if (s < Math.PI * RC) {
    const th = -Math.PI / 2 - s / RC;
    return { x: -L + Math.cos(th) * r, z: Math.sin(th) * r, yaw: Math.PI / 2 - th };
  }
  s -= Math.PI * RC;
  return { x: -L + s, z: r, yaw: 0 };
}

// Bends: 0 on the straights, 1 through the curves, eased over ~20 m at the
// entry and exit. Used by the CPU drivers to pick lines and nitro moments.
const BENDS = [[L, L + Math.PI * RC], [3 * L + Math.PI * RC, 3 * L + 2 * Math.PI * RC]];
export function curveAt(s) {
  s = wrap(s, PERIM);
  let v = 0;
  for (const [a, b] of BENDS) v = Math.max(v, Math.min(1, Math.max(0, (Math.min(s - a, b - s) + 10) / 20)));
  return v;
}
export { wrapSigned };

export const onTrack = (x, z) => {
  const d = trackDistance(x, z);
  return d > -3 && d < W + 4;
};

export class RaceTracker {
  constructor() { this.reset(0); }

  reset(time, startS = 3) {
    this.s = startS;
    this.prevS = startS;
    this.lastCp = 0; // the start line counts as passed
    this.lapsDone = 0;
    this.lapStart = time;
    this.raceStart = time;
    this.lapTimes = [];
    this.best = Infinity;
    this.finished = false;
    this.finishTime = 0;
    this.wrongWay = 0;
    this.progress = startS;
  }

  start(time) {
    this.lapStart = time;
    this.raceStart = time;
  }

  // Returns 'lap' | 'finish' | null when something notable happens.
  update(pos, time, dt) {
    if (this.finished) return null;
    const s = trackParam(pos.x, pos.z);
    const ds = wrapSigned(s - this.prevS);
    const on = onTrack(pos.x, pos.z);
    let event = null;
    if (on && Math.abs(ds) < 30) {
      const next = (this.lastCp + 1) % CHECKPOINTS;
      const target = CP[next];
      const ahead = wrapSigned(target - this.prevS);
      if (ds > 0 && ahead >= 0 && ahead <= ds) {
        this.lastCp = next;
        if (next === 0) {
          this.lapsDone++;
          const lapTime = time - this.lapStart;
          this.lapTimes.push(lapTime);
          this.best = Math.min(this.best, lapTime);
          this.lapStart = time;
          if (this.lapsDone >= LAPS) {
            this.finished = true;
            this.finishTime = time - this.raceStart;
            event = 'finish';
          } else event = 'lap';
        }
      }
      this.wrongWay = ds < -0.05 ? this.wrongWay + dt : Math.max(0, this.wrongWay - dt * 2);
    }
    this.prevS = s;
    this.s = s;
    // ranking metric: completed laps + distance past the last checkpoint
    const past = Math.max(0, Math.min(PERIM / CHECKPOINTS * 1.5, wrap(s - CP[this.lastCp], PERIM)));
    this.progress = this.lapsDone * PERIM + CP[this.lastCp] + (this.lastCp === 0 && this.lapsDone === 0 && s > PERIM / 2 ? 0 : past);
    if (this.finished) this.progress = LAPS * PERIM + 1e6 - this.finishTime;
    return event;
  }

  get lap() { return Math.min(LAPS, this.lapsDone + 1); }
}
