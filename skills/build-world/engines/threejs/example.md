# Example game (`example/`)

A small working game built on the whole kit, one file per section. It imports the kit as `../lib/...`; in your own game the kit sits at `lib/` beside `index.html`, so adjust those imports. Read it for the shape of a game, not to publish as is.

## `example/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>kit example</title>
    <style>
      :root { color-scheme: dark; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 100%; height: 100%; overflow: hidden; background: #000;
        /* Mobile browser chrome, in four lines. `overscroll-behavior` kills
           pull-to-refresh, which otherwise reloads the game whenever a thumb
           drags downward; the other three stop a long press from selecting
           text, flashing a grey tap highlight, or opening a callout menu over
           the game. */
        overscroll-behavior: none;
        -webkit-user-select: none; user-select: none;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
      }
      /* The canvas is sized by CSS and read back by Engine.resize(); never set
         width/height attributes on it directly or DPR handling breaks.
         `100dvh` before `100vh` matters on phones: `100vh` on iOS Safari means
         the viewport WITHOUT the URL bar, so the bottom of the game sits under
         browser chrome until the user scrolls — which they cannot, because the
         page does not scroll. `dvh` tracks the visible height. */
      #game { display: block; width: 100vw; height: 100vh; height: 100dvh; touch-action: none; cursor: crosshair; }
      /* Safe-area padding keeps the HUD clear of the notch and the iOS home
         indicator. It needs `viewport-fit=cover` above to be non-zero. */
      #ui {
        position: fixed; inset: 0; pointer-events: none;
        padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
                 env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
        font: 12px/1.4 ui-monospace, monospace; color: #cfd6dd;
      }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <div id="ui"></div>
    <!-- No build step: the bare 'three' import in lib/ and the systems resolves here. -->
    <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

## `example/main.js`

```js
/**
 * Reference main.js. Every project's entry point does these seven things in this
 * order; copy it and change the system list.
 *
 * The order matters and each step is load-bearing — see the comments.
 */
import { Engine, boot, Input, configFromLocation, installShotApi, signalReady, prewarm } from '../lib/index.js';

import { RenderSystem } from './systems/render.js';
import { WorldSystem } from './systems/world.js';
import { PlayerSystem } from './systems/player.js';
import { FxSystem } from './systems/fx.js';
import { UiSystem } from './systems/ui.js';
import { SHOTS, clearState } from './shots.js';

// 1. Config comes from the URL, so every tool can drive the game with no UI.
const { config, capture, lockstep, shot } = configFromLocation();

const canvas = document.getElementById('game');
const input = new Input(canvas, { sensitivity: config.sensitivity });
const engine = new Engine({ canvas, config, input });

// 2. Registration order is irrelevant — the Registry topo-sorts on static deps.
//    That means adding a system never means working out where in a list it goes.
engine.add(RenderSystem).add(WorldSystem).add(PlayerSystem).add(FxSystem).add(UiSystem);

// 3. Boot with a visible failure. A black canvas with the error only in devtools
//    costs a whole capture cycle to diagnose.
await boot(engine);

// 4. Install the dev/capture API BEFORE prewarm, so the harness can already see
//    the shot list, and so capture mode's fixed shutter clock is in place before
//    anything steps the engine.
const shotApi = installShotApi(engine, { shots: SHOTS, capture, lockstep, clearState });

// 5. Compile every shader permutation while nothing is on screen yet. On by
//    default; `?prewarm=0` opts out, which is also how you A/B its pixel
//    neutrality with tools/baseline.mjs --query=prewarm=0.
window.__PREWARM__ = config.prewarm
  ? await prewarm(engine)
  : { ok: false, reason: 'disabled by ?prewarm=0' };
console.info('[boot] prewarm', window.__PREWARM__);

engine.start();

// 6. Apply the requested shot, then raise __READY__ after a fixed FRAME COUNT —
//    not a timeout. This is what makes boot duration irrelevant to output.
if (shot) window.__APPLY_SHOT__(shot);
await signalReady(shotApi, 3);

// 7. HMR must dispose, or every save leaks a scene's worth of GPU resources
//    until the context is lost and the page goes black mid-iteration.
if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
```

## `example/shots.js`

