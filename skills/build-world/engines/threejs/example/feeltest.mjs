#!/usr/bin/env node
/**
 * PLAYER FEEL BENCH — the only honest way to review a movement controller.
 *
 * Boots the real game in Chromium under `?capture=1&lockstep=1`, so the engine
 * advances exactly one deterministic 1/60 frame per pump, drives the REAL input
 * layer, and then measures what actually happened.
 *
 * WHY THIS EXISTS: this example shipped with the movement yaw applied backwards.
 * Every other gate passed — the build was clean, all 7 shots captured, and the
 * smoke test reported "movement 4.40 m holding KeyW", because it checked the
 * DISTANCE travelled and never the DIRECTION. A mirrored control scheme is
 * invisible to a screenshot and to any magnitude-only check. It is trivially
 * visible to this: the dot product between the displacement and the camera's
 * forward vector was -0.14 instead of 1.00.
 *
 * The pattern generalises: anything whose correctness is a relationship between
 * two runtime quantities needs a bench, not a screenshot. Copy this shape for
 * vehicle handling, jump arcs, projectile lead, camera follow, IK reach.
 *
 *   node example/feeltest.mjs --port=5279
 *   node example/feeltest.mjs --port=5279 --json
 */
import { resolve } from 'node:path';
import * as H from '../tools/lib/harness.mjs';
import { suite } from '../lib/selftest.js';

const args = H.parseArgs();
const PORT = Number(args.port ?? 5279);
const ROOT = resolve(args.root ?? process.cwd());

const server = await H.ensureServer({ port: PORT, root: ROOT });
const browser = await H.launchBrowser();
const page = await H.newPage(browser, { w: 640, h: 400 });

let result = null;
let failed = null;
try {
  await H.open(page, H.buildUrl({ port: PORT, lockstep: true }));
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input.takeControl();
    e.ctx.peek('player').setControlEnabled(true);
  });
  result = await runBench(page);
} catch (e) {
  failed = e;
  console.error(page.__logs.slice(-20).join('\n'));
} finally {
  await browser.close();
  server?.kill();
}
if (failed) {
  console.error(String(failed.message ?? failed));
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.worstAlignment < 0.999 ? 1 : 0);
}
process.exit(report(result));

/* ===================================================================== */

