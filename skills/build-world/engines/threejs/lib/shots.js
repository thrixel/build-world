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
export async function signalReady(shotApi, bootFrames = 3) {
  if (shotApi.lockstep) {
    await shotApi.pump(bootFrames);
    window.__READY__ = true;
    return;
  }
  let warm = 0;
  const probe = () => {
    if (++warm >= bootFrames) {
      window.__READY__ = true;
      return;
    }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
}
