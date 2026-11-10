# The three.js kit (`lib/`)

Plain browser modules, one per section below. Each heading is the file's path in the game: write the ones you use into `files` at that path, unchanged (`lib/index.js` re-exports them all, so include every module it imports, or import the modules directly). The table in [threejs.md](threejs.md) says what each one is for.

## `lib/config.js`

```js
/**
 * One place for tuning and quality. Subsystems read `ctx.config` instead of
 * hardcoding numbers, so the quality scaler, the capture harness and the
 * profiler can all drive the whole game from a single object.
 *
 * Rule: if a subsystem has a magic number that a reviewer might want to change,
 * it belongs here or in that subsystem's own exported constants — never inline
 * in the middle of an update().
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many fixed steps in one frame. Without this a
 *  slow frame makes the next frame slower, forever (the "spiral of death"). */
export const MAX_SUBSTEPS = 8;
/** Longest frame delta the simulation will accept. A tab switch or a debugger
 *  pause otherwise teleports everything. */
export const MAX_FRAME_DT = 0.1;

/**
 * Quality presets. Every entry is a BUDGET or a FEATURE FLAG, never a
 * brightness/scale fudge — a preset must change cost, not art direction.
 * Subsystems must honour the budgets and must never exceed them.
 *
 * `maxPixelRatio` is the one that decides whether a phone can run the game at
 * all, and it is the easiest to get wrong because desktop hides it: a phone
 * reports devicePixelRatio 3, so an uncapped renderer draws roughly 3.5x the
 * pixels of a 1080p laptop on a fraction of the GPU. Resolution, not geometry,
 * is what costs the frames — see threejs.md, Performance doctrine.
 */
export const QUALITY_PRESETS = {
  low: {
    maxPixelRatio: 1.5,
    renderScale: 0.72,
    shadowMapSize: 1024,
    shadowDistance: 60,
    cascades: 2,
    postAa: false,
    ao: false,
    reflections: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    anisotropy: 4,
    particleBudget: 2000,
    decalBudget: 64,
    maxDynamicLights: 4,
  },
  medium: {
    maxPixelRatio: 2,
    renderScale: 0.85,
    shadowMapSize: 2048,
    shadowDistance: 90,
    cascades: 3,
    postAa: true,
    ao: true,
    reflections: false,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 8,
    particleBudget: 6000,
    decalBudget: 128,
    maxDynamicLights: 8,
  },
  high: {
    maxPixelRatio: 2,
    renderScale: 1.0,
    shadowMapSize: 2048,
    shadowDistance: 140,
    cascades: 4,
    postAa: true,
    ao: true,
    reflections: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 12000,
    decalBudget: 256,
    maxDynamicLights: 12,
  },
  ultra: {
    maxPixelRatio: 2,
    renderScale: 1.0,
    shadowMapSize: 4096,
    shadowDistance: 200,
    cascades: 4,
    postAa: true,
    ao: true,
    reflections: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 24000,
    decalBudget: 512,
    maxDynamicLights: 16,
  },
};

export const DEFAULTS = {
  quality: 'high',
  fov: 70,
  exposure: 1.0,
  sensitivity: 0.0022,
  /** Set by the capture harness. Disables everything nondeterministic: seeds the
   *  RNG from a constant, freezes input, fixes the frame delta. */
  deterministic: false,
  /** Compile every shader permutation before the first frame. See lib/prewarm.js. */
  prewarm: true,
};

/**
 * Pick a starting preset for the device this is running on.
 *
 * Coarse on purpose. There is no reliable way to ask a browser how fast its GPU
 * is, and every attempt to infer it from the UA string ages badly, so this only
 * separates handheld from not: a phone or tablet starts at `low`, everything
 * else at `high`. A game that wants better should measure the first few seconds
 * of real frame time and call `config.setQuality()` — a running frame rate is
 * the only honest signal, and it is available to every game for free.
 */
export function autoQuality(fallback = 'high') {
  if (typeof matchMedia !== 'function') return fallback;
  const handheld = matchMedia('(hover: none) and (pointer: coarse)').matches;
  return handheld ? 'low' : fallback;
}

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  const name = QUALITY_PRESETS[cfg.quality] ? cfg.quality : DEFAULTS.quality;
  cfg.quality = name;
  cfg.q = { ...QUALITY_PRESETS[name] };
  cfg.setQuality = (next) => {
    if (!QUALITY_PRESETS[next]) throw new Error(`unknown quality preset "${next}"`);
    cfg.quality = next;
    // Mutate in place: subsystems are allowed to hold a reference to cfg.q.
    Object.assign(cfg.q, QUALITY_PRESETS[next]);
  };
  return cfg;
}

/** Read config out of the URL, so every tool can drive the game without a UI:
 *  ?capture=1&lockstep=1&q=low&shot=hero&prewarm=0&seed=12345 */
export function configFromLocation(search = globalThis.location?.search ?? '') {
  const p = new URLSearchParams(search);
  const capture = p.get('capture') === '1';
  return {
    params: p,
    capture,
    lockstep: capture && p.get('lockstep') === '1',
    shot: p.get('shot') ?? null,
    config: createConfig({
      // No ?q= -> pick by device, so a phone opening a shared link is not
      // handed the desktop preset. Capture pins `high` instead: the pixel gate
      // compares runs against each other, and a preset that varies by machine
      // would make every diff meaningless.
      quality: p.get('q') ?? (capture ? DEFAULTS.quality : autoQuality()),
      deterministic: capture,
      prewarm: p.get('prewarm') !== '0',
      seed: p.get('seed') ? Number(p.get('seed')) >>> 0 : undefined,
    }),
  };
}
```

## `lib/dispose.js`

```js
/**
 * Disposal. WebGL resources are not garbage collected — a geometry, material,
 * texture or render target you drop the last reference to stays on the GPU until
 * you call dispose(). Two symptoms in practice: VRAM climbing over a session,
 * and (with HMR) each reload leaking a whole scene's worth of textures until the
 * context is lost and the page goes black mid-iteration.
 *
 * Every subsystem's dispose() should be able to be written as:
 *   dispose() { disposeTree(this.root); this.root.parent?.remove(this.root); }
 */

/** Dispose one material and every texture it references. */
export function disposeMaterial(material) {
  if (!material) return 0;
  let n = 0;
  for (const key of Object.keys(material)) {
    const v = material[key];
    if (v && v.isTexture) {
      v.dispose();
      n++;
    }
  }
  // Uniforms of a ShaderMaterial / patched material hold textures too.
  const u = material.uniforms;
  if (u) {
    for (const k of Object.keys(u)) {
      const v = u[k]?.value;
      if (v && v.isTexture) {
        v.dispose();
        n++;
      }
    }
  }
  material.dispose();
  return n;
}

/**
 * Recursively dispose geometries, materials and textures under `root`.
 * Materials and geometries are deduped, because sharing them is the norm and
 * double-disposing a shared material in a partial teardown is a real crash.
 * Does NOT detach `root` from its parent — that is the caller's call.
 */
export function disposeTree(root, { removeChildren = true } = {}) {
  if (!root) return { geometries: 0, materials: 0, textures: 0 };
  const geos = new Set();
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const m = o.material;
    if (Array.isArray(m)) for (const x of m) mats.add(x);
    else if (m) mats.add(m);
  });
  let textures = 0;
  for (const g of geos) g.dispose();
  for (const m of mats) textures += disposeMaterial(m);
  if (removeChildren) root.clear?.();
  return { geometries: geos.size, materials: mats.size, textures };
}

/** Dispose a list of render targets / textures / anything with .dispose(). */
export function disposeAll(...items) {
  for (const list of items) {
    for (const it of Array.isArray(list) ? list : [list]) it?.dispose?.();
  }
}

/**
 * Track what you create so dispose() cannot forget one. Cheap enough to use
 * everywhere, and it turns "did I dispose the 14 render targets" into one call.
 *
 *   this.own = new Owned();
 *   const rt = this.own.add(new THREE.WebGLRenderTarget(...));
 *   ...
 *   dispose() { this.own.disposeAll(); }
 */
export class Owned {
  #items = new Set();

  add(item) {
    if (item?.dispose) this.#items.add(item);
    return item;
  }

  addAll(...items) {
    for (const i of items.flat()) this.add(i);
    return items;
  }

  disposeAll() {
    let n = 0;
    for (const i of this.#items) {
      try {
        i.dispose();
        n++;
      } catch (err) {
        console.warn('[dispose] threw', err);
      }
    }
    this.#items.clear();
    return n;
  }

  get size() {
    return this.#items.size;
  }
}
```

## `lib/engine.js`

```js
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
```

## `lib/index.js`

