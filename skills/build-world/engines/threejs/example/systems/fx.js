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
