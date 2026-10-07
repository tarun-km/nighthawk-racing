// Player settings, remembered on this device.
const KEY = 'nh-settings';
export const DEFAULTS = {
  quality: 'auto', // auto | low | medium | high
  shake: true,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  music: 0.7,
  sfx: 0.8,
  stats: false,
  autoGas: true, // touch: accelerate automatically, BRAKE to slow down
  haptics: true,
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

export const settings = { ...DEFAULTS, ...load() };

const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); }
export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  for (const fn of listeners) fn(key, value);
}