```js
/**
 * THE SHOT LIST. Write this on day one, before any art or feature work.
 *
 * A shot is a named, fixed framing that every review round re-captures. Its job
 * is to make iteration N comparable to iteration N+1 — if the framing drifts,
 * every critique is noise and you cannot tell improvement from camera luck.
 *
 * Cover the axes your game will be judged on, one shot per axis, and say in
 * `doc` what each shot is FOR. That sentence is what a reviewer reads, and it is
 * what stops them from critiquing the wrong thing.
 *
 * Aim for 8-12. Fewer and a whole class of defect has no witness; many more and
 * a review round costs too much to run often.
 */
export const SHOTS = {
  // --- establishing / art direction -------------------------------------
  hero: {
    pos: [0, 1.9, 18],
    look: [0, 1.4, -6],
    fov: 70,
    time: 16.5,
    doc: 'Wide establishing view — overall art direction, silhouette, composition.',
  },
  // --- close-range material quality (the most common failure) -----------
  detail: {
    pos: [3.1, 1.15, 4.5],
    look: [1.6, 0.95, 3.0],
    fov: 45,
    time: 16.5,
    doc: 'Close-up on a surface — texel density, normal detail, grime, edge wear.',
  },
  // --- lighting extremes ------------------------------------------------
  sunset: {
    pos: [3.0, 2.6, 16],
    look: [-2.0, 1.7, -8],
    fov: 65,
    time: 19.2,
    doc: 'Low sun — long shadows, scattering, bloom, exposure at the extremes.',
  },
  night: {
    pos: [0, 1.9, 18],
    look: [0, 1.4, -6],
    fov: 70,
    time: 1.5,
    doc: 'Night — artificial lights, exposure adaptation, shadow quality in the dark.',
  },
  // --- interior: bounce, AO, contact shadows ----------------------------
  interior: {
    pos: [-2.6, 1.7, 0.2],
    look: [-6.5, 1.4, 0.0],
    fov: 70,
    time: 16.5,
    doc: 'Enclosed space — ambient occlusion, bounce light, contact shadows.',
  },
  // --- transient FX. `apply` schedules the event to peak ON the captured
  //     frame, using opts.grabFrame — guessing does not work for a 50 ms flash.
  impacts: {
    pos: [3.0, 1.45, 1.4],
    look: [-1.4, 1.2, 0.65],
    fov: 60,
    time: 16.5,
    apply: (e, o) => e.ctx.peek('fx')?.debugBurst?.('wall', o),
    doc: 'Impact FX — decals, sparks, dust, light spill, debris.',
  },
  // --- UI over gameplay -------------------------------------------------
  hud: {
    pos: [0, 1.9, 18],
    look: [0, 1.4, -6],
    fov: 70,
    time: 16.5,
    apply: (e) => e.ctx.peek('ui')?.debugState?.('busy'),
    doc: 'Full HUD in its busiest state — layout, contrast, readability.',
  },
};

/**
 * Put transient gameplay state back to neutral. Called before every shot's own
 * apply(). Without this, the previous shot's looping debug state is still running
 * during the next one, and the next review round reports phantom regressions.
 */
export function clearState(engine) {
  engine.ctx.peek('fx')?.debugBurst?.('none');
  engine.ctx.peek('ui')?.debugState?.('clean');
}
```

## `example/systems/fx.js`

