#!/usr/bin/env node
/**
 * mobilecheck.mjs — can this game be PLAYED on a phone? Run it before
 * publishing, every time.
 *
 * A published game is a link, and a link gets opened on a phone. Everything
 * else in this harness measures the game on a 1920x1080 desktop with a mouse
 * and a keyboard, which is the one device most of its players will not be
 * using. This tool emulates a phone properly — small viewport, DPR 3, touch
 * pointers, no keyboard — and drives the game the only way a phone can.
 *
 * What it checks:
 *   boot            reaches __READY__ at a phone viewport, no console errors
 *   touch input     a SWIPE on the left of the screen moves the player. This is
 *                   the whole point: a game wired to keys only passes every
 *                   other tool in this directory and is dead on a phone.
 *   look            a drag on the right of the screen turns the camera
 *   layout          nothing overflows horizontally, the canvas fills the screen
 *   tap targets     interactive HUD elements are at least 44 CSS px
 *   frame rate      median and p95 at REAL phone resolution, which is where
 *                   an uncapped devicePixelRatio shows up
 *   webgl           the context survived (a phone GPU can refuse what a desktop
 *                   accepts, and a lost context still reports ok everywhere else)
 *
 * It writes a screenshot so you can LOOK at the phone layout, which catches the
 * class of problem no assertion will: a HUD sized for a desktop, text at 11px,
 * a crosshair under the thumb.
 *
 *   node tools/mobilecheck.mjs
 *   node tools/mobilecheck.mjs --port=5273 --out=shots/mobile.png
 *   node tools/mobilecheck.mjs --w=768 --h=1024 --dpr=2      # tablet
 */
import { resolve } from 'node:path';
import * as H from './lib/harness.mjs';

const args = H.parseArgs();
const PORT = Number(args.port ?? 5173);
const ROOT = resolve(args.root ?? process.cwd());
// iPhone 14-ish in CSS pixels. Small enough to be honest: if the HUD survives
// this it survives most phones.
const W = Number(args.w ?? 390);
const H_ = Number(args.h ?? 844);
const DPR = Number(args.dpr ?? 3);
const FRAMES = Number(args.frames ?? 240);
const OUT = String(args.out ?? 'shots/mobile.png');
/** The floor for a thumb. Apple and Google both publish 44 CSS px. */
const TAP_MIN = Number(args.tapMin ?? 44);

const server = await H.ensureServer({ port: PORT, root: ROOT });
// pinDeviceScale: false — otherwise Chromium's --force-device-scale-factor=1
// wins and we would measure a phone-shaped desktop at DPR 1, which is the
// comfortable half of the problem and not the half that drops frames.
const browser = await H.launchBrowser({ pinDeviceScale: false });
const page = await H.newPage(browser, { w: W, h: H_, dpr: DPR, touch: true, mobile: true });

const report = { ok: true, device: { w: W, h: H_, dpr: DPR }, checks: [], warnings: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  if (!pass) report.ok = false;
  return pass;
};
/**
 * An observation that must NOT fail the run.
 *
 * Frame rate is the case this exists for. Headless Chromium on a machine with
 * no usable GPU falls back to software rasterisation, where this kit's own
 * example measures 9 fps at desktop resolution — so an absolute fps threshold
 * would fail every game on those machines and teach whoever runs this to stop
 * reading the output. A gate nobody believes is worse than no gate. Use
 * tools/profile.mjs on a real GPU for the performance verdict; this tool exists
 * to catch what is specifically WRONG on a phone, which is the pixel cap, the
 * layout and the input layer.
 */
const note = (name, detail) => report.warnings.push({ name, detail });

/** Camera position + orientation, the two things touch has to be able to move. */
const snap = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    e.camera.updateMatrixWorld(true);
    const m = e.camera.matrixWorld.elements;
    const p = e.camera.position;
    return {
      pos: [p.x, p.y, p.z],
      forward: [-m[8], -m[9], -m[10]],
      frame: e.time.frame,
      touchActive: !!e.input?.touchActive,
    };
  });