```js
/**
 * threejs-game-kit — reusable, genre-generic runtime pieces.
 *
 * Nothing here knows what your game is. Everything here exists because its
 * absence cost the reference project measurable time or measurable frame rate.
 * See ../threejs.md for how they fit together and ../PITFALLS.md for why each one
 * looks the way it does.
 */
export { Registry, EventBus } from './registry.js';
export { Engine, boot } from './engine.js';
export { Rng, hash3, noise3, fbm3 } from './rng.js';
export {
  PHYSICS_HZ, FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_DT,
  QUALITY_PRESETS, DEFAULTS, createConfig, configFromLocation, autoQuality,
} from './config.js';
export { Input, DEFAULT_ACTIONS, isTouchDevice } from './input.js';
export { TouchControls } from './touchui.js';
export { installShotApi, signalReady } from './shots.js';
export { prewarm, compileMeshes } from './prewarm.js';
export { LightBallast, LightPool } from './lights.js';
export { scratch, Pool, InstanceRing, ParticleStore } from './pool.js';
export { disposeTree, disposeMaterial, disposeAll, Owned } from './dispose.js';
export { suite, stats } from './selftest.js';
```

## `lib/input.js`

```js
/**
 * Input aggregation: keyboard, mouse, TOUCH, wheel — exposed as a stable
 * PER-FRAME SNAPSHOT so gameplay never touches a DOM event.
 *
 * Why a snapshot and not listeners in gameplay code:
 *  - a DOM event can fire twice between two frames, or zero times; gameplay that
 *    reads events directly behaves differently at different frame rates
 *  - a capture harness / demo bot can then DRIVE the game by writing into this
 *    object (see tools/smoke.mjs) and everything downstream — state machines,
 *    animation, AI reacting to the player — runs untouched. That is how you get
 *    a scripted playthrough that is really the game being played, rather than a
 *    canned camera path that proves nothing.
 *  - `frozen` gives the shot API one switch to take control away
 *
 * TOUCH FEEDS THE SAME SNAPSHOT, which is the whole design. A thumb on the left
 * of the screen resolves to the same `axis2()` a WASD key does, a drag on the
 * right resolves to the same `look`, and a bound on-screen button resolves to
 * the same `held('jump')`. So gameplay code has no touch branch anywhere: write
 * the game once against actions and it is playable on a phone. Games published
 * to thrixel.world get opened on phones far more often than on desktops, so this
 * is not an accessibility extra — it is most of the audience.
 *
 * Edge queries (`pressed`, `released`) are only valid during the frame the
 * transition happened. Read them in update(), never in fixedUpdate() — a fixed
 * step may run 0 or N times in a frame, so an edge is missed or double-counted.
 */

/** Coarse pointer + no hover = phone or tablet. Not UA sniffing: this asks the
 *  question that actually matters (can this person hover a mouse?) and it stays
 *  right on devices that did not exist when this was written. */
export const isTouchDevice = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Beyond this the thumb has slid too far for the press to have been a tap. */
const TAP_SLOP_PX = 12;
/** Longer than this and it was a look-drag or a hold, not a tap. */
const TAP_MS = 260;

export const DEFAULT_ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft'],
  use: ['KeyF', 'KeyE'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  reload: ['KeyR'],
  pause: ['Escape'],
};

export class Input {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.touch] enable the touch layer (default true; it costs
   *   nothing on a desktop because nothing dispatches touch pointers there)
   * @param {number} [opts.touchSensitivity] radians per pixel of thumb drag.
   *   Higher than the mouse figure on purpose: a thumb has perhaps a third of
   *   the travel of a mouse arm and has to cover the same 360 degrees.
   * @param {number} [opts.moveZoneWidth] fraction of the canvas width, measured
   *   from the left edge, that acts as the movement stick. The rest looks.
   * @param {string|null} [opts.tapAction] action fired by a tap in the look
   *   zone. Pass null for a game where a stray tap should not shoot.
   */
  constructor(canvas, {
    actions = DEFAULT_ACTIONS,
    sensitivity = 0.0022,
    pointerLock = true,
    touch = true,
    touchSensitivity = 0.0045,
    moveZoneWidth = 0.45,
    tapAction = 'primary',
  } = {}) {
    this.canvas = canvas;
    this.actions = actions;
    this.sensitivity = sensitivity;
    this.pointerLock = pointerLock;
    this.touchEnabled = touch;
    this.touchSensitivity = touchSensitivity;
    this.moveZoneWidth = moveZoneWidth;
    this.tapAction = tapAction;

    /**
     * True once this session has seen a real touch. Games read it to swap the
     * control hints ("WASD to move" -> nothing), to skip the click-to-lock
     * overlay, and to show on-screen controls. Deliberately NOT the same as
     * `isTouchDevice()`: a laptop with a touchscreen should keep its keyboard
     * hints until someone actually reaches out and touches the screen.
     */
    this.touchActive = false;
    /** Analog movement from the on-screen stick, each axis in [-1, 1]. Merged
     *  into axis2() alongside the keyboard, so gameplay reads one value. */
    this.move = { x: 0, y: 0 };
    this._stick = null;      // { id, ox, oy, x, y, radius }
    this._lookTouch = null;  // { id, x, y, t0, moved }
    this._touchLook = { x: 0, y: 0 };
    this._unbinds = new Map();

    this.down = new Set(); // codes held right now
    this._pressed = new Set(); // went down during this frame
    this._released = new Set(); // went up during this frame
    /**
     * An ORDERED queue of `{ code, down }`, not two sets. Two sets cannot
     * represent both of the things that legitimately happen inside one frame:
     *   - a fast TAP (down then up) must yield a press AND a release, not held
     *   - a RE-PRESS (up then down) must leave the key held
     * With sets you have to pick an order and one of those breaks. Processing all
     * downs before all ups silently swallowed the re-press, which is exactly what
     * a bot driving the game does when it releases the previous case's keys and
     * presses the next case's in the same frame — the key came out NOT held and
     * the run measured zero movement.
     */
    this._queue = [];

    /** Accumulated pointer delta for this frame, in radians after sensitivity. */
    this.look = { x: 0, y: 0 };
    this._rawLook = { x: 0, y: 0 };
    this.wheel = 0;
    this._rawWheel = 0;

    this.enabled = true;
    /** When true, every query reads as neutral. The shot API sets this. */
    this.frozen = false;
    this.locked = false;

    this._handlers = [];
  }

  attach() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push(() => target.removeEventListener(type, fn, opts));
    };

    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      this._queue.push({ code: e.code, down: true });
      // Space scrolls, F5/Tab/etc. are the user's; only swallow what we bind.
      if (this._isBound(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this._queue.push({ code: e.code, down: false }));
    on(window, 'blur', () => {
      // Without this, alt-tabbing while holding W leaves the player sprinting.
      for (const c of this.down) this._queue.push({ code: c, down: false });
      this._releaseAllTouches();
    });

    on(this.canvas, 'mousedown', (e) => {
      this._queue.push({ code: `Mouse${e.button}`, down: true });
      if (this.pointerLock && !this.locked) this.canvas.requestPointerLock?.();
    });
    on(window, 'mouseup', (e) => this._queue.push({ code: `Mouse${e.button}`, down: false }));
    on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (this.pointerLock && !this.locked) return;
      this._rawLook.x += e.movementX ?? 0;
      this._rawLook.y += e.movementY ?? 0;
    });
    on(window, 'wheel', (e) => {
      this._rawWheel += Math.sign(e.deltaY);
    }, { passive: true });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });

    if (this.touchEnabled) {
      // Pointer events, not touch events: one code path, and `pointerType`
      // separates a thumb from the mouse cleanly. The mouse listeners above are
      // left alone, so this adds a path rather than replacing one.
      //
      // `touch-action: none` is set here as well as in CSS on purpose. Without
      // it the browser claims the gesture as a scroll or a pinch after ~100ms
      // and pointermove simply stops arriving mid-drag — which presents as
      // "looking around works for a moment and then sticks", a bug that is very
      // hard to read from the game code.
      this.canvas.style.touchAction = 'none';
      on(this.canvas, 'pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        this.touchActive = true;
        this.canvas.setPointerCapture?.(e.pointerId);
        const r = this.canvas.getBoundingClientRect();
        const inMoveZone = e.clientX - r.left < r.width * this.moveZoneWidth;
        if (inMoveZone && !this._stick) {
          // A FLOATING stick, centred wherever the thumb landed, not a fixed
          // circle the thumb has to find. On a phone the thumb cannot see what
          // it is covering, so a fixed stick means constant small corrections.
          this._stick = {
            id: e.pointerId,
            ox: e.clientX,
            oy: e.clientY,
            x: 0,
            y: 0,
            radius: Math.min(96, Math.max(46, Math.min(r.width, r.height) * 0.17)),
          };
        } else if (!this._lookTouch) {
          this._lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
        }
      });
      on(this.canvas, 'pointermove', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        const s = this._stick;
        if (s && s.id === e.pointerId) {
          const dx = e.clientX - s.ox;
          const dy = e.clientY - s.oy;
          const len = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, len / s.radius) / len;
          s.x = dx * k;
          s.y = dy * k;
          return;
        }
        const l = this._lookTouch;
        if (l && l.id === e.pointerId) {
          const dx = e.clientX - l.x;
          const dy = e.clientY - l.y;
          l.moved += Math.hypot(dx, dy);
          l.x = e.clientX;
          l.y = e.clientY;
          this._touchLook.x += dx;
          this._touchLook.y += dy;
        }
      });
      const endTouch = (e) => {
        if (e.pointerType !== 'touch') return;
        if (this._stick?.id === e.pointerId) {
          this._stick = null;
          this.move.x = this.move.y = 0;
          return;
        }
        const l = this._lookTouch;
        if (l?.id !== e.pointerId) return;
        this._lookTouch = null;
        const tapped = e.type === 'pointerup'
          && l.moved < TAP_SLOP_PX
          && performance.now() - l.t0 < TAP_MS;
        // Down AND up in one frame is handled correctly by the ordered queue:
        // it yields a press edge and a release edge, and leaves nothing held.
        if (tapped && this.tapAction) {
          const code = this.actions[this.tapAction]?.[0];
          if (code) {
            this._queue.push({ code, down: true });
            this._queue.push({ code, down: false });
          }
        }
      };
      on(this.canvas, 'pointerup', endTouch);
      on(this.canvas, 'pointercancel', endTouch);
    }

    return this;
  }

  /**
   * Route an on-screen element to an action, for jump / fire / interact buttons.
   * Works for a mouse click too, so the same HUD is usable on a desktop.
   *
   *   input.bindButton(document.querySelector('[data-jump]'), 'jump')
   *
   * Returns an unbind function; `detach()` also releases every binding.
   */
  bindButton(el, action) {
    if (!el) return () => {};
    const code = this.actions[action]?.[0] ?? action;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();          // never let the canvas also read this as a look-drag
      if (e.pointerType === 'touch') this.touchActive = true;
      el.setPointerCapture?.(e.pointerId);
      this._queue.push({ code, down: true });
    };
    // Release on up AND cancel AND lostpointercapture: a finger that slides off
    // a button and lifts elsewhere otherwise leaves the action held forever,
    // which reads as "the fire button got stuck".
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._queue.push({ code, down: false });
    };
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    const off = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      this._unbinds.delete(el);
    };
    this._unbinds.set(el, off);
    return off;
  }

  /** Where the floating stick is and how far it is pushed, for anything drawing
   *  an indicator. Null when no thumb is down. Read-only view of private state. */
  get stickState() {
    const s = this._stick;
    return s && s.id !== -1 ? { originX: s.ox, originY: s.oy, x: s.x, y: s.y, radius: s.radius } : null;
  }

  _releaseAllTouches() {
    this._stick = null;
    this._lookTouch = null;
    this.move.x = this.move.y = 0;
    this._touchLook.x = this._touchLook.y = 0;
  }

  detach() {
    for (const off of this._handlers) off();
    this._handlers.length = 0;
    for (const off of [...this._unbinds.values()]) off();
    this._releaseAllTouches();
  }

  _isBound(code) {
    for (const codes of Object.values(this.actions)) if (codes.includes(code)) return true;
    return false;
  }

  /** Promote queued events into this frame's snapshot, in the order they arrived. */
  beginFrame() {
    this._pressed.clear();
    this._released.clear();
    if (this.enabled && !this.frozen) {
      for (const ev of this._queue) {
        if (ev.down) {
          if (!this.down.has(ev.code)) {
            this.down.add(ev.code);
            this._pressed.add(ev.code);
          }
        } else if (this.down.delete(ev.code)) {
          this._released.add(ev.code);
        }
      }
      // Mouse and thumb are summed, each at its own sensitivity: the two are
      // never in use at the same moment, and summing avoids a mode flag that
      // would have to be got right.
      this.look.x = this._rawLook.x * this.sensitivity + this._touchLook.x * this.touchSensitivity;
      this.look.y = this._rawLook.y * this.sensitivity + this._touchLook.y * this.touchSensitivity;
      this.wheel = this._rawWheel;
      const s = this._stick;
      // Deadzone: a thumb resting on the glass drifts a few pixels, and without
      // this the player slides very slowly forever while standing still.
      this.move.x = s && Math.hypot(s.x, s.y) > 0.12 ? s.x : 0;
      this.move.y = s && Math.hypot(s.x, s.y) > 0.12 ? s.y : 0;
    } else {
      this.down.clear();
      this.look.x = this.look.y = 0;
      this.wheel = 0;
      this.move.x = this.move.y = 0;
    }
    this._queue.length = 0;
    this._rawLook.x = this._rawLook.y = 0;
    this._touchLook.x = this._touchLook.y = 0;
    this._rawWheel = 0;
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }

  /**
   * BOT / TEST DRIVING — feed a synthetic event exactly where a DOM event would
   * land, so `pressed()` and `released()` edges fire normally.
   *
   * Use this from tools (smoke test, profiler, demo recorder) instead of writing
   * into `down` directly: `down.add('Mouse0')` makes the key look HELD but never
   * generates a press edge, so anything gated on `pressed()` silently never
   * happens and the tool reports zero events for a game that works. That exact
   * mistake cost a debugging round here.
   */
  inject(code, isDown = true) {
    this._queue.push({ code, down: !!isDown });
    return this;
  }

  /** Feed raw pointer delta in pixels, pre-sensitivity — like a real mouse. */
  injectLook(dx, dy) {
    this._rawLook.x += dx;
    this._rawLook.y += dy;
    return this;
  }

  /**
   * Drive the movement stick directly, in stick space: x right, y DOWN-screen,
   * each in [-1, 1], so `injectStick(0, -1)` is full forward. For bots driving
   * a touch-only control scheme.
   *
   * It STAYS deflected until you call `injectStick(0, 0)` — there is no finger
   * to lift. A bot that forgets leaves the player walking into a wall for the
   * rest of the run, which measures as movement and reads as a pass.
   */
  injectStick(x, y) {
    this._stick = { id: -1, ox: 0, oy: 0, x, y, radius: 1 };
    this.touchActive = true;
    return this;
  }

  /** Take control for a bot: enabled, unfrozen, and pointer-lock not required. */
  takeControl() {
    this.enabled = true;
    this.frozen = false;
    this.pointerLock = false;
    return this;
  }

  /** Held. */
  held(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Went down this frame. */
  pressed(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this._pressed.has(c)) return true;
    return false;
  }

  /** Went up this frame. */
  released(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this._released.has(c)) return true;
    return false;
  }

  /**
   * Movement axis, in [-1, 1] per axis. Not normalised — the mover decides
   * whether diagonal movement is faster, which is a design choice.
   *
   * Keyboard contributes -1/0/1 and the touch stick contributes its analog
   * deflection; they are summed and clamped. That sum is why gameplay code
   * needs no touch branch: the same call is the whole control scheme on both a
   * keyboard and a thumb, and a half-deflected thumb walks instead of running.
   * Note the stick's screen-down Y is negated here, since forward is up-screen.
   */
  axis2(negX = 'left', posX = 'right', negY = 'back', posY = 'forward', out = { x: 0, y: 0 }) {
    const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
    out.x = clamp((this.held(posX) ? 1 : 0) - (this.held(negX) ? 1 : 0) + this.move.x);
    out.y = clamp((this.held(posY) ? 1 : 0) - (this.held(negY) ? 1 : 0) - this.move.y);
    return out;
  }
}
```

