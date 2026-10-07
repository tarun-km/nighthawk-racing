// Audio (Web Audio API): the Hawk Racing soundtrack as a shuffled, crossfaded
// playlist, plus a synthesized engine drone and pickup effects.
const TRACKS = ['/audio/full-throttle-apex.mp3', '/audio/midnight-pursuit.mp3', '/audio/obsidian-pursuit.mp3'];
const MUSIC_LEVEL = { race: 0.62, menu: 0.38, pause: 0.14 };
const CROSSFADE = 3; // seconds

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('nh-muted') === '1'; } catch {}
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);
    // effects + engine share a bus so they have their own volume
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol ?? 0.8;
    this.sfxBus.connect(this.master);

    // Engine: detuned saws through a lowpass whose cutoff follows RPM.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 6;
    this.oscs = [0, 7, -12].map((detune, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.detune.value = detune;
      o.frequency.value = 50;
      o.connect(this.engineFilter);
      o.start();
      return o;
    });
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = MUSIC_LEVEL.menu;
    this.musicGain.connect(this.master);
    this.#startPlaylist();
  }

  // ---------- Soundtrack ----------
  #startPlaylist() {
    this.order = [...TRACKS].sort(() => Math.random() - 0.5);
    this.trackIdx = -1;
    this.#nextTrack();
  }

  // Jump straight to one track (the trailer), then carry on with the playlist.
  playTrack(url) {
    if (!this.ctx) return;
    const i = this.order.indexOf(url);
    if (i < 0) return;
    this.current?.handOff(true);
    this.trackIdx = i - 1;
    this.#nextTrack(0.05);
  }

  #nextTrack(fadeIn = CROSSFADE / 4) {
    const ctx = this.ctx;
    this.trackIdx = (this.trackIdx + 1) % this.order.length;
    const el = document.createElement('audio');
    el.src = this.order[this.trackIdx];
    el.preload = 'auto';
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.musicGain);
    el.play().catch(() => {});
    g.gain.setTargetAtTime(1, ctx.currentTime, fadeIn);
    let handedOff = false;
    const handOff = (silent = false) => {
      if (handedOff) return;
      handedOff = true;
      g.gain.setTargetAtTime(0, ctx.currentTime, silent ? 0.08 : CROSSFADE / 4);
      if (!silent) this.#nextTrack();
      setTimeout(() => { el.pause(); src.disconnect(); g.disconnect(); }, silent ? 600 : CROSSFADE * 1000 + 500);
    };
    this.current = { handOff };
    el.addEventListener('timeupdate', () => {
      if (el.duration && el.duration - el.currentTime < CROSSFADE) handOff();
    });
    el.addEventListener('ended', handOff);
    el.addEventListener('error', handOff);
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('nh-muted', m ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  engine(speedNorm, throttle, boosting, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + speedNorm * 120 + (boosting ? 30 : 0);
    this.oscs.forEach((o) => o.frequency.setTargetAtTime(f, t, 0.08));
    this.engineFilter.frequency.setTargetAtTime(260 + speedNorm * 1600 + Math.abs(throttle) * 400 + (boosting ? 900 : 0), t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + Math.abs(throttle) * 0.05 + speedNorm * 0.04 : 0.025, t, 0.1);
  }

  // mode: 'race' | 'menu' | 'pause' (booleans map to race / menu)
  music(mode) {
    const key = mode === true ? 'race' : mode === false ? 'menu' : mode;
    this.musicMode = key;
    if (!this.ctx) return;
    const vol = (this.musicVol ?? 0.7) / 0.7;
    this.musicGain.gain.setTargetAtTime((MUSIC_LEVEL[key] ?? MUSIC_LEVEL.menu) * vol, this.ctx.currentTime, 0.5);
  }

  setVolumes(music, sfx) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.music(this.musicMode ?? 'menu');
  }

  // Kept for the main loop; the soundtrack streams on its own.
  tick() {}

  #note(midi, when, dur, type, vol, dest, cutoff = 4000) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  #noise(when, dur, vol, dest, hp) {
    const ctx = this.ctx;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(when);
    s.stop(when + dur + 0.02);
  }

  sfx(type) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.sfxBus;
    switch (type) {
      case 'can': this.#note(84, t, 0.12, 'square', 0.15, m); this.#note(91, t + 0.06, 0.16, 'square', 0.12, m); break;
      case 'bolt': [76, 83, 88].forEach((n, i) => this.#note(n, t + i * 0.05, 0.14, 'sawtooth', 0.12, m, 5000)); break;
      case 'wings': [72, 76, 79, 84, 88].forEach((n, i) => this.#note(n, t + i * 0.06, 0.3, 'triangle', 0.2, m)); break;
      case 'crate': this.#noise(t, 0.25, 0.5, m, 300); this.#note(40, t, 0.2, 'square', 0.25, m, 600); break;
      case 'count': this.#note(72, t, 0.18, 'square', 0.15, m); break;
      case 'go': this.#note(84, t, 0.4, 'square', 0.18, m); break;
      case 'end': [84, 79, 76, 72].forEach((n, i) => this.#note(n, t + i * 0.1, 0.3, 'triangle', 0.2, m)); break;
      case 'tick': this.#note(96, t, 0.04, 'square', 0.06, m); break;
      case 'item': [79, 86, 91].forEach((n, i) => this.#note(n, t + i * 0.045, 0.16, 'triangle', 0.16, m)); break;
      case 'fire': this.#noise(t, 0.35, 0.35, m, 1200); this.#note(64, t, 0.3, 'sawtooth', 0.12, m, 2400); break;
      case 'hit': this.#noise(t, 0.5, 0.7, m, 120); this.#note(36, t, 0.4, 'square', 0.3, m, 500); break;
      case 'shield': [91, 96].forEach((n, i) => this.#note(n, t + i * 0.07, 0.25, 'sine', 0.18, m)); break;
      case 'turbo': this.#noise(t, 0.6, 0.3, m, 600); [60, 67, 72].forEach((n, i) => this.#note(n, t + i * 0.05, 0.3, 'sawtooth', 0.1, m, 3000)); break;
    }
  }
}