try {
  const t0 = Date.now();
  await H.open(page, `http://127.0.0.1:${PORT}/`);
  report.bootMs = Date.now() - t0;
  check('boot', true, `${report.bootMs} ms at ${W}x${H_} @${DPR}x`);

  // The game must believe it is on a phone, or it will never show touch
  // controls no matter how well the input layer works.
  const env = await page.evaluate(() => ({
    coarse: matchMedia('(hover: none) and (pointer: coarse)').matches,
    dpr: devicePixelRatio,
    innerW: innerWidth,
    scrollW: document.documentElement.scrollWidth,
    canvas: (() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), drawW: c.width, drawH: c.height };
    })(),
  }));
  report.env = env;
  check('emulating a touch device', env.coarse, `pointer coarse, dpr ${env.dpr}`);
  check('no horizontal overflow', env.scrollW <= env.innerW + 1, `scrollWidth ${env.scrollW} vs ${env.innerW}`);
  check('canvas fills the viewport', !!env.canvas && env.canvas.w >= W - 2 && env.canvas.h >= H_ * 0.9,
    env.canvas ? `${env.canvas.w}x${env.canvas.h} css, ${env.canvas.drawW}x${env.canvas.drawH} drawing buffer` : 'no canvas');

  // Drawing-buffer sanity. renderScale is allowed to take this DOWN; what is
  // being caught is a renderer that never capped devicePixelRatio at all.
  if (env.canvas) {
    const mp = (env.canvas.drawW * env.canvas.drawH) / 1e6;
    report.megapixels = +mp.toFixed(2);
    check('drawing buffer is phone-sized', mp <= 2.6, `${mp.toFixed(2)} MP — cap devicePixelRatio (config.q.maxPixelRatio)`);
  }

  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input?.takeControl?.();
    e.ctx.peek('player')?.setControlEnabled?.(true);
  });

  const a = await snap();

  // A REAL SWIPE, not an injected key. page.touchscreen has tap only, so the
  // drag is dispatched as touch events directly — this exercises the listeners
  // a phone would fire, including the pointer capture and the tap/slop logic.
  const swipe = (fromX, fromY, toX, toY, steps = 12) =>
    page.evaluate(
      async ({ fromX, fromY, toX, toY, steps }) => {
        const el = document.querySelector('canvas');
        const id = 1;
        const mk = (type, x, y) =>
          el.dispatchEvent(new PointerEvent(type, {
            pointerId: id, pointerType: 'touch', isPrimary: true,
            clientX: x, clientY: y, bubbles: true, cancelable: true,
          }));
        mk('pointerdown', fromX, fromY);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          mk('pointermove', fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
          await new Promise((r) => requestAnimationFrame(r));
        }
        return true;
      },
      { fromX, fromY, toX, toY, steps }
    );

  const release = (x, y) =>
    page.evaluate(({ x, y }) => {
      const el = document.querySelector('canvas');
      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
    }, { x, y });

  // Left third, thumb pushed upward = forward on a virtual stick.
  await swipe(W * 0.18, H_ * 0.75, W * 0.18, H_ * 0.55);
  await H.present(page, 2);
  const held = await page.evaluate(() => {
    const i = window.__ENGINE__.input;
    return { move: i?.move ? { x: +i.move.x.toFixed(2), y: +i.move.y.toFixed(2) } : null, active: !!i?.touchActive };
  });
  // Hold the thumb there for a while so the player actually travels.
  await H.present(page, 90);
  const b = await snap();
  await release(W * 0.18, H_ * 0.55);

  report.stick = held.move;
  check('touch registered', held.active, `input.touchActive ${held.active}`);
  check('stick deflects', !!held.move && Math.hypot(held.move.x, held.move.y) > 0.2,
    held.move ? `move ${held.move.x}, ${held.move.y}` : 'input.move missing — is this Input from lib/?');

  const moved = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
  report.movedMeters = +moved.toFixed(2);
  check('a thumb can move the player', moved > 0.1, `${moved.toFixed(2)} m from a left-side swipe`);

  // Right side = look. Compare camera forward before and after.
  const c0 = await snap();
  await swipe(W * 0.72, H_ * 0.5, W * 0.72 - 90, H_ * 0.5);
  await release(W * 0.72 - 90, H_ * 0.5);
  await H.present(page, 4);
  const c1 = await snap();
  const dot = c0.forward.reduce((s, v, i) => s + v * c1.forward[i], 0);
  const turnedDeg = +(Math.acos(Math.max(-1, Math.min(1, dot))) * 57.2958).toFixed(1);
  report.turnedDegrees = turnedDeg;
  check('a thumb can look around', turnedDeg > 3, `${turnedDeg} deg from a right-side drag`);

  // Tap targets. Anything the player is meant to press must be thumb-sized;
  // this reads computed style rather than guessing from the tag name, so a
  // custom div-as-button is caught too.
  const small = await page.evaluate((min) => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="button"], a[href], [data-action]')) {
      if (getComputedStyle(el).pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden, not tiny
      if (r.width < min || r.height < min) {
        out.push({ el: el.tagName.toLowerCase() + (el.dataset.action ? `[${el.dataset.action}]` : ''),
                   w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return out;
  }, TAP_MIN);
  report.smallTapTargets = small;
  check('tap targets >= 44px', small.length === 0,
    small.length ? small.map((s) => `${s.el} ${s.w}x${s.h}`).join(', ') : 'all good');

  // Frame rate at real phone resolution. Sampled from the engine clock, so it
  // is the same number the game itself sees.
  const fps = await page.evaluate(
    (n) =>
      new Promise((done) => {
        const e = window.__ENGINE__;
        const dts = [];
        let i = 0;
        const tick = () => {
          dts.push(e.time.dt);
          if (++i >= n) {
            dts.sort((x, y) => x - y);
            const at = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
            return done({ p50: at(0.5), p95: at(0.95), max: dts[dts.length - 1] });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES
  );
  const toFps = (dt) => +(1 / Math.max(1e-4, dt)).toFixed(1);
  report.fps = { p50: toFps(fps.p50), p95: toFps(fps.p95), worstFrameMs: +(fps.max * 1000).toFixed(1) };
  report.gpu = await H.gpuName(page);
  // Reported, never gated — see `note` at the top of this file. Read it against
  // the same game's desktop profile.mjs number: what you are looking for is the
  // phone viewport being much WORSE than desktop despite drawing fewer pixels,
  // which means resolution was never the problem and something else is.
  note('frame rate', `p50 ${report.fps.p50} fps, p95 ${report.fps.p95} fps at ${report.megapixels ?? '?'} MP on "${report.gpu}" — compare with tools/profile.mjs, and judge phone performance on a real phone`);

  const lost = await H.contextLost(page);
  check('webgl context alive', lost !== true, lost === null ? 'not reported' : 'ok');

  report.shot = await H.screenshotChecked(page, OUT);
  check('screenshot not blank', !report.shot.blank, `${OUT} (std ${report.shot.std})`);
} catch (e) {
  check('fatal', false, e.message);
  report.gpu = await H.gpuName(page).catch(() => 'n/a');
} finally {
  report.errors = H.errorsOnly(page.__logs).slice(0, 10);
  check('no console errors', report.errors.length === 0, report.errors[0] ?? 'clean');
  await browser.close();
  server?.kill();
}

H.finish(report);