## `lib/lights.js`

```js
import * as THREE from 'three';

/**
 * THE POINT-LIGHT COUNT IS A SHADER PERMUTATION KEY.
 *
 * This is the single most expensive Three.js trap in the reference project, and
 * it is invisible in every profiler that reports a median frame time.
 *
 * three bakes the number of VISIBLE lights of each type into every material's
 * program cache key. So the moment a light's `visible` flips — which is exactly
 * what distance culling does — EVERY lit material in the scene recompiles.
 * Measured, walking one street with 17 practicals (12 bulbs at 13 m, 5 lamps at
 * 22 m), the visible count swept 9-8-7-6-5-4 and produced:
 *
 *   f15 +36 programs 636 ms · f32 +35 702 ms · f41 +35 699 ms
 *   f51 +35 programs 678 ms · f99 +33 698 ms
 *   -> 186 programs and ~3.5 s of stalls inside 900 frames of play
 *
 * Pre-compiling every possible count instead costs 9.5 s of boot (595 programs
 * for counts 0-16). Holding the count constant costs nothing.
 *
 * TWO FIXES, both exactly pixel-neutral:
 *   A. Drive `intensity` to 0 and leave `visible = true` (best for pooled FX
 *      lights you own).
 *   B. Park zero-intensity BALLAST lights and top the count up to a fixed slot
 *      budget every lateUpdate (best when you cannot control who culls).
 *
 * Why it cannot move a pixel: a light whose colour x intensity is exactly 0 adds
 * a float 0.0 to the irradiance accumulator. Not "almost nothing" — zero. It
 * only changes `numPointLights`, which is a permutation input and nothing else.
 * Measured cost of 20 live ballast slots: p05 frame time 15.7 -> 14.4 ms, i.e.
 * inside noise.
 */
export class LightBallast {
  /**
   * @param parent Object3D to hang the ballast off (your subsystem's root)
   * @param slots  the FIXED number of point-light slots the shader will see
   * @param extra  spare slots so a burst of real lights can't exceed the target
   */
  constructor(parent, slots, extra = 4) {
    this.slots = slots;
    this.lights = [];
    for (let i = 0; i < slots + extra; i++) {
      const l = new THREE.PointLight(0x000000, 0, 0.01, 2);
      l.name = `light_ballast_${i}`;
      l.castShadow = false;
      l.visible = false;
      l.userData.isBallast = true;
      // Far under the world so even the distance-attenuation term is 0.
      l.position.set(0, -1000, 0);
      parent.add(l);
      this.lights.push(l);
    }
  }

  /**
   * Call from lateUpdate — after every subsystem has finished moving lights and
   * the camera, and before render draws, so the count three sees is identical
   * every frame.
   *
   * `realVisible` is how many NON-ballast point lights will be visible when the
   * renderer draws. You usually have to PREDICT it rather than read
   * `light.visible`, because the renderer's own cull runs after lateUpdate. Being
   * off by one on the frame a light crosses its radius costs one recompile
   * instead of hundreds — and if you mirror the cull's own test you are exact.
   */
  update(realVisible) {
    const need = Math.max(0, this.slots - realVisible);
    for (let i = 0; i < this.lights.length; i++) this.lights[i].visible = i < need;
    return need;
  }

  dispose() {
    for (const l of this.lights) l.parent?.remove(l);
    this.lights.length = 0;
  }
}

/**
 * A fixed-size pool of dynamic lights (muzzle flash, explosion, spark, pickup
 * glow, spell). Never creates or destroys a light after init, and never sets
 * `visible = false` — it drives intensity to 0 instead, so the permutation key
 * never changes. This is fix (A) above.
 */
export class LightPool {
  constructor(parent, count, { color = 0xffffff, distance = 8, decay = 2, castShadow = false } = {}) {
    this.pool = [];
    this.cursor = 0;
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(color, 0, distance, decay);
      l.castShadow = castShadow;
      l.visible = true; // ALWAYS. intensity 0 is the off state.
      parent.add(l);
      this.pool.push({ light: l, until: -1, peak: 0, start: 0 });
    }
  }

  /** Flash light i at `intensity` for `life` seconds starting `now`. */
  flash(position, intensity, life, now, color = null) {
    const slot = this.pool[this.cursor++ % this.pool.length];
    slot.light.position.copy(position);
    if (color !== null) slot.light.color.set(color);
    slot.peak = intensity;
    slot.start = now;
    slot.until = now + life;
    return slot.light;
  }

  /** Call every frame with the engine clock. Allocation-free. */
  update(now) {
    let live = 0;
    for (const s of this.pool) {
      if (s.until < 0) continue;
      const t = (s.until - now) / Math.max(1e-6, s.until - s.start);
      if (t <= 0) {
        s.light.intensity = 0;
        s.until = -1;
        continue;
      }
      s.light.intensity = s.peak * t * t; // quadratic falloff reads as a flash
      live++;
    }
    return live;
  }

  dispose() {
    for (const s of this.pool) s.light.parent?.remove(s.light);
    this.pool.length = 0;
  }
}
```

