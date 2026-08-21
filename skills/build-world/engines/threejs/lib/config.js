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