```js
import * as THREE from 'three';
import { InstanceRing, ParticleStore, LightPool, Owned, compileMeshes } from '../../lib/index.js';

/**
 * FX: the subsystem that most often destroys a Three.js frame rate, and the one
 * where the kit's patterns pay off hardest.
 *
 * Every rule here is from a measured failure:
 *   - decals are ONE InstancedMesh ring buffer, not a mesh per hole
 *   - particles are typed arrays with no per-particle object and no allocation
 *     at spawn, updated with swap-with-last compaction
 *   - flash lights come from a LightPool that drives intensity to 0 rather than
 *     `visible = false`, so the shader permutation count never changes
 *   - a `debugBurst(kind, opts)` hook so a shot can stage a transient and land
 *     its peak ON the captured frame
 *   - `prewarmMaterials()` that compiles every FX material WITHOUT spawning
 *     anything, and self-warms late because its cache key depends on the light
 *     count, which is only settled inside the first rendered frame
 */
export class FxSystem {
  static id = 'fx';
  static deps = ['render', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this.own = new Owned();
    this.rng = ctx.rng.fork();
    this.render = ctx.get('render');
    this.now = 0;

    const q = ctx.config.q;
    this.root = new THREE.Group();
    this.root.name = 'fx';
    ctx.scene.add(this.root);

    // ---- decals: one draw call, budget-capped -------------------------
    const decalGeo = this.own.add(new THREE.PlaneGeometry(0.26, 0.26));
    this.decalMat = this.own.add(
      new THREE.MeshBasicMaterial({
        color: 0x121110,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        // Polygon offset, not a position nudge: a nudge along the normal breaks
        // on curved surfaces and at grazing angles.
        polygonOffset: true,
        polygonOffsetFactor: -4,
      })
    );
    this.decals = new InstanceRing(decalGeo, this.decalMat, Math.min(128, q.decalBudget), { parent: this.root });

    // ---- particles: SoA + one additive InstancedMesh ------------------
    this.cap = Math.min(1200, q.particleBudget);
    this.parts = new ParticleStore(this.cap);
    const sparkGeo = this.own.add(new THREE.PlaneGeometry(1, 1));
    this.sparkMat = this.own.add(
      new THREE.MeshBasicMaterial({ color: 0xffc07a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.sparks = new InstanceRing(sparkGeo, this.sparkMat, this.cap, { parent: this.root });
    this.sparks.mesh.count = this.cap; // fixed count; unused slots are scaled to 0
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._zero = new THREE.Vector3(0, 0, 0);

    // ---- flash lights --------------------------------------------------
    this.flashes = new LightPool(this.root, 2, { color: 0xffd9a0, distance: 9 });

    // ---- events ---------------------------------------------------------
    // FX listens; it never reaches into player or weapons to ask what happened.
    ctx.events.on('weapon:fire', (e) => this.onFire(e));
    ctx.events.on('bullet:impact', (e) => this.impact(e.point, e.normal));

    // Scratch for the staged burst: it runs on the frame path, so it allocates
    // nothing. (The event payloads below DO allocate — once per shot fired, which
    // is an input-rate cost, not a frame-rate one. That is the line to hold:
    // never allocate per frame or per particle.)
    this._bp = new THREE.Vector3();
    this._bn = new THREE.Vector3(1, 0, 0.15).normalize();
    this._bl = new THREE.Vector3();

    this._script = null;
    this._warmed = false;
    this._warmTicks = 0;
    this.stats = { spawned: 0, live: 0, rejected: 0 };
  }

  onFire(e) {
    this.flashes.flash(e.origin, 6, 0.05, this.now);
    // Raycast here rather than in the player: physics/collision knowledge lives
    // with whoever owns the colliders, and the emitter should not need it.
    const ray = new THREE.Raycaster(e.origin, e.dir, 0.1, 80);
    const hits = ray.intersectObjects(this.ctx.get('world').root.children, true);
    const hit = hits[0];
    const point = hit ? hit.point : e.origin.clone().addScaledVector(e.dir, 40);
    const normal = hit?.face?.normal?.clone() ?? e.dir.clone().negate();
    if (hit?.object?.matrixWorld) normal.transformDirection(hit.object.matrixWorld);
    this.ctx.events.emit('bullet:impact', { point, normal, surface: 'concrete', incident: e.dir.clone(), damage: 25 });
  }

  /** Spawn one impact: a decal plus a puff of sparks. Allocation-free. */
  impact(point, normal) {
    // Orient the decal to the surface. `lookAt` on a temp Object3D would be
    // clearer and allocates; a quaternion from the plane's +Z does not.
    this._q.setFromUnitVectors(UP_Z, normal);
    this._p.copy(point).addScaledVector(normal, 0.002);
    this._s.setScalar(this.rng.range(0.7, 1.3));
    this.decals.spawn(this._p, this._q, this._s);

    for (let i = 0; i < 14; i++) {
      const d = this.rng.sphere(SPH);
      // Bias into the hemisphere around the surface normal.
      const dot = d.x * normal.x + d.y * normal.y + d.z * normal.z;
      const sign = dot < 0 ? -1 : 1;
      const sp = this.rng.range(1.5, 5.5);
      if (
        this.parts.spawn(
          point.x, point.y, point.z,
          d.x * sign * sp, d.y * sign * sp + 1.2, d.z * sign * sp,
          this.rng.range(0.18, 0.55), this.rng.range(0.012, 0.035), this.rng.float()
        ) >= 0
      ) {
        this.stats.spawned++;
      }
    }
  }

  /**
   * Debug hook for the shot list and the profiler.
   *  'wall'  — repeating burst against the wall the `impacts` shot frames
   *  'none'  — stop, and clear what is on screen (called by clearState)
   *
   * `opts.grabFrame` is how many frames the harness will pump before the
   * shutter, so the burst can be scheduled to peak exactly then.
   *
   * The RNG is re-seeded on every call: the burst must be identical no matter
   * what ran before it, or back-to-back shots are not reproducible.
   */
  debugBurst(kind, opts = {}) {
    this.rng.seed(0xbeef1234);
    if (kind === 'none' || !kind) {
      this._script = null;
      for (let i = 0; i < this.decals.capacity; i++) this.decals.clear(i);
      this.decals.mesh.count = 0;
      this.decals.cursor = 0;
      this.parts.count = 0;
      this.flashes.update(1e9); // expire every flash
      return { cleared: true };
    }
    const grab = Number(opts.grabFrame ?? 60);
    this._script = { kind, startFrame: this.ctx.time.frame, peakAt: Math.max(4, grab - 6), fired: 0 };
    return { staged: kind, peakAt: this._script.peakAt };
  }

  update(dt, ctx) {
    this.now = ctx.time.elapsed;

    // Run the staged burst off the FRAME INDEX, not a wall clock, so it lands on
    // the same frame in every run.
    const s = this._script;
    if (s) {
      const age = ctx.time.frame - s.startFrame;
      if (age <= s.peakAt && age % 7 === 0) {
        const p = this._bp.set(-1.4 + this.rng.range(-0.5, 0.5), 1.2 + this.rng.range(-0.4, 0.6), 0.6);
        this.flashes.flash(this._bl.copy(p).addScaledVector(this._bn, 0.4), 5, 0.06, this.now);
        this.impact(p, this._bn);
        s.fired++;
      }
    }

    this.flashes.update(this.now);
    const live = this.parts.step(dt, -7.5, 1.6);
    this.stats.live = live;
    this.stats.rejected = 0;

    // One matrix write per live particle, one needsUpdate for the whole mesh.
    const P = this.parts;
    for (let i = 0; i < this.cap; i++) {
      if (i < live) {
        const j = i * 3;
        const t = 1 - P.age[i] / P.life[i];
        this._p.set(P.pos[j], P.pos[j + 1], P.pos[j + 2]);
        this._s.setScalar(P.size[i] * (0.4 + t));
        // Billboard: copy the camera's rotation, do not compute a lookAt per
        // particle.
        this._q.copy(ctx.camera.quaternion);
        this.sparks.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      } else {
        this.sparks.mesh.setMatrixAt(i, this._m.compose(this._p.set(0, -1000, 0), this._q, this._zero));
      }
    }
    this.sparks.mesh.instanceMatrix.needsUpdate = true;
    this.decals.flush();

    // Self-warm on frame 2: our cache key depends on the number of visible
    // lights, which is only settled inside the first rendered frame. Warming any
    // earlier compiles a permutation the frame loop never asks for AND latches
    // the flag, so the real programs go back to compiling on first use.
    if (!this._warmed && ++this._warmTicks >= 2) {
      this._warmed = true;
      this.prewarmMaterials(ctx);
    }
  }

  /** Compile every FX program without spawning anything into the world. */
  prewarmMaterials(ctx) {
    const compiled = compileMeshes(
      this.render.renderer,
      [this.decals.mesh, this.sparks.mesh],
      ctx.scene,
      ctx.camera
    );
    this._warmed = true;
    return { ok: true, compiled };
  }

  dispose() {
    this.decals.dispose();
    this.sparks.dispose();
    this.flashes.dispose();
    this.root.parent?.remove(this.root);
    this.own.disposeAll();
  }
}

const UP_Z = new THREE.Vector3(0, 0, 1);
const SPH = { x: 0, y: 0, z: 0 };
```

