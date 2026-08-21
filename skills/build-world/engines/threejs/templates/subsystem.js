import * as THREE from 'three';
import { scratch, Owned, disposeTree, compileMeshes, Pool } from '../lib/index.js';

/** Module-scope scratch. Allocated once. Never inside a per-frame function. */
const S = scratch();

/**
 * <SYSTEM> — <one line: what it owns>.
 *
 * Copy this file, delete what you do not need, and keep the parts that are
 * commented as contract. Every hook here exists because a tool depends on it.
 */
export class TemplateSystem {
  /** Unique id. Others reach you with ctx.get('<id>') — never by import. */
  static id = 'template';
  /** Systems that must init() before you. Topo-sorted; order of add() is irrelevant. */
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx;
    /** Everything disposable you create goes through this. */
    this.own = new Owned();
    /** Your OWN random stream, so your output does not depend on what another
     *  subsystem consumed from the shared one. */
    this.rng = ctx.rng.fork();

    this.root = new THREE.Group();
    this.root.name = TemplateSystem.id;
    ctx.scene.add(this.root);

    const q = ctx.config.q;
    // Fixed-capacity pool sized from the budget. Never grows; counts rejections.
    this.things = new Pool(
      q.particleBudget,
      () => ({ alive: false, position: new THREE.Vector3() }),
      (t) => {
        t.alive = false;
      }
    );

    // Listen; never reach into another subsystem to ask what happened.
    ctx.events.on('example:event', (e) => this.onExample(e));
  }

  onExample(e) {
    const t = this.things.acquire();
    if (!t) return; // at budget — dropping is correct, growing is not
    t.alive = true;
    t.position.copy(e.position);
  }

  /** Deterministic simulation. 0..N times per frame. Do NOT read input edges here. */
  fixedUpdate(h, ctx) {}

  /** Once per frame. Animation, decisions, anything reading input edges. */
  update(dt, ctx) {
    // Animate off the engine clock. NEVER performance.now(). See PITFALLS A3.
    const t = ctx.time.elapsed;
    S.v0.set(Math.sin(t), 0, Math.cos(t)); // scratch, no allocation
  }

  /** After every update(), before render: anything that must see final transforms
   *  (attachments, light-count stabilisation, instance buffer flushes). */
  lateUpdate(dt, ctx) {}

  resize(w, h, ctx) {}

  /**
   * CONTRACT: compile every material this subsystem can produce, WITHOUT spawning
   * gameplay objects, drawing a gameplay frame, or touching the clock or the RNG.
   * compileMeshes() binds a 1x1 render target first, which is what puts the right
   * colour space and tone mapping in the program cache key. See PITFALLS B3/B4.
   */
  async prewarmMaterials(ctx) {
    const meshes = [];
    this.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    return { ok: true, compiled: compileMeshes(ctx.get('render').renderer, meshes, ctx.scene, ctx.camera) };
  }

  /**
   * Debug hook for the shot list and the profiler. `kind === 'none'` must FULLY
   * clear — a looping effect that survives into the next shot produces phantom
   * regressions in the next review round (PITFALLS A6).
   *
   * `opts.grabFrame` is how many frames the harness pumps before the shutter; use
   * it to land a transient's peak on the captured frame. Re-seed the RNG so the
   * staged effect is identical regardless of what ran before it.
   */
  debugStage(kind, opts = {}) {
    this.rng.seed(0x51a6ed);
    if (kind === 'none' || !kind) {
      /* clear everything you staged */
      return { cleared: true };
    }
    return { staged: kind, peakAt: Math.max(4, Number(opts.grabFrame ?? 60) - 6) };
  }

  dispose() {
    disposeTree(this.root);
    this.root.parent?.remove(this.root);
    this.own.disposeAll();
  }
}