## `lib/pool.js`

```js
import * as THREE from 'three';

/**
 * ALLOCATE NOTHING PER FRAME. A `new THREE.Vector3()` inside update() is a bug:
 * at 60 fps with a few hundred objects it is millions of short-lived objects a
 * minute, and the GC pause lands as a hitch you cannot attribute to anything.
 *
 * The three tools here cover ~all of it: scratch objects for math, a generic
 * pool for gameplay entities, and an instanced ring buffer for the FX-shaped
 * problem (spawn many, expire quietly, never exceed a budget).
 */

/**
 * Preallocated scratch. Create ONE of these per module at file scope, never per
 * call. Deliberately not a stack/allocator: a named field is greppable and a
 * reviewer can see aliasing bugs, whereas `scratch.get()` hides them.
 *
 *   const S = scratch(); // module scope
 *   ... S.v0.copy(a).sub(b);
 */
export function scratch() {
  return {
    v0: new THREE.Vector3(), v1: new THREE.Vector3(), v2: new THREE.Vector3(),
    v3: new THREE.Vector3(), v4: new THREE.Vector3(),
    q0: new THREE.Quaternion(), q1: new THREE.Quaternion(),
    m0: new THREE.Matrix4(), m1: new THREE.Matrix4(),
    n0: new THREE.Matrix3(),
    e0: new THREE.Euler(),
    c0: new THREE.Color(), c1: new THREE.Color(),
    box0: new THREE.Box3(), box1: new THREE.Box3(),
    sph0: new THREE.Sphere(),
    ray0: new THREE.Ray(),
    pl0: new THREE.Plane(),
  };
}

/**
 * Fixed-capacity object pool. `acquire()` returns null at capacity rather than
 * growing — a budget you can silently exceed is not a budget, and an unbounded
 * pool turns a spawn bug into an OOM instead of a visible cap.
 */
export class Pool {
  /**
   * @param capacity  hard cap, from ctx.config.q budgets
   * @param create    () => item, called `capacity` times at init and never again
   * @param reset     (item) => void, called on release
   */
  constructor(capacity, create, reset = null) {
    this.capacity = capacity;
    this.reset = reset;
    this.items = new Array(capacity);
    this.free = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.items[i] = create(i);
      this.free[i] = i;
    }
    this.freeCount = capacity;
    this.live = 0;
    this.rejected = 0; // surface this in your stats; a rising count is a bug
  }

  acquire() {
    if (this.freeCount === 0) {
      this.rejected++;
      return null;
    }
    const i = this.free[--this.freeCount];
    this.live++;
    const item = this.items[i];
    item.__poolIndex = i;
    return item;
  }

  release(item) {
    const i = item.__poolIndex;
    if (i === undefined || i < 0) return false;
    item.__poolIndex = -1;
    this.reset?.(item);
    this.free[this.freeCount++] = i;
    this.live--;
    return true;
  }

  /** Oldest-wins recycling: for FX where dropping a spawn looks worse than
   *  stealing the oldest one. */
  acquireOrRecycle(oldest) {
    return this.acquire() ?? (oldest ? (this.release(oldest), this.acquire()) : null);
  }
}

/**
 * InstancedMesh ring buffer. One draw call for up to `capacity` copies of one
 * geometry; spawning past capacity overwrites the oldest slot. This is how
 * decals, shells, debris, footprints, bullet holes and crowd props stay at one
 * draw call each.
 *
 * Two details that bite:
 *  - `instanceMatrix.needsUpdate = true` must be set after any write, but set it
 *    ONCE per frame, not per instance.
 *  - Set `frustumCulled = false` (or maintain real bounds): three culls the whole
 *    InstancedMesh against the geometry's bounding sphere at the mesh's origin,
 *    so a ring buffer spread across the level vanishes when the origin leaves the
 *    frustum.
 */
export class InstanceRing {
  constructor(geometry, material, capacity, { parent = null, colors = false } = {}) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    }
    this.cursor = 0;
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._dirty = false;
    parent?.add(this.mesh);
  }

  /** Write one instance from position/quaternion/scale. Returns the slot index. */
  spawn(position, quaternion, scale) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.mesh.count < this.capacity) this.mesh.count++;
    this._m.compose(position, quaternion, scale);
    this.mesh.setMatrixAt(i, this._m);
    this._dirty = true;
    return i;
  }

  /** Scale a slot to zero — the cheap way to hide one instance. */
  clear(i) {
    this.mesh.setMatrixAt(i, this._zero);
    this._dirty = true;
  }

  setColorAt(i, color) {
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Call once per frame, from lateUpdate. */
  flush() {
    if (!this._dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
  }
}

/**
 * Struct-of-arrays particle store. Typed arrays, no per-particle objects, no
 * allocation at spawn. Deliberately dumb: the point is that `spawn()` is a few
 * array writes so it can be called hundreds of times a frame.
 */
export class ParticleStore {
  constructor(capacity) {
    this.capacity = capacity;
    this.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
  }

  spawn(px, py, pz, vx, vy, vz, life, size, seed) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const j = i * 3;
    this.pos[j] = px; this.pos[j + 1] = py; this.pos[j + 2] = pz;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.seed[i] = seed;
    return i;
  }

  /** Swap-with-last compaction: O(live), no holes, stable cost. */
  step(dt, gravity = -9.81, drag = 0) {
    const k = drag > 0 ? Math.exp(-drag * dt) : 1;
    for (let i = 0; i < this.count; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this._swapWithLast(i);
        continue;
      }
      const j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k + gravity * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      i++;
    }
    return this.count;
  }

  _swapWithLast(i) {
    const last = --this.count;
    if (i === last) return;
    const a = i * 3, b = last * 3;
    for (let c = 0; c < 3; c++) {
      this.pos[a + c] = this.pos[b + c];
      this.vel[a + c] = this.vel[b + c];
    }
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size[i] = this.size[last];
    this.seed[i] = this.seed[last];
  }
}
```

## `lib/prewarm.js`

