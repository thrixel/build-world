#!/usr/bin/env node
/**
 * playtest.mjs - play the bundle like a first-time player, and SHOW what happened.
 *
 * playcheck.mjs answers "does it run?" with pass/fail. This answers "what does a
 * player see?": it opens the game, presses start, then drives it through a short
 * session (move, turn, act, and a touch drag on a phone), taking a screenshot
 * after every step. Look at the screenshots. A game can boot without one error
 * and still be wrong in ways only a picture shows: the hero model missing, a
 * part that should move standing still, the camera inside a wall, text over the
 * play area, a level that never appears.
 *
 * Engine-agnostic: it drives a real browser and reads frames.
 *
 *   node tools/playtest.mjs ./dist --out=./playtest
 *   node tools/playtest.mjs ./dist --out=./playtest --inputs='[{"name":"jump","keys":["Space"],"ms":400}]'
 *
 * Writes <out>/NN-<phase>.jpg and prints a JSON report:
 *   ok         no errors, the frame is not blank, and input changed it
 *   fps        frames a second the test machine drew (no GPU on a server)
 *   notJudged  checks the machine was too slow to decide; never counted as failed
 *   errors     page errors, console errors, failed or 4xx requests
 *   warnings   console warnings (a missing part is logged as one)
 *   phases     per step: screenshot, % of the frame that changed since the last
 *
 * Exit codes: 0 ok, 1 problems found, 2 could not test (no browser).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { gridChanged, gridDiff, gridLuma, gridRange, loadChromium, serve } from './lib/headless.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (n, d = null) => {
  const hit = args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
if (!target) {
  console.error('usage: playtest.mjs <bundle-dir|url> [--out=dir] [--inputs=json] [--port=5598]');
  process.exit(2);
}

// What most games bind, in the order a new player tries them. A game that uses
// none of these still gets a click and a drag. --inputs adds the game's own.
// Every step costs a rendered frame, and software WebGL renders slowly, so
// the list is short: one step per kind of input.
const DEFAULT_PHASES = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'], ms: 1500 },
  { name: 'turn', keys: ['KeyA', 'ArrowLeft'], ms: 900, then: ['KeyD', 'ArrowRight'] },
  { name: 'action', keys: ['Space'], ms: 300, repeat: 3 },
  { name: 'mouse', mouse: true, ms: 800 },
];

let extra = [];
try { extra = JSON.parse(flag('inputs', '[]')); } catch { console.error('playtest: --inputs is not JSON; ignored'); }
const phases = [...DEFAULT_PHASES, ...(Array.isArray(extra) ? extra : [])].slice(0, 16);

const chromium = await loadChromium({ allowInstall: flag('no-install') !== true });
if (!chromium) {
  console.log(JSON.stringify({ ok: false, unknown: true, error: 'no headless browser' }));
  process.exit(2);
}

const out = resolve(String(flag('out', 'playtest')));
await mkdir(out, { recursive: true });
const isUrl = /^https?:\/\//.test(target);
const port = Number(flag('port', 5598));
const server = isUrl ? null : await serve(resolve(target), port);
const base = isUrl ? target : `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio',
         '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         // Containers (Fargate) cannot size /dev/shm; without this Chromium crashes there.
         '--disable-dev-shm-usage'],
});

const report = { target, ok: true, errors: [], warnings: [], phases: [], phone: null };
const note = (list, text) => { if (list.length < 40 && !list.includes(text)) list.push(text); };
let n = 0;
const shotName = (label) => `${String(++n).padStart(2, '0')}-${label}.jpg`;

function watch(page) {
  page.on('console', (m) => {
    if (m.type() === 'error') note(report.errors, `console: ${m.text().slice(0, 300)}`);
    else if (m.type() === 'warning') note(report.warnings, m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => note(report.errors, `${e.name}: ${e.message}`.slice(0, 300)));
  page.on('requestfailed', (r) => note(report.errors, `failed request: ${new URL(r.url()).pathname}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon|apple-touch-icon/.test(r.url())) {
      note(report.errors, `${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
}

// A screenshot waits for the next frame. In a software renderer (no GPU) the
// first one also compiles every shader, so it gets longer; a frame that never
// comes ends the test with a report instead of a crash.
const FIRST_FRAME_MS = 120_000;
const FRAME_MS = 60_000;

async function shoot(page, label, prev, timeout = FRAME_MS) {
  const png = await page.screenshot({ type: 'png', timeout });
  const file = shotName(label);
  await writeFile(join(out, file), await page.screenshot({ type: 'jpeg', quality: 72, timeout }));
  const grid = gridLuma(png);
  return { file, png, grid, changed: prev ? gridDiff(prev.grid, grid) : null,
           cells: prev ? gridChanged(prev.grid, grid) : null, range: gridRange(grid) };
}

// ---- the test machine, not the game ----------------------------------------
// This often runs on a small server with no GPU, where a scene that is smooth on
// a player's machine draws a few frames a second. That must never count against
// the game. So: antialiasing off (the costliest part of software WebGL, and no
// change to the game's code), input held for a number of FRAMES rather than
// milliseconds (a game that caps its frame step barely moves in 1.5 s at 1 fps),
// and checks that need frames reported as not judged when frames are too scarce.
const CHEAP_GL = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/i.test(String(type))) attrs = { ...(attrs || {}), antialias: false };
    return orig.call(this, type, attrs);
  };
  window.__ptFrames = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__ptFrames++; cb(t); });
};
const HOLD_FRAMES = 12;     // input held at least this many frames
const HOLD_CAP_MS = 45_000; // ... or this long, whichever comes first
const SLOW_FPS = 4;         // below this, motion checks are not judged

const frames = (pg) => pg.evaluate(() => window.__ptFrames || 0).catch(() => 0);

// Wait `ms`, then keep waiting until `count` frames have been drawn since `from`.
// A game that never calls requestAnimationFrame (setInterval, plain DOM) has no
// frames to count, so it gets the time alone.
async function waitFrames(pg, from, count, ms) {
  await pg.waitForTimeout(ms);
  if (report.fps === 0) return;
  const until = Date.now() + HOLD_CAP_MS;
  while ((await frames(pg)) - from < count && Date.now() < until) await pg.waitForTimeout(250);
}

// A title screen is the first thing many games show: press what a player would.
async function pressStart(page) {
  const clicked = await page.evaluate(() => {
    const words = /^(play|start|begin|go|continue|tap to start|click to start|new game|ok)\b/i;
    const el = [...document.querySelectorAll('button, [role=button], a, .btn, .button')]
      .find((e) => e.offsetParent !== null && words.test((e.innerText || '').trim()));
    if (el) { el.click(); return (el.innerText || '').trim().slice(0, 40); }
    return null;
  });
  const vp = page.viewportSize();
  await page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height / 2));
  await page.keyboard.press('Enter');
  return clicked;
}

// ---- desktop session -------------------------------------------------------
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 0.5 });
await page.addInitScript(CHEAP_GL);
watch(page);
let slowFrame = null;
const inputChanges = [];
let idleDrift = 0, idleCells = 0;
try {
await page.goto(base, { waitUntil: 'load', timeout: 60000 });
const f0 = await frames(page), t0 = Date.now();
await page.waitForTimeout(4000);
let last = await shoot(page, 'boot', null, FIRST_FRAME_MS);
report.fps = Math.round(((await frames(page)) - f0) / ((Date.now() - t0) / 1000) * 10) / 10;
report.phases.push({ name: 'boot', file: last.file, range: last.range });
report.startButton = await pressStart(page);
await page.waitForTimeout(1500);
let s = await shoot(page, 'after-start', last);
report.phases.push({ name: 'after-start', file: s.file, changed: s.changed, cells: s.cells, range: s.range });
last = s;

for (const ph of phases) {
  if (ph.mouse) {
    const vp = page.viewportSize();
    await page.mouse.move(vp.width * 0.4, vp.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.65, vp.height * 0.45, { steps: 16 });
    await page.mouse.up();
  } else {
    for (const keys of [ph.keys || [], ...(ph.then ? [ph.then] : [])]) {
      for (let r = 0; r < (ph.repeat || 1); r++) {
        const from = await frames(page);
        for (const k of keys) await page.keyboard.down(k);
        await waitFrames(page, from, ph.repeat ? Math.ceil(HOLD_FRAMES / ph.repeat) : HOLD_FRAMES, ph.ms || 600);
        for (const k of keys) await page.keyboard.up(k);
      }
    }
  }
  await page.waitForTimeout(500);
  s = await shoot(page, ph.name, last);
  report.phases.push({ name: ph.name, file: s.file, changed: s.changed, cells: s.cells, range: s.range });
  inputChanges.push(s);
  last = s;
}
// Idle a few seconds: animation, enemies, timers. A frame that changes with no
// input is a game that is running.
// The same pause with no input twice over: how much the frame drifts on its own
// (water, particles, idle animation). Input has to move it clearly more.
await waitFrames(page, await frames(page), HOLD_FRAMES / 2, 1000);
s = await shoot(page, 'idle', last);
const idle1 = s.changed;
await waitFrames(page, await frames(page), HOLD_FRAMES / 2, 1000);
const s2 = await shoot(page, 'idle-2', s);
report.phases.push({ name: 'idle', file: s.file, changed: idle1, cells: s.cells, range: s.range });
idleDrift = Math.max(idle1 ?? 0, s2.changed ?? 0);
idleCells = Math.max(s.cells ?? 0, s2.cells ?? 0);
} catch (e) {
  if (e?.name !== 'TimeoutError') throw e;
  const step = report.phases.length ? `after "${report.phases.at(-1).name}"` : 'for the first frame';
  slowFrame = `The test machine (a small server with no GPU) waited over `
    + `${(report.phases.length ? FRAME_MS : FIRST_FRAME_MS) / 1000} s ${step} and no frame came, so the `
    + 'steps after it were not played. This is the test machine, not a verdict on the game: a '
    + 'player\'s GPU draws the same scene many times faster. Judge from the screenshots that were '
    + 'taken and the errors above; do not cut the game\'s visuals to make this test pass.';
  note(report.warnings, slowFrame);
}
const best = Math.max(0, ...inputChanges.map((p) => p.changed ?? 0));
const bestCells = Math.max(0, ...inputChanges.map((p) => p.cells ?? 0));
report.motion = { idleDrift, strongestInputChange: best, idleCells, strongestInputCells: bestCells };
// Either the whole picture shifts clearly more than it drifts on its own (a
// camera that follows the player), or some part of it changes sharply where
// idling does not (a sprite or a cursor moving across a still background).
// A still picture that input changes at all counts too: a small sprite moving
// over a static background touches only a cell or two.
const responded = best > Math.max(1.5, idleDrift * 1.5)
  || (bestCells >= 0.3 && bestCells > idleCells * 1.5 + 0.2)
  || (idleDrift === 0 && idleCells === 0 && bestCells > 0);

// ---- phone session ---------------------------------------------------------
// Best effort: a phone pass that cannot run is reported, never fatal, and it
// gets a fixed budget so a slow renderer cannot hold the whole test hostage.
const PHONE_BUDGET_MS = 150_000;
if (slowFrame) report.phone = { error: 'skipped: the desktop pass could not draw a frame in time' };
else try {
  await Promise.race([phonePass(), new Promise((_, no) => setTimeout(
    () => no(new Error(`the phone pass took over ${PHONE_BUDGET_MS / 1000}s`)), PHONE_BUDGET_MS))]);
} catch (e) {
  report.phone = { error: String(e.message || e).split('\n')[0].slice(0, 200) };
}

async function phonePass() {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
                                         deviceScaleFactor: 1 });
  await phone.addInitScript(CHEAP_GL);
  watch(phone);
  phone.on('crash', () => note(report.errors, 'the page crashed on the phone viewport'));
  phone.setDefaultTimeout(60000);
  await phone.goto(base, { waitUntil: 'load', timeout: 60000 });
  await phone.waitForTimeout(4000);
  await pressStart(phone).catch(() => null);
  await phone.waitForTimeout(1200);
  const p0 = await shoot(phone, 'phone', null);
  await phone.evaluate(async () => {
    const el = document.querySelector('canvas') || document.body;
    const mk = (t, x, y) => el.dispatchEvent(new PointerEvent(t, {
      pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
    const x = Math.round(innerWidth * 0.25), y = Math.round(innerHeight * 0.75);
    mk('pointerdown', x, y);
    for (let i = 1; i <= 30; i++) { mk('pointermove', x, y - i * 6); await new Promise((r) => setTimeout(r, 16)); }
    mk('pointerup', x, y - 180);
  });
  await phone.waitForTimeout(800);
  const p1 = await shoot(phone, 'phone-drag', p0);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  report.phone = { files: [p0.file, p1.file], dragChanged: p1.changed, horizontalOverflow: overflow };
}

await browser.close();
server?.close();

// Contrast, not variance of encoded bytes: a small bright sprite on a dark
// background is a drawn frame.
const blank = (report.phases[1]?.range ?? 0) < 12;
// What the test machine could not show is not judged, never failed: no frame at
// all says nothing about drawing, and too few frames say nothing about input.
const tooSlow = !!slowFrame || (report.fps > 0 && report.fps < SLOW_FPS);
report.notJudged = [];
const judge = (name, value, judgeable) => {
  if (judgeable || value) report.checks[name] = value;
  else report.notJudged.push(name);
};
report.checks = { 'loads without errors': report.errors.length === 0 };
judge('draws something', !blank, !slowFrame || report.phases.length > 1);
judge('responds to input', responded, !tooSlow);
judge('fits a phone screen', !report.phone?.horizontalOverflow, !report.phone?.error);
if (report.notJudged.length && !slowFrame) {
  note(report.warnings, `The test machine (a small server with no GPU) drew about ${report.fps} frames `
    + `a second, too few to judge: ${report.notJudged.join(', ')}. This is the test machine, not the `
    + 'game; judge those from the screenshots, and do not cut the game\'s visuals to make this pass.');
}
report.ok = Object.values(report.checks).every(Boolean);
report.missing = server?.missing ?? [];
report.out = out;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
