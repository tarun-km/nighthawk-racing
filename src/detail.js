// Geometry detail tier, chosen once at boot (geometry is built once).
// High on desktop-class GPUs or when the player picked High quality; Medium on
// integrated / mobile GPUs or Medium quality; Low for software rendering or
// the Low preset. seg() scales a segment count for the tier.
import { settings } from './settings.js';

function gpuTier() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
    if (/mali|adreno|powervr|apple gpu|intel|uhd graphics|iris/i.test(name)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

// Phones and small tablets: touch-first and a small screen.
export const MOBILE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 900;

export const DETAIL = ['low', 'medium', 'high'].includes(settings.quality) ? settings.quality : MOBILE ? 'low' : gpuTier();
const MULT = { low: 0.6, medium: 1, high: 1.6 }[DETAIL];
export const seg = (n, min = 6) => Math.max(min, Math.round(n * MULT));
