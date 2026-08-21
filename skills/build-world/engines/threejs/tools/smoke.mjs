#!/usr/bin/env node
/**
 * smoke.mjs — does the game still WORK? Run this after every change; it is 8
 * seconds and it catches the failures a screenshot cannot.
 *
 * A capture can look perfect while the game is broken: input dead, nothing
 * moving, an exception thrown every frame in a subsystem whose output happens to
 * be off-screen, transforms gone NaN, the scene graph growing without bound.
 * This drives the REAL input layer and then asserts on state.
 *
 * What it checks:
 *   boot            page reaches __READY__ with no pageerror / console error
 *   movement        holding the move key actually moves the camera
 *   events          the primary action emits the events other systems listen for
 *   NaN             no non-finite transform anywhere in either scene
 *   leaks           object count, geometry count and texture count stable over time
 *   frame health    the loop is advancing and dt is sane
 *
 * WHAT IT DELIBERATELY CANNOT TELL YOU: the movement check measures DISTANCE, not
 * DIRECTION, so it passes a game whose control basis is mirrored or rotated (see
 * PITFALLS F1 — that bug shipped in this kit's own example and this tool reported
 * "movement 4.40 m"). `forwardAlignment` in the output is the diagnostic: 1.0 means
 * the drive key moved you exactly where the camera points. Pass `--expect=forward`
 * to make it a hard check, for any game where the drive key IS camera-forward.
 * Anything deeper than that needs a bench — see `example/feeltest.mjs`.
 *
 *   node tools/smoke.mjs
 *   node tools/smoke.mjs --drive=KeyW --action=Mouse0 --events=weapon:fire,bullet:impact
 *   node tools/smoke.mjs --expect=forward
 */
import { resolve } from 'node:path';
import * as H from './lib/harness.mjs';

const args = H.parseArgs();
const PORT = Number(args.port ?? 5173);
const ROOT = resolve(args.root ?? process.cwd());
const DRIVE = String(args.drive ?? 'KeyW');
const ACTION = String(args.action ?? 'Mouse0');
const EVENTS = String(args.events ?? '').split(',').filter(Boolean);
/** `--expect=forward` turns the direction diagnostic into a hard check. */
const EXPECT = String(args.expect ?? '');
const FRAMES = Number(args.frames ?? 45);

const server = await H.ensureServer({ port: PORT, root: ROOT });
const browser = await H.launchBrowser();
const page = await H.newPage(browser, { w: 1280, h: 720 });

const report = { ok: true, checks: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  if (!pass) report.ok = false;
  return pass;
};

try {
  const t0 = Date.now();
  await H.open(page, `http://127.0.0.1:${PORT}/`);
  report.bootMs = Date.now() - t0;
  check('boot', true, `${report.bootMs} ms`);

  const snap = () =>
    page.evaluate(() => {
      const e = window.__ENGINE__;
      const c = e.camera.position;
      let objects = 0, nan = 0;
      const walk = (root) =>
        root.traverse((o) => {
          objects++;
          const p = o.position, s = o.scale, q = o.quaternion;
          if (!Number.isFinite(p.x + p.y + p.z + s.x + s.y + s.z + q.x + q.y + q.z + q.w)) nan++;
        });
      walk(e.scene);
      walk(e.overlayScene ?? e.viewScene ?? new (e.scene.constructor)());
      const info = e.ctx.peek('render')?.renderer?.info;
      e.camera.updateMatrixWorld(true);
      const m = e.camera.matrixWorld.elements;
      return {
        pos: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)],
        // -Z column of the camera's world matrix: where it is actually looking.
        forward: [-m[8], -m[9], -m[10]],
        frame: e.time.frame,
        dt: +(e.time.dt * 1000).toFixed(2),
        objects,
        nan,
        geometries: info?.memory.geometries ?? 0,
        textures: info?.memory.textures ?? 0,
        programs: info?.programs?.length ?? 0,
      };
    });

  const a = await snap();

  // Hand control over, then drive the real input layer — not a scripted camera
  // path. Everything downstream (state machines, animation, AI reacting) then
  // runs exactly as it does for a player.
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input?.takeControl?.() ?? Object.assign(e.input ?? {}, { enabled: true, frozen: false });
    e.ctx.peek('player')?.setControlEnabled?.(true);
  });

  const fired = await page.evaluate(
    ({ DRIVE, ACTION, EVENTS, FRAMES }) =>
      new Promise((done) => {
        const e = window.__ENGINE__;
        const counts = {};
        const offs = EVENTS.map((name) => {
          counts[name] = 0;
          return e.events.on(name, () => counts[name]++);
        });
        // inject(), not down.add(): a key added straight to `down` never
        // produces a press EDGE, so anything gated on pressed() never fires.
        const push = (code, on) => e.input?.inject?.(code, on) ?? (on ? e.input?.down.add(code) : e.input?.down.delete(code));
        push(DRIVE, true);
        let i = 0;
        const tick = () => {
          // Press and release repeatedly: one press edge is easy to miss, and a
          // held trigger exercises a different path than a tapped one.
          if (i > 4 && i % 8 === 0) push(ACTION, true);
          if (i > 4 && i % 8 === 4) push(ACTION, false);
          if (++i >= FRAMES) {
            push(ACTION, false);
            push(DRIVE, false);
            for (const off of offs) off();
            return done(counts);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { DRIVE, ACTION, EVENTS, FRAMES }
  );

  const b = await snap();
  const moved = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);

  // Direction, not just distance. See the note at the top of this file.
  const disp = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  const dl = Math.hypot(...disp) || 1e-9;
  const fwdDot = +((disp[0] * b.forward[0] + disp[1] * b.forward[1] + disp[2] * b.forward[2]) / dl).toFixed(3);

  check('frames advance', b.frame > a.frame, `${a.frame} -> ${b.frame}`);
  check('dt sane', b.dt > 0 && b.dt < 200, `${b.dt} ms`);
  check('movement', moved > 0.1, `${moved.toFixed(2)} m holding ${DRIVE}`);
  if (EXPECT === 'forward') {
    check('movement follows the camera', fwdDot > 0.98, `forwardAlignment ${fwdDot} (1.0 = exact)`);
  }
  check('no NaN transforms', b.nan === 0, `${b.nan} bad`);
  for (const name of EVENTS) check(`event ${name}`, (fired[name] ?? 0) > 0, `${fired[name] ?? 0} fired`);

  // Run on, then compare: a count that keeps climbing with nothing new happening
  // is a leak, and it is far cheaper to catch here than in a 20-minute session.
  await H.pump(page, 120);
  const c = await snap();
  check('object count stable', Math.abs(c.objects - b.objects) <= Math.max(8, b.objects * 0.02), `${b.objects} -> ${c.objects}`);
  check('geometry count stable', c.geometries <= b.geometries + 4, `${b.geometries} -> ${c.geometries}`);
  check('texture count stable', c.textures <= b.textures + 2, `${b.textures} -> ${c.textures}`);
  check('no shader compiles late', c.programs <= b.programs, `${b.programs} -> ${c.programs}`);

  report.forwardAlignment = fwdDot; // diagnostic: 1.0 = drive key moves you where you look
  report.state = { start: a, afterInput: b, afterIdle: c, events: fired };
} catch (e) {
  check('fatal', false, e.message);
  report.gpu = await H.gpuName(page);
} finally {
  report.errors = H.errorsOnly(page.__logs).slice(0, 10);
  if (report.errors.length) check('no console errors', false, report.errors[0]);
  else check('no console errors', true);
  await browser.close();
  server?.kill();
}

H.finish(report);