```js
import * as THREE from 'three';

/**
 * SHADER PRE-WARM. If you build one thing from this kit besides the capture
 * harness, build this.
 *
 * WHY: three compiles a program the first time a given permutation — (material,
 * light counts, shadow, skinning, fog, instancing, colour space, tone mapping) —
 * is actually DRAWN. So the frame that first shows a spark, an enemy, a lamp
 * coming into range or a muzzle flash is also the frame that compiles its
 * shader. Measured on the reference project: 86-146 programs compiled during
 * play, up to 30 on a single frame, producing 700 ms - 3.9 SECOND stalls. That
 * is what players describe as "it freezes" — not a low frame rate.
 *
 * The fix is to force every permutation to compile up front, behind a loading
 * state, so the steady-state loop compiles nothing.
 *
 * THE CONTRACT — each subsystem implements:
 *
 *   async prewarmMaterials(ctx) -> { ok, compiled }
 *
 *   "Build and compile every material this subsystem can produce, WITHOUT
 *    spawning gameplay objects, drawing a gameplay frame, or touching the clock
 *    or the RNG."
 *
 * That wording is load-bearing. Pre-warm is only useful if it is *provably*
 * pixel-neutral, and it is only provable if it leaves no simulation residue. The
 * reference project measured up to 254/255 channel deltas from a pre-warm that
 * spawned transients "just to reach their shaders", because decals live in a
 * ring buffer and spawned actors had no despawn hook.
 *
 * Four traps, all measured, all of which silently make pre-warm useless:
 *
 *  1. A RENDER TARGET MUST BE BOUND WHILE COMPILING. three folds
 *     `outputColorSpace` and `toneMapping` into the program cache key and reads
 *     BOTH off the CURRENTLY BOUND target. Compile with the canvas bound and you
 *     get the srgb + tone-mapped variant; but the world is drawn into an HDR
 *     target needing srgb-linear + NoToneMapping. Measured: 25 of 47 pre-warmed
 *     programs were the unused canvas variant and the real ones still compiled
 *     during play. A 1x1 target is enough to get the right key.
 *  2. compileAsync(scene, camera) ONLY REACHES THE FORWARD LIT VARIANT. Not the
 *     shadow/depth pass, not an MRT prepass, not the post chain, not any
 *     override material. Those need the owning subsystem's own hook.
 *  3. PATCH BEFORE YOU COMPILE. If your renderer injects chunks via
 *     onBeforeCompile / material.needsUpdate after the fact, a program compiled
 *     first is thrown away and recompiled by the first real frame. Measured: 26
 *     of 144 live programs were unpatched duplicates — 18% of the compile budget
 *     spent on programs that never draw anything.
 *  4. ANYTHING WHOSE KEY DEPENDS ON THE VISIBLE LIGHT COUNT CANNOT BE WARMED
 *     HERE. The visible set is only settled inside the first rendered frame.
 *     Those systems must self-warm on frame 2 and be listed in `selfWarming`.
 *     (And the light count itself must then be held constant — see
 *     lib/lights.js.)
 */
export async function prewarm(engine, { selfWarming = ['fx'], renderFirst = true, onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const render = engine.ctx.peek('render');
  const renderer = render?.renderer;
  if (!renderer) return { ok: false, reason: 'no renderer' };

  const programsBefore = renderer.info.programs?.length ?? 0;

  // Snapshot everything a hook could conceivably disturb. Any residue here is a
  // visual change, and a visual change makes the pixel gate report phantom
  // regressions for the rest of the project.
  const cam = engine.camera;
  const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
  const savedTime = { ...engine.time };
  const savedRng = engine.rng.save();
  const savedAccum = engine._accum;

  const scratchRt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  const prevRt = renderer.getRenderTarget();
  const prevFace = renderer.getActiveCubeFace?.() ?? 0;
  const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;

  const hookResults = {};
  try {
    // ---- pass 1: the forward lit variant of everything already in a scene ----
    renderer.setRenderTarget(scratchRt); // trap #1
    try {
      await renderer.compileAsync(engine.scene, engine.camera);
      if (engine.overlayScene.children.length) {
        await renderer.compileAsync(engine.overlayScene, engine.overlayCamera);
      }
    } catch {
      // Old three, or a driver without KHR_parallel_shader_compile.
      try {
        renderer.compile(engine.scene, engine.camera);
        if (engine.overlayScene.children.length) renderer.compile(engine.overlayScene, engine.overlayCamera);
      } catch {
        /* boot must proceed regardless */
      }
    } finally {
      renderer.setRenderTarget(prevRt, prevFace, prevMip);
    }
    onProgress(0.5);

    // ---- pass 2: the subsystem hooks ----------------------------------------
    // render goes FIRST when it patches materials (trap #3): a program compiled
    // off an unpatched material is discarded by the first frame that walks the
    // scene and re-injects.
    const skip = new Set(selfWarming);
    const hooks = [];
    if (renderFirst && typeof render?.prewarmMaterials === 'function') hooks.push(render);
    for (const sys of engine.registry.ordered) {
      if (sys === render) continue;
      if (skip.has(sys.constructor?.id)) continue;
      if (typeof sys.prewarmMaterials === 'function') hooks.push(sys);
    }

    let done = 0;
    for (const sys of hooks) {
      const id = sys.constructor?.id ?? '?';
      try {
        hookResults[id] = (await sys.prewarmMaterials(engine.ctx)) ?? { ok: true };
      } catch (err) {
        // An optional hook must NEVER be able to block boot. A failed pre-warm
        // just means the stutter comes back; a thrown one means a black screen.
        hookResults[id] = { ok: false, reason: String(err?.message ?? err) };
      }
      onProgress(0.5 + (0.5 * ++done) / Math.max(1, hooks.length));
    }
  } finally {
    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.quat);
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    Object.assign(engine.time, savedTime);
    engine.rng.load(savedRng);
    engine._accum = savedAccum;
    engine._last = performance.now();
    renderer.setRenderTarget(prevRt, prevFace, prevMip);
    scratchRt.dispose();
  }

  const programsAfter = renderer.info.programs?.length ?? 0;
  return {
    ok: true,
    hooks: hookResults,
    ms: Math.round(performance.now() - t0),
    programsBefore,
    programsAfter,
    compiled: programsAfter - programsBefore,
    parallel: !!renderer.getContext().getExtension('KHR_parallel_shader_compile'),
  };
}

/**
 * Helper for a subsystem's own prewarmMaterials(): compile these real meshes,
 * with a target bound, without adding them to any scene.
 *
 * Compile THE REAL MESHES, not stand-ins. `renderer.compile` walks
 * `scene.children` for materials and only uses the target scene for lights, fog
 * and environment — so borrowing the real meshes into a scratch scene (never
 * re-parenting: `parent` is untouched by pushing into `children`) is what
 * guarantees the cache key matches the real draw, down to InstancedMesh-ness and
 * the geometry's exact attribute set.
 *
 * @param renderer  THREE.WebGLRenderer
 * @param meshes    array of Object3D — the real ones
 * @param lightsFrom scene whose lights/fog/env define the permutation (usually ctx.scene)
 * @param camera    any camera
 */
export function compileMeshes(renderer, meshes, lightsFrom, camera) {
  if (!meshes.length) return 0;
  const before = renderer.info.programs?.length ?? 0;
  const scratchRt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  const prevRt = renderer.getRenderTarget();
  const prevFace = renderer.getActiveCubeFace?.() ?? 0;
  const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;

  const holder = new THREE.Scene();
  holder.environment = lightsFrom?.environment ?? null;
  holder.fog = lightsFrom?.fog ?? null;
  // Borrow lights so the light-count part of the key matches.
  lightsFrom?.traverse?.((o) => {
    if (o.isLight) holder.children.push(o);
  });
  for (const m of meshes) holder.children.push(m);

  try {
    renderer.setRenderTarget(scratchRt);
    renderer.compile(holder, camera, lightsFrom ?? holder);
  } catch {
    /* never block boot */
  } finally {
    holder.children.length = 0;
    renderer.setRenderTarget(prevRt, prevFace, prevMip);
    scratchRt.dispose();
  }
  return (renderer.info.programs?.length ?? 0) - before;
}
```

## `lib/registry.js`

