// Keyboard, gamepads and touch, exposed as per-player controllers.
//   P1 Blue: W A S D, Left Shift = nitro, Space = drift, E or Q = power-up
//   P2 Red : Arrow keys, Right Shift or / = nitro, Right Ctrl or . = drift,
//            Enter or Numpad 1 = power-up
// Solo play accepts either key set, touch and any gamepad.
const BINDINGS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], boost: ['ShiftLeft'], drift: ['Space'], fire: ['KeyE', 'KeyQ'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], boost: ['ShiftRight', 'Slash', 'Numpad0'], drift: ['ControlRight', 'Period', 'NumpadDecimal'], fire: ['Enter', 'NumpadEnter', 'Numpad1'] },
];
const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Period']);
const DEAD = 0.18;

export class Input {
  constructor() {
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.touchBoost = false;
    this.touchDrift = false;
    this.touchFire = false;
    this.touchBrake = false;
    // touch play: the car accelerates by itself, BRAKE slows / reverses
    this.touch = false;
    this.autoGas = true;
    this.listeners = {};
    this.mode = 'solo';

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) this.listeners[e.code]?.forEach((fn) => fn(e));
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());

    // Gamepads are owned by player slot using the pad's stable index, not
    // its position in the connected list (which shifts when pads drop out).
    this.slots = [null, null];
    this.onPad = null; // (playerIndex, connected) => void
    addEventListener('gamepadconnected', (e) => {
      const i = this.slots.findIndex((sl) => sl && sl.index === e.gamepad.index);
      if (i >= 0) { this.slots[i].lost = false; this.onPad?.(i, true); return; }
      const free = this.slots.findIndex((sl) => sl === null);
      if (free >= 0 && (this.mode === 'duel' || free === 0)) this.slots[free] = { index: e.gamepad.index, lost: false };
    });
    addEventListener('gamepaddisconnected', (e) => {
      const i = this.slots.findIndex((sl) => sl && sl.index === e.gamepad.index);
      if (i >= 0) { this.slots[i].lost = true; this.onPad?.(i, false); }
    });

    this.players = [0, 1].map((i) => this.#controller(i));
  }

  // Bind connected pads to players at the start of a race.
  assignPads() {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean).sort((a, b) => a.index - b.index);
    const want = this.mode === 'duel' ? 2 : 1;
    this.slots = [0, 1].map((i) => (i < want && pads[i] ? { index: pads[i].index, lost: false } : null));
  }

  clear() {
    this.keys.clear();
    this.stick.x = this.stick.y = 0;
    this.touchBoost = this.touchDrift = this.touchFire = this.touchBrake = false;
  }

  on(code, fn) {
    (this.listeners[code] ??= []).push(fn);
  }

  #any(codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  #pad(i) {
    const sl = this.slots[i];
    if (!sl || sl.lost) return null;
    return navigator.getGamepads?.()[sl.index] ?? null;
  }

  #controller(i) {
    const self = this;
    const binds = () => (self.mode === 'solo' && i === 0 ? [BINDINGS[0], BINDINGS[1]] : [BINDINGS[i]]);
    const key = (name) => binds().some((b) => self.#any(b[name]));
    return {
      get throttle() {
        let t = (key('up') ? 1 : 0) - (key('down') ? 1 : 0);
        const p = self.#pad(i);
        if (p) t += (p.buttons[7]?.value ?? 0) - (p.buttons[6]?.value ?? 0);
        if (i === 0 && self.touch) t += self.touchBrake ? -1 : self.autoGas ? 1 : -self.stick.y;
        else if (i === 0) t -= self.stick.y;
        return Math.max(-1, Math.min(1, t));
      },
      get steer() {
        let s = (key('left') ? 1 : 0) - (key('right') ? 1 : 0);
        const p = self.#pad(i);
        if (p) {
          const ax = p.axes[0] ?? 0;
          if (Math.abs(ax) > DEAD) s -= Math.sign(ax) * (Math.abs(ax) - DEAD) / (1 - DEAD);
        }
        if (i === 0) s -= self.stick.x;
        return Math.max(-1, Math.min(1, s));
      },
      get boost() {
        const p = self.#pad(i);
        return key('boost') || !!p?.buttons[0]?.pressed || (i === 0 && self.touchBoost);
      },
      get handbrake() {
        const p = self.#pad(i);
        return key('drift') || !!p?.buttons[1]?.pressed || !!p?.buttons[2]?.pressed || (i === 0 && self.touchDrift);
      },
      get fire() {
        const p = self.#pad(i);
        return key('fire') || !!p?.buttons[3]?.pressed || !!p?.buttons[5]?.pressed || !!p?.buttons[4]?.pressed || (i === 0 && self.touchFire);
      },
    };
  }

  // Legacy single-player view (menu code paths).
  get throttle() { return this.players[0].throttle; }
  get steer() { return this.players[0].steer; }
  get boost() { return this.players[0].boost; }
  get handbrake() { return this.players[0].handbrake; }

  bindTouch(stickEl, knobEl, boostEl, driftEl, fireEl, brakeEl) {
    let id = null;
    const move = (e) => {
      const t = [...e.changedTouches].find((t) => t.identifier === id);
      if (!t) return;
      const r = stickEl.getBoundingClientRect();
      const R = r.width * 0.32; // knob travel scales with the stick's size
      let x = t.clientX - (r.left + r.width / 2);
      let y = t.clientY - (r.top + r.height / 2);
      const len = Math.hypot(x, y);
      if (len > R) { x = (x / len) * R; y = (y / len) * R; }
      knobEl.style.transform = `translate(${x}px, ${y}px)`;
      this.stick.x = x / R;
      this.stick.y = y / R;
      e.preventDefault();
    };
    const end = (e) => {
      if (![...e.changedTouches].some((t) => t.identifier === id)) return;
      id = null;
      this.stick.x = this.stick.y = 0;
      knobEl.style.transform = '';
    };
    stickEl.addEventListener('touchstart', (e) => { id = e.changedTouches[0].identifier; move(e); }, { passive: false });
    stickEl.addEventListener('touchmove', move, { passive: false });
    stickEl.addEventListener('touchend', end);
    stickEl.addEventListener('touchcancel', end);

    const hold = (el, key) => {
      const set = (v) => (e) => { this[key] = v; el.classList.toggle('is-down', v); e.preventDefault(); };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false));
      el.addEventListener('touchcancel', set(false));
    };
    hold(boostEl, 'touchBoost');
    hold(driftEl, 'touchDrift');
    if (fireEl) hold(fireEl, 'touchFire');
    if (brakeEl) hold(brakeEl, 'touchBrake');
  }
}
