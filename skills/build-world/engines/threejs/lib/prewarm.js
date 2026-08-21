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
