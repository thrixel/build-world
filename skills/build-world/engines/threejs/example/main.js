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
