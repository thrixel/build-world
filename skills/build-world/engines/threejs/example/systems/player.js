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