async function runBench(page) {
  /**
   * Place the player, hold `keys`, pump frames, return the displacement.
   *
   * Two things here are load-bearing, both found by this bench failing:
   *  1. PUMP ONE FRAME AFTER PLACING, before reading the start state. Writing
   *     `player.pos`/`player.yaw` does not move the camera — the mover syncs it
   *     inside fixedUpdate — so reading the camera immediately gives the PREVIOUS
   *     case's pose and every displacement is measured from the wrong origin.
   *  2. START SOMEWHERE THE RUN FITS. A run that hits a wall reports a slower
   *     speed and a deflected direction, which reads exactly like a controller
   *     bug. `expectSpeed` catches it instead of letting it masquerade.
   */
  const move = async (yaw, keys, { frames = 24, from = [0, 1.7, 0] } = {}) => {
    await page.evaluate(
      ({ yaw, keys, from }) => {
        const e = window.__ENGINE__;
        const p = e.ctx.peek('player');
        p.pos.set(from[0], from[1], from[2]);
        p.vel.set(0, 0, 0);
        p.yaw = yaw;
        p.pitch = 0;
        // Release everything from the previous case, then hold this case's keys.
        // Same-frame release+press is why lib/input.js queues events in order.
        for (const c of [...e.input.down]) e.input.inject(c, false);
        for (const c of keys) e.input.inject(c, true);
      },
      { yaw, keys, from }
    );
    await H.pump(page, 1); // sync the camera to the pose we just wrote
    const before = await state(page);
    await H.pump(page, frames);
    const after = await state(page);
    return {
      // Camera forward/right read off the LIVE camera matrix, not recomputed from
      // yaw: comparing the mover's own formula against itself would prove nothing.
      forward: after.forward,
      right: after.right,
      // The MOVER's position is the authority; the camera is downstream of it.
      delta: sub(after.pos, before.pos),
      seconds: frames / 60,
    };
  };

  const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7];
  const cases = [];
  for (const yaw of YAWS) {
    const fwd = await move(yaw, ['KeyW']);
    const back = await move(yaw, ['KeyS']);
    const right = await move(yaw, ['KeyD']);
    const left = await move(yaw, ['KeyA']);
    cases.push({
      yaw: +yaw.toFixed(3),
      // 1.0 means "moved exactly where the camera points".
      forwardDot: dot(norm(fwd.delta), fwd.forward),
      backDot: -dot(norm(back.delta), back.forward),
      rightDot: dot(norm(right.delta), right.right),
      leftDot: -dot(norm(left.delta), left.right),
      // Slowest of the four runs. Well below the walk speed means one of them was
      // deflected by geometry, so treat its direction as unmeasured, not wrong.
      minSpeed: Math.min(...[fwd, back, right, left].map((m) => len(m.delta) / m.seconds)),
    });
  }

  /**
   * Speeds, measured in steady state after acceleration has settled. Each run is
   * aimed straight down the open street (-Z) by choosing the yaw that puts the
   * pressed direction there, so a 10 m sprint cannot reach a wall:
   *   W  -> forward is -Z at yaw 0
   *   D  -> right   is -Z at yaw  pi/2
   *   W+D-> the 45 deg blend is -Z at yaw pi/4
   */
  const FROM = [0, 1.7, 10];
  const run = async (yaw, keys) => {
    await move(yaw, keys, { frames: 40, from: FROM }); // accelerate
    return steady(page); // then measure
  };
  const walk = await run(0, ['KeyW']);
  const sprint = await run(0, ['KeyW', 'ShiftLeft']);
  const strafe = await run(Math.PI / 2, ['KeyD']);
  // Diagonals must not be faster than a straight line (the classic bug).
  const diag = await run(Math.PI / 4, ['KeyW', 'KeyD']);

  const dots = cases.flatMap((c) => [c.forwardDot, c.backDot, c.rightDot, c.leftDot]);
  return { cases, walk, sprint, strafe, diag, worstAlignment: Math.min(...dots) };
}

/** Speed over the next 30 frames, with whatever keys are currently held. */
async function steady(page) {
  const a = await state(page);
  await H.pump(page, 30);
  const b = await state(page);
  return +(len(sub(b.pos, a.pos)) / 0.5).toFixed(3);
}

function state(page) {
  return page.evaluate(() => {
    const e = window.__ENGINE__;
    const c = e.camera;
    c.updateMatrixWorld(true);
    const m = c.matrixWorld.elements;
    return {
      pos: [c.position.x, c.position.y, c.position.z],
      // Columns of the camera's world matrix: +X is right, -Z is forward.
      right: [m[0], m[1], m[2]],
      forward: [-m[8], -m[9], -m[10]],
    };
  });
}

// Function declarations, not const arrows: runBench() is called from a top-level
// await ABOVE these lines, and a const in the temporal dead zone throws
// "Cannot access 'state' before initialization".
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(v) { return Math.hypot(v[0], v[1], v[2]); }
function norm(v) { const l = len(v) || 1e-9; return [v[0] / l, v[1] / l, v[2] / l]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function report(r) {
  const t = suite('player feel');
  t.section('camera-relative movement (1.000 = moves exactly where you look)');
  for (const c of r.cases) {
    const y = `yaw ${String(c.yaw).padStart(6)}`;
    t.near(c.forwardDot, 1, 0.001, `${y}  W -> forward`);
    t.near(c.backDot, 1, 0.001, `${y}  S -> back`);
    t.near(c.rightDot, 1, 0.001, `${y}  D -> right`);
    t.near(c.leftDot, 1, 0.001, `${y}  A -> left`);
    // Guards the four dots above: a blocked run makes them meaningless.
    t.range(c.minSpeed, 4.9, 5.5, `${y}  no run deflected`, ' m/s');
  }
  t.section('speeds');
  t.near(r.walk, 5.2, 0.15, 'walk top speed', ' m/s');
  t.near(r.sprint, 8.4, 0.2, 'sprint top speed', ' m/s');
  t.near(r.strafe, 5.2, 0.15, 'strafe top speed', ' m/s');
  t.range(r.diag, 5.0, 5.4, 'diagonal not faster', ' m/s');
  return t.report();
}