```js
/**
 * Subsystem registry + event bus. Genre-generic; nothing here knows about a game.
 *
 * CONTRACT — every subsystem is a class with:
 *   static id       : string, unique. Others reach it via ctx.get(id).
 *   static deps     : string[] of ids that must init() first.
 *   async init(ctx) : build resources. May await.
 *   fixedUpdate(h,ctx): fixed-rate, 0..N times per frame. Optional.
 *   update(dt,ctx)  : once per frame, before render. Optional.
 *   lateUpdate(dt,ctx): after every update(), before render. Optional.
 *   resize(w,h,ctx) : viewport changed. Optional.
 *   prewarmMaterials(ctx): compile every shader this system can produce. Optional.
 *   dispose()       : free GPU/CPU resources. Optional.
 *
 * Subsystems MUST NOT import each other. They go through ctx.get(id). That is
 * what keeps the dependency graph explicit and lets one owner work on one
 * directory without reading (or breaking) another's internals.
 */

export class Registry {
  #systems = new Map();
  #order = [];
  #cache = new Map();

  add(system) {
    const id = system.constructor.id;
    if (!id) throw new Error(`${system.constructor.name} is missing a static id`);
    if (this.#systems.has(id)) throw new Error(`duplicate subsystem id "${id}"`);
    this.#systems.set(id, system);
    this.#cache.clear();
    this.#order = [];
    return this;
  }

  /** Throwing lookup — use for a hard dependency. */
  get(id) {
    const s = this.#systems.get(id);
    if (!s) throw new Error(`subsystem "${id}" not registered`);
    return s;
  }

  /** Non-throwing lookup — use for an optional dependency, and in tools. */
  peek(id) {
    return this.#systems.get(id) ?? null;
  }

  has(id) {
    return this.#systems.has(id);
  }

  /** Topological sort over static deps. Throws on cycles and missing deps. */
  resolve() {
    const seen = new Map(); // id -> 0 visiting, 1 done
    const out = [];
    const visit = (id, from) => {
      const state = seen.get(id);
      if (state === 1) return;
      if (state === 0) throw new Error(`dependency cycle at "${id}" (via ${from})`);
      const sys = this.#systems.get(id);
      if (!sys) throw new Error(`"${from}" depends on unregistered subsystem "${id}"`);
      seen.set(id, 0);
      for (const d of sys.constructor.deps ?? []) visit(d, id);
      seen.set(id, 1);
      out.push(sys);
    };
    for (const id of this.#systems.keys()) visit(id, '<root>');
    this.#order = out;
    return out;
  }

  get ordered() {
    return this.#order.length ? this.#order : this.resolve();
  }

  /** Systems implementing `method`, in dependency order. Cached per method so the
   *  frame loop does no filtering. */
  with(method) {
    let list = this.#cache.get(method);
    if (!list) {
      list = this.ordered.filter((s) => typeof s[method] === 'function');
      this.#cache.set(method, list);
    }
    return list;
  }

  invalidate() {
    this.#cache.clear();
  }
}

/**
 * Minimal synchronous event bus. Handlers are copied before dispatch so a
 * handler may unsubscribe (or subscribe) during its own dispatch, and a throwing
 * handler cannot take down the frame — a single bad listener in one subsystem
 * would otherwise stop every later listener from running that frame.
 */
export class EventBus {
  #map = new Map();

  on(type, fn) {
    let set = this.#map.get(type);
    if (!set) this.#map.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  off(type, fn) {
    this.#map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.#map.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }

  clear() {
    this.#map.clear();
  }
}
```

## `lib/rng.js`

```js
/**
 * Deterministic PRNG (xoshiro128**) with the sampling helpers a game actually
 * needs. ALL gameplay and visual randomness must run through this, never
 * Math.random(), or captures are not reproducible and the pixel gate
 * (tools/imagediff.mjs) is worthless.
 *
 * Use fork() to give each subsystem its own stream: two systems drawing from one
 * stream make each one's output depend on how many numbers the other consumed,
 * which turns an unrelated change into a visual diff.
 */
export class Rng {
  constructor(seed = 0x9e3779b9) {
    this.seed(seed);
  }

  seed(s) {
    // SplitMix32 to spread one 32-bit seed across the four state words.
    let z = s >>> 0;
    const next = () => {
      z = (z + 0x9e3779b9) >>> 0;
      let x = z;
      x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
      x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
      return (x ^ (x >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    this._spare = undefined;
    return this;
  }

  /** Uniform uint32. */
  u32() {
    const rot = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rot(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rot(this.s3, 11);
    return result;
  }

  /** Uniform [0,1). */
  float() {
    return this.u32() / 4294967296;
  }

  /** Uniform [min,max). */
  range(min, max) {
    return min + (max - min) * this.float();
  }

  /** Uniform integer [min,max] inclusive. */
  int(min, max) {
    return min + (this.u32() % (max - min + 1));
  }

  /** Uniform [-1,1]. */
  signed() {
    return this.float() * 2 - 1;
  }

  bool(p = 0.5) {
    return this.float() < p;
  }

  /** Standard normal via Box–Muller; the pair's second sample is cached. */
  gauss() {
    if (this._spare !== undefined) {
      const v = this._spare;
      this._spare = undefined;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * this.float();
    this._spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  pick(arr) {
    return arr[this.u32() % arr.length];
  }

  /** In-place Fisher–Yates. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.u32() % (i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Uniform point in the unit disc — spread cones, splash positions, emission. */
  disc(out = { x: 0, y: 0 }) {
    const r = Math.sqrt(this.float());
    const a = this.float() * Math.PI * 2;
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    return out;
  }

  /** Uniform direction on the unit sphere. */
  sphere(out = { x: 0, y: 0, z: 0 }) {
    const z = this.signed();
    const a = this.float() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    out.z = z;
    return out;
  }

  /** Independent stream derived from this one. Give one to each subsystem. */
  fork() {
    return new Rng(this.u32());
  }

  /** Snapshot / restore — needed by anything that must be simulation-transparent
   *  (see lib/prewarm.js: it steps nothing, but hooks might). */
  save() {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3, spare: this._spare };
  }

  load(s) {
    this.s0 = s.s0;
    this.s1 = s.s1;
    this.s2 = s.s2;
    this.s3 = s.s3;
    this._spare = s.spare;
    return this;
  }
}

/** Deterministic 2D/3D value hash — for "random-looking" detail that must be a
 *  pure function of position (dressing, per-instance variation, noise seeds). */
export function hash3(x, y, z) {
  let h = Math.imul(Math.round(x * 1013) ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ Math.round(y * 1619), 0xc2b2ae35);
  h = Math.imul(h ^ Math.round(z * 31337), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth value noise, period 1 unit. Deterministic, allocation-free. */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

/** Fractal sum of noise3. octaves>4 rarely pays for itself on CPU. */
export function fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
  let f = 1, a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise3(x * f, y * f, z * f);
    norm += a;
    f *= lacunarity;
    a *= gain;
  }
  return sum / norm;
}
```

## `lib/selftest.js`

```js
/**
 * A 40-line assert harness for subsystem self-tests. No dependencies, runs in
 * node and in the browser.
 *
 * WHY IT EXISTS: a screenshot cannot show that a capsule tunnelled through a
 * wall, that a ragdoll is gaining energy, that a nav path is unreachable, that a
 * synthesised sound is silent or clipping, or that a generated mesh has NaN
 * vertices. Those are exactly the failures that a visual critic will report as
 * something else ("the enemy looks wrong") and send you hunting in the wrong
 * subsystem.
 *
 * The pattern that paid off in the reference project: every non-visual subsystem
 * ships a `selftest` that prints a TABLE of measured-vs-expected, runnable as
 * `node src/<system>/selftest.mjs`. Measured numbers, not assertions that pass
 * silently — the table is the artifact you paste into a report, and a reviewer
 * can see a value drifting before it crosses a threshold.
 *
 *   const t = suite('physics');
 *   t.ok(hit !== null, 'ray hits the wall');
 *   t.near(speed, 4.57, 0.12, 'walk top speed', 'm/s');
 *   t.range(slide, 0.75, 0.95, 'slide duration', 's');
 *   process.exit(t.report());
 */
export function suite(name) {
  const rows = [];
  let failures = 0;

  const push = (pass, label, measured, expected, unit) => {
    rows.push({ pass, label, measured, expected, unit: unit ?? '' });
    if (!pass) failures++;
    return pass;
  };

  return {
    name,
    section(title) {
      rows.push({ section: title });
    },
    ok(cond, label, detail = '') {
      return push(!!cond, label, cond ? 'yes' : 'NO', detail || 'yes');
    },
    eq(got, want, label, unit) {
      return push(got === want, label, got, want, unit);
    },
    near(got, want, tol, label, unit) {
      return push(Number.isFinite(got) && Math.abs(got - want) <= tol, label, fmt(got), `${want} ±${tol}`, unit);
    },
    range(got, lo, hi, label, unit) {
      return push(Number.isFinite(got) && got >= lo && got <= hi, label, fmt(got), `${lo}..${hi}`, unit);
    },
    finite(arr, label) {
      let bad = 0;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
      return push(bad === 0, label, `${bad} non-finite`, '0 non-finite');
    },
    /** Report as a table. Returns the exit code: 0 = all pass. */
    report({ log = console.log } = {}) {
      const w = (s, n) => String(s).padEnd(n);
      log(`\n${name} — ${rows.filter((r) => r.pass === true).length}/${rows.filter((r) => 'pass' in r).length} pass`);
      log(w('TEST', 34) + w('MEASURED', 16) + w('EXPECTED', 18) + 'RESULT');
      for (const r of rows) {
        if (r.section) {
          log(`\n${r.section}`);
          continue;
        }
        log(w(r.label, 34) + w(r.measured + r.unit, 16) + w(r.expected + r.unit, 18) + (r.pass ? 'PASS' : 'FAIL'));
      }
      if (failures) log(`\n${failures} FAILURE${failures > 1 ? 'S' : ''}`);
      return failures ? 1 : 0;
    },
    get failures() {
      return failures;
    },
    rows,
  };
}

const fmt = (v) =>
  typeof v === 'number' ? (Math.abs(v) < 100 ? v.toFixed(3) : v.toFixed(1)) : String(v);

/**
 * Statistics for measuring feel and cost. `p(0.99)` is the number that matters
 * for frame time; a mean or median hides exactly the stalls players notice.
 */
export function stats(values) {
  const a = Float64Array.from(values).sort();
  const n = a.length;
  if (!n) return { n: 0 };
  let sum = 0;
  for (const v of a) sum += v;
  const p = (q) => a[Math.min(n - 1, Math.max(0, Math.floor(n * q)))];
  return {
    n,
    min: a[0],
    max: a[n - 1],
    mean: sum / n,
    p1: p(0.01), p50: p(0.5), p90: p(0.9), p95: p(0.95), p99: p(0.99),
    p: (q) => p(q),
  };
}
```