## `example/systems/player.js`

```js
import * as THREE from 'three';
import { scratch } from '../../lib/index.js';

const S = scratch(); // module scope, allocated once — never inside update()
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Player: input -> intent -> motion, plus the two hooks the harness needs.
 *
 * The two hooks are not optional extras; every tool in the kit uses them:
 *   setControlEnabled(false)  the shot API takes the camera away
 *   teleport(pos, rot)        the shot API puts the player proxy under the camera
 *                             so audio, AI perception and occlusion stay coherent
 *
 * Movement runs in fixedUpdate at 120 Hz — deterministic, frame-rate independent,
 * and the same on a 30 fps laptop as a 240 Hz monitor. Look runs in update,
 * because mouse delta is per-frame by nature and smoothing it into a fixed step
 * adds latency you can feel.
 */
export class PlayerSystem {
  static id = 'player';
  static deps = ['world'];

  async init(ctx) {
    this.ctx = ctx;
    this.enabled = true;
    this.pos = new THREE.Vector3(0, 1.7, 16);
    this.vel = new THREE.Vector3();
    /**
     * ORIENTATION CONVENTION, stated once because everything else derives from
     * it: a camera looks down its local -Z, and `yaw` is a rotation about +Y.
     * So in world space
     *     forward = (-sin yaw, 0, -cos yaw)
     *     right   = ( cos yaw, 0, -sin yaw)
     * and yaw = 0 faces -Z. To face a point, `yaw = atan2(x - px, z - pz)`.
     */
    this.yaw = 0; // down the street, matching the `hero` shot
    this.pitch = -0.05;
    this.eye = 1.7;
    this.radius = 0.35;
    this.speed = 5.2;
    this.sprint = 8.4;
    this.accel = 60;
    this.stepDist = 0;
    this.colliders = ctx.get('world').colliders;
    // Reused every collision test; a Box3 per collider per frame is 200+
    // allocations a frame for nothing.
    this._boxes = this.colliders.map((m) => new THREE.Box3().setFromObject(m));
    this._syncCamera(ctx);
  }

  setControlEnabled(on) {
    this.enabled = !!on;
  }

  teleport(position, rotation) {
    this.pos.copy(position);
    if (rotation) {
      this.yaw = rotation.y;
      this.pitch = rotation.x;
    }
    this.vel.set(0, 0, 0);
  }

  update(dt, ctx) {
    if (!this.enabled || !ctx.input) return;
    // Look. Clamp pitch just inside +-90 so the view can never flip.
    this.yaw -= ctx.input.look.x;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - ctx.input.look.y));
  }

  fixedUpdate(h, ctx) {
    if (!this.enabled || !ctx.input) {
      this._syncCamera(ctx);
      return;
    }
    const input = ctx.input;
    const ax = input.axis2();
    const sprinting = input.held('sprint') && ax.y > 0;

    /**
     * Intent in VIEW space — +X right, -Z forward, exactly the camera's own axes —
     * then rotated into world space by yaw about +Y.
     *
     * Rotate with applyAxisAngle rather than hand-rolling the 2x2. Hand-rolling it
     * is how this example shipped with the yaw applied BACKWARDS: W still moved
     * you, at the right speed, so both the smoke test (which checked distance
     * travelled) and every screenshot passed — but turning left swung the movement
     * basis right, so the controls read as mirrored/absolute rather than
     * camera-relative. applyAxisAngle allocates nothing and cannot get the sign
     * wrong. See PITFALLS F1.
     */
    const target = S.v0.set(ax.x, 0, -ax.y);
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(sprinting ? this.sprint : this.speed);
    target.applyAxisAngle(UP, this.yaw);

    // Exponential approach: frame-rate independent, and the feel is one number.
    const k = 1 - Math.exp(-this.accel * h);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;

    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += this.vel.x * h;
    this.pos.z += this.vel.z * h;
    this._resolve();

    // Footsteps come from DISTANCE TRAVELLED, not from a timer. A timer desyncs
    // from the legs the moment speed changes, and every reviewer hears it.
    this.stepDist += Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    const stride = sprinting ? 2.1 : 1.55;
    if (this.stepDist >= stride) {
      this.stepDist -= stride;
      ctx.events.emit('player:footstep', { position: this.pos.clone(), running: sprinting, surface: 'concrete' });
    }

    if (input.pressed('primary')) {
      // The player does not decide what firing LOOKS like — it announces the
      // event and fx/audio/ui each do their own job. That is what keeps a
      // subsystem replaceable.
      const dir = S.v1.set(0, 0, -1).applyEuler(S.e0.set(this.pitch, this.yaw, 0, 'YXZ'));
      ctx.events.emit('weapon:fire', {
        weapon: 'primary',
        origin: this.pos.clone().setY(this.pos.y),
        dir: dir.clone(),
        seed: ctx.rng.u32(),
      });
    }
    this._syncCamera(ctx);
  }

  /** Push out of any collider we ended up inside. A real game wants a swept
   *  capsule; this is the 20-line version that stops you walking through walls. */
  _resolve() {
    for (let i = 0; i < this._boxes.length; i++) {
      const b = this._boxes[i];
      if (this.pos.y + 0.4 < b.min.y || this.pos.y - 0.4 > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(this.pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(this.pos.z, b.max.z));
      const dx = this.pos.x - cx;
      const dz = this.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= this.radius * this.radius) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const push = (this.radius - d) / d;
      this.pos.x += dx * push;
      this.pos.z += dz * push;
      // Kill the velocity component into the surface, or you stick to walls.
      const nx = dx / d, nz = dz / d;
      const into = this.vel.x * nx + this.vel.z * nz;
      if (into < 0) {
        this.vel.x -= into * nx;
        this.vel.z -= into * nz;
      }
    }
  }

  _syncCamera(ctx) {
    if (!this.enabled) return; // a shot owns the camera; do not fight it
    ctx.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
    ctx.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
```

