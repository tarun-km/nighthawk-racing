// Graphics presets and the Auto controller.
// Render scale multiplies the (capped) device pixel ratio for the 3D scene;
// the HTML UI always renders at native resolution.
export const PRESETS = {
  low: { name: 'Low', scale: 0.62, msaa: 0, ao: false, aoSamples: 8, bloom: false, shadow: 1024, crowd: 0.45, particles: 0.5 },
  medium: { name: 'Medium', scale: 0.85, msaa: 2, ao: true, aoSamples: 8, bloom: true, shadow: 2048, crowd: 0.75, particles: 0.8 },
  high: { name: 'High', scale: 1, msaa: 4, ao: true, aoSamples: 16, bloom: true, shadow: 2048, crowd: 1, particles: 1 },
};
export const LEVELS = ['low', 'medium', 'high'];

// Watches frame times and steps quality down quickly when frames are slow,
// up slowly when there's headroom. Cooldowns stop it oscillating.
export class AutoQuality {
  constructor(start = 'medium') {
    this.level = start;
    this.samples = [];
    this.cooldown = 4;
    this.goodWindows = 0;
  }

  // ms: interval between rendered frames. Returns a new level or null.
  sample(ms, dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (ms > 250) return null; // tab hidden / stalled: not a performance signal
    this.samples.push(ms);
    if (this.samples.length < 90) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.samples.length = 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const i = LEVELS.indexOf(this.level);
    if (this.cooldown > 0) return null;
    if (p95 > 21 && i > 0) {
      this.goodWindows = 0;
      this.cooldown = 6;
      return (this.level = LEVELS[i - 1]);
    }
    if (p95 < 12.5 && i < LEVELS.length - 1) {
      if (++this.goodWindows >= 4) {
        this.goodWindows = 0;
        this.cooldown = 10;
        return (this.level = LEVELS[i + 1]);
      }
    } else this.goodWindows = 0;
    return null;
  }
}

// Rolling frame statistics for the diagnostics overlay.
export class FrameStats {
  constructor(n = 300) { this.n = n; this.buf = []; }
  push(v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); }
  pct(p) {
    if (!this.buf.length) return 0;
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }
}