## `lib/shots.js`

```js
import * as THREE from 'three';

/**
 * THE CAPTURE / REVIEW API. This file is the single most valuable piece of the
 * kit: it is what makes a screenshot mean something.
 *
 * A "shot" is a named, reproducible framing of the game:
 *   { pos:[x,y,z], look:[x,y,z], fov?, doc, apply?(engine, opts) }
 *
 * Three separate things live here, in order of importance:
 *
 *  1. window.__APPLY_SHOT__(name, opts) — pose the camera, freeze input, force
 *     the gameplay state the shot is meant to show, and CLEAR the previous
 *     shot's state. Reviewers compare iteration N against iteration N+1 of the
 *     same framing; if the framing drifts, every critique is noise.
 *
 *  2. LOCKSTEP MODE (?capture=1&lockstep=1) — the engine stops scheduling its
 *     own frames; frames only happen inside window.__PUMP__(n). This is what
 *     makes captures bit-reproducible. See the long comment on __PUMP__.
 *
 *  3. A fixed 1/60 shutter clock in capture mode, so temporal accumulators
 *     (TAA jitter, exposure adaptation, any easing) converge identically.
 *
 * Nothing here ships in a gameplay build's critical path; it is dev API on
 * `window`. Keep it that way — tools must never import subsystem modules.
 */

/**
 * @param engine        the Engine
 * @param shots         { [name]: shot } — game-specific, you write these
 * @param capture       true when ?capture=1
 * @param lockstep      true when ?capture=1&lockstep=1
 * @param clearState    called before every shot's own apply(): put transient
 *                      gameplay state back to neutral. See the note below.
 * @param setTimeOfDay  (engine, hour) => void, applies `shot.time`. Defaults to
 *                      the first registered system that has a setTimeOfDay()
 *                      method. Do not assume a subsystem name here: the first
 *                      version of this file called ctx.peek('sky') and silently
 *                      did nothing in a project where `render` owned the sun —
 *                      so the day and night shots came out identical and the
 *                      night shot reviewed as "fine".
 */
export function installShotApi(
  engine,
  { shots = {}, capture = false, lockstep = false, clearState = null, setTimeOfDay = null } = {}
) {
  const applyTime =
    setTimeOfDay ??
    ((eng, hour) => {
      for (const sys of eng.registry.ordered) {
        if (typeof sys.setTimeOfDay === 'function') return sys.setTimeOfDay(hour);
      }
      console.warn('[shots] shot.time set but no system implements setTimeOfDay()');
      return null;
    });
  window.__SHOTS__ = shots;
  window.__ENGINE__ = engine;

  /**
   * `opts.grabFrame` is how many frames the harness will pump before the
   * shutter. A shot whose subject is a transient (a muzzle flash lives ~50 ms, a
   * hit spark less) needs it so it can schedule the event to peak ON the
   * captured frame instead of guessing.
   */
  window.__APPLY_SHOT__ = (name, opts = {}) => {
    const shot = shots[name];
    if (!shot) return { error: `unknown shot "${name}"`, available: Object.keys(shots) };

    // Freeze live input and take the camera away from whatever owns it.
    if (engine.input) {
      engine.input.frozen = true;
      engine.input.enabled = false;
    }
    engine.ctx.peek('player')?.setControlEnabled?.(false);

    const cam = engine.camera;
    cam.position.fromArray(shot.pos);
    cam.lookAt(new THREE.Vector3().fromArray(shot.look));
    if (shot.fov) {
      cam.fov = shot.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    // Keep the player proxy under the camera so gameplay systems stay coherent
    // (audio listener position, AI perception, occlusion queries).
    engine.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);

    /**
     * CLEAR FIRST, THEN APPLY. Shots are taken back to back in one session, so a
     * previous shot's *looping* debug state is still running: the muzzle shot's
     * scripted burst keeps emptying a magazine during the next shot, the impact
     * shot keeps walking rounds across a wall behind the HUD shot. Every one of
     * those is a phantom regression in the next review round.
     */
    clearState?.(engine);
    if (shot.time !== undefined) applyTime(engine, shot.time);
    shot.apply?.(engine, opts);

    engine.events.emit('shot:applied', { name, shot });
    return { applied: name, pos: shot.pos, fov: shot.fov ?? engine.config.fov };
  };

  if (capture) {
    if (engine.input) engine.input.frozen = true;
    /**
     * FIXED SHUTTER CLOCK. Assigning `_last = fake` before each step forces
     * rawDt to be EXACTLY 1000/60 on every frame INCLUDING THE FIRST, whatever
     * else stamped `_last` with a real clock (Engine.start and prewarm both do).
     * Without it, frame 1's dt is 0 when `_last` was stamped and 1/60 when it
     * was not — a boot-path-dependent one-frame difference that then lives in
     * every accumulator for the rest of the run.
     */
    let fake = 0;
    engine.step = ((orig) =>
      function () {
        this._last = fake;
        fake += 1000 / 60;
        return orig.call(this, fake);
      })(engine.step);
  }

  window.__RENDER_INFO__ = null;
  const snapInfo = () => {
    const r = engine.ctx.peek('render');
    const info = r?.renderer?.info;
    window.__RENDER_INFO__ = {
      frame: engine.time.frame,
      calls: info?.render.calls ?? 0,
      tris: info?.render.triangles ?? 0,
      programs: info?.programs?.length ?? 0,
      textures: info?.memory.textures ?? 0,
      geometries: info?.memory.geometries ?? 0,
      ms: engine.time.dt * 1000,
    };
  };

  /**
   * LOCKSTEP CAPTURE — the determinism fix. Read this before you "simplify" it.
   *
   * The problem: the engine's own rAF loop keeps stepping while the driver is
   * doing round trips — waitForFunction on __READY__, the evaluate that applies
   * the shot, the screenshot RPC itself. How many frames fit inside those round
   * trips is wall-clock dependent, so `time.frame` at the shutter drifts 10-20
   * frames run to run. EVERYTHING phase-locked to the absolute frame index —
   * TAA jitter, AO/reflection noise rotation (`frame % 64`), exposure
   * adaptation, the cadence of any scripted transient — therefore resolves
   * differently every run. That, not any subsystem clock read, is the usual
   * reason two identical runs differ, and the reason adding a slow boot step
   * looks like a visual change.
   *
   * The fix: in lockstep mode the engine NEVER schedules a frame. Frames happen
   * only inside __PUMP__(n), which advances exactly n. The frame index at the
   * shutter is then a constant on every run and every machine, and nothing at
   * all advances while the screenshot is being taken.
   */
  if (lockstep) {
    engine.start = function () {
      this._running = true;
    };
    window.__LOCKSTEP__ = true;

    /** Advance exactly `n` engine frames, one per rAF so each one is presented. */
    window.__PUMP__ = (n = 1) =>
      new Promise((resolve) => {
        let i = 0;
        const tick = () => {
          engine.step();
          snapInfo();
          if (++i >= n) resolve(engine.time.frame);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

    /** Yield `n` rAFs WITHOUT stepping, so the compositor has certainly picked
     *  up the last rendered frame before the shutter. Advances no state. */
    window.__PRESENT__ = (n = 2) =>
      new Promise((resolve) => {
        let i = 0;
        const tick = () => (++i >= n ? resolve(engine.time.frame) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
  } else {
    window.__LOCKSTEP__ = false;
    // Free-running: the engine drives itself; __PUMP__ just waits out n frames.
    // Tools that measure real frame pacing (tools/profile.mjs) need this path.
    window.__PUMP__ = (n = 1) =>
      new Promise((resolve) => {
        let i = 0;
        const tick = () => (++i >= n ? resolve(engine.time.frame) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
    window.__PRESENT__ = window.__PUMP__;
    const info = () => {
      snapInfo();
      requestAnimationFrame(info);
    };
    requestAnimationFrame(info);
  }

  return { pump: window.__PUMP__, present: window.__PRESENT__, lockstep: !!lockstep };
}

/**
 * Raise window.__READY__ after a fixed NUMBER OF FRAMES, not after a timeout and
 * not after a bare rAF race. The shot is then always applied at the same engine
 * frame no matter how long boot took in wall-clock terms — which is what lets
 * you add or remove an expensive boot step and still prove the pixels did not
 * move.
 */
// Told to whoever framed us, as well as set on window.
//
// window.__READY__ works for the capture harness, which drives this page from
// the same process. It cannot work for a host page: a published world is on
// its own registrable domain, so a parent frame is forbidden from reading any
// variable in here. A postMessage crosses that line by design, and it is the
// difference between a host that can hide its loading state at the exact
// frame the world starts drawing and one that has to guess.
//
// targetOrigin is '*' deliberately. There is nothing secret in the message,
// and the alternative is baking the host's origin into every published
// bundle - which would then be wrong for anyone who frames it elsewhere.
function post(message) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'thrixel-world', ...message }, '*');
    }
  } catch {
    // A sandbox that forbids it. The world still runs and nothing here is
    // load-bearing for play; the host falls back to its own signals.
  }
}

function announceReady() {
  window.__READY__ = true;
  post({ type: 'ready' });
  sendCover();
}

// A still of the world, taken by the world.
//
// Anything published through the skill already has artwork - playcheck runs
// the game, drives it for a couple of seconds and screenshots it into the
// bundle, which is a better picture than this one. This is for the bundle
// that arrived another way: somebody zipping their build by hand and
// uploading it, which skips playcheck and lands with no picture at all.
//
// Two things make it fiddly, and both are handled by retrying rather than by
// timing luck:
//
//  1. A WebGL canvas without preserveDrawingBuffer is EMPTY to toDataURL
//     unless it is read in the same frame it was drawn. Whether our rAF
//     lands after the engine's is not something a library can promise, so
//     this tries again next frame instead of assuming.
//  2. A frame taken the instant boot completes is often a loading screen, or
//     a scene whose models have not arrived. So it waits first.
//
// The blank check is what makes the retry safe: a uniform image is never
// sent, so the worst case is no cover rather than a grey rectangle stored as
// one.
const COVER_WAIT_MS = 2500;
const COVER_MAX_W = 1280;
const COVER_TRIES = 8;

function frameIfNotBlank(canvas) {
  const scale = Math.min(1, COVER_MAX_W / (canvas.width || COVER_MAX_W));
  const flat = document.createElement('canvas');
  flat.width = Math.max(1, Math.round(canvas.width * scale));
  flat.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = flat.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, flat.width, flat.height);

  // Sample a grid rather than every pixel: enough to tell a rendered scene
  // from a cleared buffer, cheap enough to run eight times.
  const { data } = ctx.getImageData(0, 0, flat.width, flat.height);
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4 * 997) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  if (max - min < 8) return null;   // one flat colour: nothing was drawn
  return flat.toDataURL('image/jpeg', 0.75);
}

function sendCover() {
  const canvas = window.__ENGINE__?.canvas || document.querySelector('canvas');
  if (!canvas) return;
  let left = COVER_TRIES;
  const attempt = () => {
    let shot = null;
    try {
      shot = frameIfNotBlank(canvas);
    } catch {
      return;   // tainted or unreadable: not worth another try
    }
    if (shot) post({ type: 'cover', dataUrl: shot });
    else if (--left > 0) requestAnimationFrame(attempt);
  };
  setTimeout(() => requestAnimationFrame(attempt), COVER_WAIT_MS);
}

export async function signalReady(shotApi, bootFrames = 3) {
  if (shotApi.lockstep) {
    await shotApi.pump(bootFrames);
    announceReady();
    return;
  }
  let warm = 0;
  const probe = () => {
    if (++warm >= bootFrames) {
      announceReady();
      return;
    }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
}
```

