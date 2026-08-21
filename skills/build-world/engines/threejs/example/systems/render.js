import * as THREE from 'three';
import { compileMeshes, Owned } from '../../lib/index.js';

/**
 * The render system owns the renderer and NOTHING ELSE owns it. Every other
 * subsystem reaches it through `ctx.get('render')` and uses the exposed API.
 * That single rule is why a renderer rewrite does not touch eleven directories.
 *
 * This example is deliberately a plain forward renderer — the kit is about the
 * process, not about a specific pipeline. What matters is the SHAPE:
 *   - one owner for renderer state
 *   - a public surface other systems are allowed to use
 *   - resize() handled here, once
 *   - prewarmMaterials() so nothing compiles during play
 *   - resetTemporal() so the capture harness can start accumulators from a known
 *     phase (a no-op here; real pipelines with TAA need it)
 */
export class RenderSystem {
  static id = 'render';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.own = new Owned();
    const q = ctx.config.q;

    const renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: !q.postAa, // MSAA only when we are not doing post AA
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!renderer.capabilities.isWebGL2) throw new Error('[render] WebGL2 is required');
    // In capture mode the harness controls the shutter, and info must not be
    // auto-reset or per-frame draw-call counts are unreadable.
    renderer.info.autoReset = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ctx.config.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = this.own.add(renderer);

    // renderScale is a QUALITY knob, not an art knob: same image, fewer pixels.
    this.scale = q.renderScale;

    /** Sun. Owned here because shadow-cascade fitting is a renderer concern. */
    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = q.shadowDistance;
    const ext = 30;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    // A shadow bias that is right for one map size is wrong for another.
    this.sun.shadow.bias = -0.0006 * (2048 / q.shadowMapSize);
    this.sun.shadow.normalBias = 0.02;
    ctx.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fc2e8, 0x54463a, 0.55);
    ctx.scene.add(this.hemi);

    ctx.scene.fog = new THREE.FogExp2(0x9db6cc, 0.008);

    // Preallocated: lateUpdate runs every frame and must not allocate.
    this._sunDir = new THREE.Vector3();
    this.timeOfDay = 16.5;
    this.setTimeOfDay(this.timeOfDay);
  }

  /** Public API. Other systems use these; they never touch this.renderer state
   *  outside of a frame. */
  get screenSize() {
    return { width: this._w ?? 1, height: this._h ?? 1 };
  }

  /** Sky/lighting hook the shot list drives via `shot.time`. Deterministic: a
   *  pure function of the hour, with no reference to wall-clock time. */
  setTimeOfDay(hour) {
    this.timeOfDay = hour;
    const t = ((hour - 6) / 12) * Math.PI; // 6h = sunrise, 18h = sunset
    const elev = Math.sin(t);
    const day = Math.max(0, elev);
    this.sun.position.set(Math.cos(t) * 60, Math.max(-10, elev * 60), 24);
    this.sun.intensity = 0.4 + 13.0 * day;
    this.sun.color.setHSL(0.09 - 0.04 * (1 - day), 0.55 - 0.35 * day, 0.5);
    this.hemi.intensity = 0.30 + 2.40 * day;
    this.hemi.color.setHSL(0.58, 0.45, 0.25 + 0.35 * day);
    this.hemi.groundColor.setHSL(0.09, 0.25, 0.1 + 0.15 * day);
    const fog = this.ctx.scene.fog;
    if (fog) {
      fog.color.setHSL(0.58, 0.35 - 0.2 * day, 0.05 + 0.5 * day);
      fog.density = 0.006 + 0.006 * (1 - day);
    }
    this.ctx.scene.background = fog?.color.clone() ?? null;
    return hour;
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
    // The cap is a BUDGET from the preset, not a constant. A phone reports DPR 3
    // and will happily be asked for 3.5x the pixels of a 1080p laptop; capping
    // here is the single highest-value mobile optimisation and it costs one
    // line. See lib/config.js.
    const cap = this.ctx.config.q.maxPixelRatio ?? 2;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap) * this.scale);
    this.renderer.setSize(w, h, false);
  }

  /** Keep the shadow frustum around the camera, snapped to texels. Un-snapped
   *  fitting makes shadow edges crawl as you walk, which reviewers report as
   *  "flickering shadows" and is a two-line fix. */
  lateUpdate(dt, ctx) {
    const cam = ctx.camera;
    this.sun.target.position.set(cam.position.x, 0, cam.position.z);
    const dir = this._sunDir.copy(this.sun.position).normalize().multiplyScalar(60);
    this.sun.position.copy(this.sun.target.position).add(dir);
    const texel = (2 * 30) / ctx.config.q.shadowMapSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.target.updateMatrixWorld();
  }

  render(ctx) {
    const r = this.renderer;
    r.render(ctx.scene, ctx.camera);
    // The overlay pass exists so held/attached geometry cannot clip into the
    // world. Skip it entirely when nothing is in there — an empty pass still
    // costs a clear and a state change.
    if (ctx.overlayScene.children.length) {
      r.clearDepth();
      r.render(ctx.overlayScene, ctx.overlayCamera);
    }
  }

  /** No temporal accumulation in this example. Real pipelines: drop TAA history,
   *  snap auto-exposure to its target, reset any velocity buffer. */
  resetTemporal() {
    return true;
  }

  /**
   * Compile the forward+shadow variants of everything currently in the scene.
   * `compileMeshes` binds a 1x1 target first — see lib/prewarm.js trap #1.
   */
  async prewarmMaterials(ctx) {
    const meshes = [];
    ctx.scene.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    const compiled = compileMeshes(this.renderer, meshes, ctx.scene, ctx.camera);
    return { ok: true, compiled, meshes: meshes.length };
  }

  dispose() {
    this.own.disposeAll();
  }
}
