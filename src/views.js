// A render view: camera + post-processing chain drawing into a rectangle of
// the canvas. Solo uses one full-screen view; the duel uses two side by side.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FinalShader } from './fx.js';

export class View {
  constructor(renderer, scene, { dpr = 1, aoHidden = [] } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.dpr = dpr;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    this.camPos = new THREE.Vector3(4, 3, 2);
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.shake = 0;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };

    const rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, 4, 4);
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 16 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
    // AO only for solid geometry: hide sprites, decals, glows for that pass
    const gtaoRender = this.gtao.render.bind(this.gtao);
    this.gtao.render = (...args) => {
      const vis = aoHidden.map((o) => o.visible);
      for (const o of aoHidden) o.visible = false;
      gtaoRender(...args);
      aoHidden.forEach((o, i) => { o.visible = vis[i]; });
    };
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.28, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }

  // rect in CSS pixels, origin bottom-left (WebGL convention)
  setRect(x, y, w, h) {
    if (!(w > 0 && h > 0)) return; // minimised / mid-resize: keep the last good size
    if (this.rect.w === w && this.rect.h === h && this.rect.x === x && this.rect.y === y) return;
    this.rect = { x, y, w, h };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.final.uniforms.uAspect.value = w / h;
  }

  // Apply a graphics preset (see quality.js). Render targets are only
  // reallocated when something that affects them actually changes.
  applyPreset(preset, split) {
    const key = `${preset.name}-${split}`;
    if (this.presetKey === key) return;
    this.presetKey = key;
    const scale = Math.max(0.5, this.dpr * preset.scale);
    this.composer.setPixelRatio(scale);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== preset.msaa) { rt.samples = preset.msaa; rt.dispose(); }
    }
    this.gtao.enabled = preset.ao;
    this.gtao.updateGtaoMaterial({ samples: split ? Math.min(8, preset.aoSamples) : preset.aoSamples });
    this.bloom.enabled = preset.bloom;
    const { w, h } = this.rect;
    this.rect = { x: -1, y: -1, w: 0, h: 0 };
    if (w > 0) this.setRect(0, 0, w, h);
  }

  render(before) {
    const { x, y, w, h } = this.rect;
    before?.(this);
    const r = this.renderer;
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.setScissorTest(true);
    this.composer.render();
  }

  // Project a world point into page pixels (for score popups).
  toScreen(p, out = { x: 0, y: 0, visible: false }) {
    const v = p.clone().project(this.camera);
    out.visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
    out.x = this.rect.x + (v.x * 0.5 + 0.5) * this.rect.w;
    out.y = innerHeight - (this.rect.y + (v.y * 0.5 + 0.5) * this.rect.h);
    return out;
  }
}
