import * as THREE from 'three';
import { Registry, EventBus } from './registry.js';
import { FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_DT } from './config.js';
import { Rng } from './rng.js';

/**
 * The Engine owns the frame loop and the `ctx` object every subsystem receives.
 * It knows NOTHING about any subsystem — it only sequences them. Every
 * game-specific decision lives in a subsystem, which is what makes one owner
 * able to rewrite one directory without reading the rest.
 *
 * Frame order — deliberate, and worth keeping:
 *   1. input.beginFrame()      snapshot; gameplay never touches DOM events
 *   2. fixedUpdate(FIXED_DT)*N physics / deterministic simulation
 *   3. update(dt)              animation, cameras, decisions
 *   4. lateUpdate(dt)          anything that must observe FINAL transforms
 *   5. render                  the 'render' system draws
 *   6. input.endFrame()        clear per-frame edges
 *
 * `time.alpha` is the interpolation factor between the last two fixed steps.
 * Render transforms from interpolated state, or everything visibly ticks at the
 * physics rate instead of the display rate.
 */
export class Engine {
  constructor({ canvas, config, input = null }) {
    this.canvas = canvas;
    this.config = config;
    this.registry = new Registry();
    this.events = new EventBus();
    this.input = input;
    this.rng = new Rng(
      config.deterministic ? (config.seed ?? 0x5eed1234) : (config.seed ?? (Math.random() * 2 ** 32) >>> 0)
    );

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 1200);
    // YXZ so yaw/pitch can be set directly without gimbal surprises.
    this.camera.rotation.order = 'YXZ';

    /**
     * A second scene+camera drawn after the world with a cleared depth buffer,
     * with its own near plane. Use it for anything held by / attached to the
     * viewer that must never clip into world geometry: a first-person weapon or
     * tool, a held item, a cockpit interior, a card in hand. Leave it empty and
     * the render system should skip the pass entirely.
     */
    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.PerspectiveCamera(60, 1, 0.005, 12);

    this.time = {
      /** Scaled seconds since start. THE clock. Animate off this, never off
       *  performance.now() — see PITFALLS.md #1. */
      elapsed: 0,
      /** Unscaled seconds since start. For UI timers that ignore slow motion. */
      raw: 0,
      /** Last frame delta, scaled and clamped. */
      dt: 0,
      fixed: FIXED_DT,
      /** 0..1 between the last two fixed steps. */
      alpha: 0,
      scale: 1,
      /** Monotonic frame index. Phase noise/jitter off this, not off wall time. */
      frame: 0,
    };

    this.ctx = {
      engine: this,
      scene: this.scene,
      camera: this.camera,
      overlayScene: this.overlayScene,
      overlayCamera: this.overlayCamera,
      canvas,
      config,
      events: this.events,
      input: this.input,
      time: this.time,
      rng: this.rng,
      get: (id) => this.registry.get(id),
      peek: (id) => this.registry.peek(id),
      has: (id) => this.registry.has(id),
    };

    this._accum = 0;
    this._last = 0;
    this._running = false;
    this._onResize = () => this.resize();
  }

  add(SystemClass, opts) {
    this.registry.add(new SystemClass(opts));
    return this;
  }

  /** init() in dependency order. Logs anything slow, because boot time is a
   *  budget too and you want to know which system spent it. */
  async init() {
    const order = this.registry.resolve();
    this.bootMarks = [];
    for (const sys of order) {
      const t0 = performance.now();
      await sys.init?.(this.ctx);
      const ms = performance.now() - t0;
      this.bootMarks.push({ id: sys.constructor.id, ms: +ms.toFixed(1) });
      if (ms > 50) console.info(`[engine] ${sys.constructor.id} init ${ms.toFixed(0)}ms`);
    }
    this.input?.attach?.();
    addEventListener('resize', this._onResize);
    this.resize();
    return this;
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlayCamera.aspect = w / h;
    this.overlayCamera.updateProjectionMatrix();
    for (const sys of this.registry.with('resize')) sys.resize(w, h, this.ctx);
    this.events.emit('resize', { width: w, height: h });
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  stop() {
    this._running = false;
  }

  _loop(now) {
    if (!this._running) return;
    // Schedule first: an exception in step() must not kill the loop silently.
    requestAnimationFrame(this._loop);
    this.step(now);
  }

  /** Advance exactly one frame. Public so the capture harness can hand-pump
   *  frames (lib/shots.js lockstep mode) instead of racing rAF. */
  step(now = performance.now()) {
    const t = this.time;
    const rawDt = Math.min(MAX_FRAME_DT, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    t.raw += rawDt;
    t.dt = rawDt * t.scale;
    t.elapsed += t.dt;
    t.frame++;

    this.input?.beginFrame?.();

    this._accum += t.dt;
    let steps = 0;
    const fixedSystems = this.registry.with('fixedUpdate');
    while (this._accum >= FIXED_DT && steps < MAX_SUBSTEPS) {
      for (const sys of fixedSystems) sys.fixedUpdate(FIXED_DT, this.ctx);
      this._accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this._accum = 0; // shed the backlog, don't spiral
    t.alpha = this._accum / FIXED_DT;

    for (const sys of this.registry.with('update')) sys.update(t.dt, this.ctx);
    for (const sys of this.registry.with('lateUpdate')) sys.lateUpdate(t.dt, this.ctx);

    const renderSystem = this.registry.peek('render');
    if (typeof renderSystem?.render === 'function') renderSystem.render(this.ctx);

    this.input?.endFrame?.();
  }

  dispose() {
    this.stop();
    removeEventListener('resize', this._onResize);
    this.input?.detach?.();
    // Reverse dependency order: a system's dependencies outlive it.
    for (const sys of [...this.registry.ordered].reverse()) sys.dispose?.();
    this.events.clear();
  }
}

/**
 * Boot helper: does the five things every main.js needs and nothing else.
 * Shows the failure on screen — a black canvas with the error only in devtools
 * costs an agent a whole capture cycle to diagnose.
 */
export async function boot(engine, { onError } = {}) {
  try {
    await engine.init();
    return engine;
  } catch (err) {
    console.error('[boot] init failed', err);
    onError?.(err);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
         font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap"
       >BOOT FAILURE\n\n${String(err?.stack ?? err?.message ?? err)}</pre>`
    );
    throw err;
  }
}