## `lib/touchui.js`

```js
/**
 * On-screen controls for phones: a floating stick indicator and a cluster of
 * action buttons, both wired into the same `Input` snapshot the keyboard feeds.
 *
 * Why this is in the kit rather than left to each game: touch INPUT without
 * touch UI is a game that is technically playable and looks broken. A player
 * who opens a shared link on a phone sees a 3D scene and no controls, tries a
 * tap, and leaves. The single most common mobile failure is not a dead input
 * layer, it is an invisible one.
 *
 * Two rules inherited from the capture harness:
 *  - This layer stays hidden until `input.touchActive`, so a headless capture
 *    (no touch events, ever) is pixel-identical to one taken before this file
 *    existed. `alwaysShow: true` is a debugging aid and WILL move pixels.
 *  - No CSS transitions or animations. Same reason as the HUD: they run on the
 *    browser's clock, not the engine's. Opacity is set, not eased.
 */

const BUTTON_PX = 68; // >= 44 is the accessibility floor; a thumb wants more

/** Standing back from the very edge: phone screens curve, and iOS reserves the
 *  bottom strip for the home indicator. `env(safe-area-inset-*)` needs
 *  `viewport-fit=cover` in the viewport meta tag to be non-zero. */
const EDGE = 'calc(22px + env(safe-area-inset-bottom, 0px))';

export class TouchControls {
  /**
   * @param {import('./input.js').Input} input
   * @param {object} [opts]
   * @param {HTMLElement} [opts.host] where to mount (default: #ui, else body)
   * @param {Array<{action: string, label: string}>} [opts.buttons] right-hand
   *   cluster, listed bottom-first. Keep it to three or fewer: every button is
   *   screen a thumb covers.
   * @param {boolean} [opts.stick] draw the floating stick indicator
   * @param {boolean} [opts.alwaysShow] show on desktop too (debugging only)
   */
  constructor(input, { host = null, buttons = [], stick = true, alwaysShow = false } = {}) {
    this.input = input;
    this.buttons = buttons;
    this.showStick = stick;
    this.alwaysShow = alwaysShow;
    this.host = host ?? document.getElementById('ui') ?? document.body;
    this.root = null;
    this._offs = [];
    this._visible = null;
  }

  attach() {
    const root = document.createElement('div');
    root.dataset.touchControls = '';
    // pointer-events: none on the layer, auto on the buttons — otherwise this
    // covers the canvas and swallows every look-drag.
    // `visibility:hidden`, not just `opacity:0`: an invisible button with
    // pointer-events still swallows clicks, so a desktop player would find a
    // dead zone in the bottom-right corner of the screen. Visibility removes
    // the subtree from hit-testing as well as from the picture.
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:20;' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;' +
      'opacity:0;visibility:hidden';

    if (this.showStick) {
      this.stickRing = document.createElement('div');
      this.stickRing.style.cssText =
        'position:absolute;left:0;top:0;border-radius:50%;border:2px solid rgba(255,255,255,.35);' +
        'background:rgba(255,255,255,.06);display:none';
      this.stickNub = document.createElement('div');
      this.stickNub.style.cssText =
        'position:absolute;left:0;top:0;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;' +
        'background:rgba(255,255,255,.5);display:none';
      root.append(this.stickRing, this.stickNub);
    }

    const cluster = document.createElement('div');
    cluster.style.cssText =
      `position:absolute;right:calc(22px + env(safe-area-inset-right, 0px));bottom:${EDGE};` +
      'display:flex;flex-direction:column-reverse;gap:14px;align-items:center';
    for (const { action, label } of this.buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = action;
      b.textContent = label;
      b.style.cssText =
        `width:${BUTTON_PX}px;height:${BUTTON_PX}px;border-radius:50%;pointer-events:auto;` +
        'border:2px solid rgba(255,255,255,.4);background:rgba(12,16,22,.45);color:#eef2f6;' +
        'font:600 13px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;' +
        '-webkit-tap-highlight-color:transparent;touch-action:none';
      this._offs.push(this.input.bindButton(b, action));
      cluster.appendChild(b);
    }
    root.appendChild(cluster);

    this.host.appendChild(root);
    this.root = root;
    return this;
  }

  /**
   * Call once per frame from your UI system's lateUpdate. Cheap: it writes to
   * the DOM only when something actually changed.
   */
  sync() {
    if (!this.root) return;
    const visible = this.alwaysShow || this.input.touchActive;
    if (visible !== this._visible) {
      this.root.style.opacity = visible ? '1' : '0';
      this.root.style.visibility = visible ? 'visible' : 'hidden';
      this._visible = visible;
    }
    if (!this.showStick) return;
    const s = visible ? this.input.stickState : null;
    if (!s) {
      if (this.stickRing.style.display !== 'none') {
        this.stickRing.style.display = 'none';
        this.stickNub.style.display = 'none';
      }
      return;
    }
    const d = s.radius * 2;
    this.stickRing.style.display = 'block';
    this.stickNub.style.display = 'block';
    this.stickRing.style.width = this.stickRing.style.height = `${d}px`;
    this.stickRing.style.transform =
      `translate(${s.originX - s.radius}px, ${s.originY - s.radius}px)`;
    this.stickNub.style.transform =
      `translate(${s.originX + s.x * s.radius}px, ${s.originY + s.y * s.radius}px)`;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.root?.remove();
    this.root = null;
  }
}
```
