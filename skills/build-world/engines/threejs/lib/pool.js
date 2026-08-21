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
