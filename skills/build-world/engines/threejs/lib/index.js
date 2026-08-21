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