## `example/systems/render.js`

```js
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
```

## `example/systems/ui.js`

```js
/**
 * UI in the DOM, not in WebGL. Text rendered by the browser is crisper than
 * anything you will hand-roll in a canvas texture, it costs no draw calls, and
 * it is inspectable in devtools.
 *
 * Two rules that come from capture reproducibility:
 *  1. NO `will-change: transform` / `transform: translateZ(0)` on anything that
 *     animates. It promotes the element to a composited layer whose raster is
 *     taken at a wall-clock-dependent moment, and the reference project spent
 *     real time chasing that as a "renderer" nondeterminism.
 *  2. Animate off the engine clock like everything else. A CSS animation or
 *     transition is on the browser's clock, so its phase at the shutter depends
 *     on how long boot took.
 */
import { TouchControls } from '../../lib/index.js';

export class UiSystem {
  static id = 'ui';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    /**
     * A DIAGNOSTIC OVERLAY WILL DEFEAT YOUR OWN PIXEL GATE. This example printed
     * the live WebGL program count in the corner; the pixel gate then reported
     * every shot as changed when shader pre-warm was toggled — not because the
     * render moved, but because the number on screen did. The diff's bounding box
     * was a 7x9 px digit at the bottom-left, which is how it was identified in
     * one look.
     *
     * So: volatile diagnostics (fps, program counts, timings, entity counts) are
     * for the live window only. The HUD a reviewer captures shows game state,
     * which is deterministic.
     */
    this.showDiagnostics = !ctx.config.deterministic;
    this.host = document.getElementById('ui') ?? document.body;
    this.host.innerHTML = `
      <div data-hud style="position:absolute;left:16px;bottom:14px;opacity:.9">
        <div data-state style="font-size:14px;letter-spacing:.06em"></div>
        <div data-stats style="opacity:.6;margin-top:4px"></div>
      </div>
      <div data-crosshair style="position:absolute;left:50%;top:50%;width:14px;height:14px;
        margin:-7px 0 0 -7px;border:1px solid rgba(255,255,255,.75);border-radius:50%"></div>
      <div data-hit style="position:absolute;left:50%;top:50%;width:26px;height:26px;
        margin:-13px 0 0 -13px;opacity:0;border:2px solid #fff;transform:rotate(45deg)"></div>
    `;
    this.stats = this.host.querySelector('[data-stats]');
    this.state = this.host.querySelector('[data-state]');
    this.hit = this.host.querySelector('[data-hit]');
    this.shots = 0;
    ctx.events.on('weapon:fire', () => this.shots++);
    this.hitUntil = -1;
    this.mode = 'clean';
    ctx.events.on('bullet:impact', () => {
      this.hitUntil = ctx.time.elapsed + 0.12;
    });

    /**
     * On-screen controls, hidden until a real finger touches the screen — so a
     * headless capture never sees them and the pixel gate is unaffected. The
     * left of the screen is already a movement stick and the right already
     * looks; these are for the actions a thumb cannot express as a drag.
     */
    this.touch = new TouchControls(ctx.input, {
      host: this.host,
      buttons: [{ action: 'jump', label: 'JUMP' }, { action: 'primary', label: 'FIRE' }],
    }).attach();
  }

  /** Debug hook so the `hud` shot can capture the busiest state. */
  debugState(mode) {
    this.mode = mode;
    if (mode === 'busy') this.hitUntil = Infinity;
    if (mode === 'clean') this.hitUntil = -1;
    return { mode };
  }

  lateUpdate(dt, ctx) {
    // Throttle DOM writes: a text update every frame is a layout every frame.
    if (ctx.time.frame % 6 === 0) {
      // Game state: deterministic, safe to capture.
      this.state.textContent = `HEALTH 100    AMMO ${Math.max(0, 30 - (this.shots % 31))}/120` + (this.mode === 'busy' ? '    [BUSY]' : '');
      if (this.showDiagnostics) {
        const info = window.__RENDER_INFO__;
        const fx = ctx.peek('fx');
        this.stats.textContent =
          `frame ${ctx.time.frame}  ${(1 / Math.max(1e-4, ctx.time.dt)).toFixed(0)} fps  ` +
          `calls ${info?.calls ?? 0}  tris ${((info?.tris ?? 0) / 1000).toFixed(0)}k  ` +
          `progs ${info?.programs ?? 0}  particles ${fx?.stats.live ?? 0}`;
      }
    }
    this.hit.style.opacity = ctx.time.elapsed < this.hitUntil ? '0.9' : '0';
    this.touch.sync();
  }

  dispose() {
    this.touch.dispose();
    this.host.innerHTML = '';
  }
}
```

