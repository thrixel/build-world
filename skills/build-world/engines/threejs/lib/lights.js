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