## `example/systems/world.js`

```js
import * as THREE from 'three';
import { LightBallast, Owned, disposeTree, compileMeshes } from '../../lib/index.js';

/**
 * World: level geometry, props, static colliders, practical lights.
 *
 * Three things here are worth copying regardless of genre:
 *  1. EVERY texture is generated from ctx.rng, so the level is identical on every
 *     run and a pixel diff means something.
 *  2. Repeated props are ONE InstancedMesh, not 200 meshes. 200 draw calls of a
 *     crate is the most common reason a Three.js scene is slow for no reason.
 *  3. The practical lights are behind a LightBallast, because a light crossing
 *     its cull radius otherwise recompiles every lit material in the scene.
 *     See lib/lights.js — this was the worst single stall source in the
 *     reference project.
 */
export class WorldSystem {
  static id = 'world';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx;
    this.own = new Owned();
    const rng = ctx.rng.fork(); // own stream: our detail must not depend on FX
    this.root = new THREE.Group();
    this.root.name = 'world';
    ctx.scene.add(this.root);

    const render = ctx.get('render');
    const aniso = Math.min(ctx.config.q.anisotropy, render.renderer.capabilities.getMaxAnisotropy());

    // ---- procedural surfaces -------------------------------------------
    const ground = this.own.add(noiseTexture(rng, 256, { base: [0.44, 0.41, 0.37], grain: 0.5, repeat: 24, aniso }));
    const wall = this.own.add(noiseTexture(rng, 256, { base: [0.62, 0.56, 0.47], grain: 0.35, repeat: 4, aniso }));
    const crate = this.own.add(noiseTexture(rng, 128, { base: [0.52, 0.38, 0.22], grain: 0.3, repeat: 1, aniso }));

    this.matGround = this.own.add(new THREE.MeshStandardMaterial({ map: ground, roughness: 0.92, metalness: 0 }));
    this.matWall = this.own.add(new THREE.MeshStandardMaterial({ map: wall, roughness: 0.78, metalness: 0 }));
    this.matCrate = this.own.add(new THREE.MeshStandardMaterial({ map: crate, roughness: 0.7, metalness: 0 }));

    // ---- ground ---------------------------------------------------------
    // Tessellated, not a single quad: a 2-triangle floor cannot receive a
    // gradient from a point light, and vertex-lit engines aside, it also gives
    // nothing for AO or contact shadows to bite into.
    const g = this.own.add(new THREE.PlaneGeometry(120, 120, 48, 48));
    g.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(g, this.matGround);
    floor.receiveShadow = true;
    floor.name = 'ground';
    this.root.add(floor);

    // ---- buildings: real wall thickness, real openings -------------------
    // Boxes, not planes. A plane wall has no reveal, so windows and doorways
    // read as stickers and light leaks through the edge.
    this.colliders = [];
    const wallGeo = this.own.add(new THREE.BoxGeometry(1, 1, 1));
    const addBlock = (x, z, w, h, d) => {
      const m = new THREE.Mesh(wallGeo, this.matWall);
      m.position.set(x, h / 2, z);
      m.scale.set(w, h, d);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
      this.colliders.push(m);
      return m;
    };
    // A street with an enclosed room on the left (the `interior` shot).
    addBlock(-9, 0, 6, 4, 14);
    addBlock(-4.4, -5.5, 3.5, 4, 0.4);
    addBlock(-4.4, 5.5, 3.5, 4, 0.4);
    addBlock(-4.4, 0, 0.4, 4, 4); // back wall of the room
    addBlock(9, 2, 6, 6, 20);
    addBlock(0, -12, 24, 5, 1);

    // ---- instanced props: ONE draw call ---------------------------------
    const COUNT = 220;
    const box = this.own.add(new THREE.BoxGeometry(0.7, 0.7, 0.7));
    this.props = new THREE.InstancedMesh(box, this.matCrate, COUNT);
    this.props.castShadow = this.props.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    // Instances 0-2 are a DELIBERATE stack at a known position, because the
    // `detail` shot frames it. Do not leave a review shot pointing at randomly
    // placed geometry: in the reference project the impact shot was aimed down an
    // open street for three rounds, so the decals it existed to show were staged
    // 20 m away and never legible, and every critique of it was about something
    // else.
    const FEATURE = { x: 1.6, z: 3.0 };
    for (let i = 0; i < COUNT; i++) {
      if (i < 3) {
        v.set(FEATURE.x + (i === 2 ? 0.18 : 0), 0.35 + i * 0.7, FEATURE.z + (i === 1 ? -0.12 : 0));
        e.set(0, 0.35 + i * 0.22, 0);
        q.setFromEuler(e);
        s.setScalar(1.0);
        this.props.setMatrixAt(i, m4.compose(v, q, s));
        continue;
      }
      const ring = 4.5 + rng.float() * 15;
      const a = rng.float() * Math.PI * 2;
      v.set(Math.cos(a) * ring, 0, Math.sin(a) * ring);
      const stack = rng.int(0, 2);
      v.y = 0.35 + stack * 0.7;
      // Nothing perfectly straight, clean or repeated: vary yaw and scale or
      // 220 crates read as 1 crate copy-pasted, which is exactly how a reviewer
      // will describe it.
      e.set(rng.range(-0.03, 0.03), rng.float() * Math.PI * 2, rng.range(-0.03, 0.03));
      q.setFromEuler(e);
      s.setScalar(rng.range(0.85, 1.25));
      this.props.setMatrixAt(i, m4.compose(v, q, s));
    }
    this.props.instanceMatrix.needsUpdate = true;
    this.root.add(this.props);

    // ---- practical lights + ballast -------------------------------------
    this.lampSlots = Math.min(4, ctx.config.q.maxDynamicLights);
    this.lamps = [];
    for (let i = 0; i < this.lampSlots; i++) {
      const l = new THREE.PointLight(0xffb765, 0, 14, 2);
      l.position.set(-6 + i * 5.5, 2.6, i % 2 ? 4 : -4);
      l.castShadow = false;
      this.root.add(l);
      this.lamps.push(l);
    }
    // Slots the shader will ALWAYS see, whatever the cull decides.
    this.ballast = new LightBallast(this.root, this.lampSlots, 2);
    this.ballast.update(0);

    console.info(`[world] ${this.colliders.length} colliders · ${COUNT} instanced props`);
  }

  update(dt, ctx) {
    // Lamps on at night. Driven by the render system's time of day — a pure
    // function of state, never of performance.now().
    const hour = ctx.get('render').timeOfDay;
    const night = hour < 6.5 || hour > 18.5 ? 1 : 0;
    for (const l of this.lamps) l.intensity = night * 12;
  }

  /** In lateUpdate, after everything has moved: hold the visible point-light
   *  count constant. Here every lamp is always visible, so `realVisible` is a
   *  constant; in a real game you predict it with the same test the cull uses. */
  lateUpdate() {
    this.ballast.update(this.lamps.length);
  }

  async prewarmMaterials(ctx) {
    const meshes = [];
    this.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    return { ok: true, compiled: compileMeshes(ctx.get('render').renderer, meshes, ctx.scene, ctx.camera) };
  }

  dispose() {
    this.ballast.dispose();
    disposeTree(this.root);
    this.root.parent?.remove(this.root);
    this.own.disposeAll();
  }
}

/**
 * A procedural surface in 30 lines: value noise into a DataTexture. Not
 * production art — the point is that it is DETERMINISTIC (seeded by ctx.rng) and
 * that it has variation at more than one frequency, which is the difference
 * between "a texture" and "a flat colour".
 */
function noiseTexture(rng, size, { base, grain, repeat, aniso }) {
  const data = new Uint8Array(size * size * 4);
  // Two octaves of a cheap seeded lattice, plus per-pixel grain.
  const lattice = new Float32Array(64 * 64);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float();
  const samp = (x, y, f) => {
    const xf = x * f, yf = y * f;
    const x0 = Math.floor(xf) & 63, y0 = Math.floor(yf) & 63;
    const x1 = (x0 + 1) & 63, y1 = (y0 + 1) & 63;
    const tx = xf - Math.floor(xf), ty = yf - Math.floor(yf);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = lattice[y0 * 64 + x0], b = lattice[y0 * 64 + x1];
    const c = lattice[y1 * 64 + x0], d = lattice[y1 * 64 + x1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.6 * samp(x / size, y / size, 8) + 0.3 * samp(x / size, y / size, 26) + 0.1 * rng.float();
      const k = 1 - grain * 0.5 + grain * n;
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, base[0] * 255 * k);
      data[i + 1] = Math.min(255, base[1] * 255 * k);
      data[i + 2] = Math.min(255, base[2] * 255 * k);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}
```
