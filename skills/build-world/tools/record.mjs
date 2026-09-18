#!/usr/bin/env node
/**
 * record.mjs - a gameplay clip of the bundle, directed by whoever built it.
 *
 * Writes preview.webm into the bundle root: the clip a card plays on hover and
 * the world's page shows in front of the game until the visitor presses Play.
 * It is the most watched thing about a world, and the one thing about it that
 * cannot be scripted blind. An earlier version recorded this inside playcheck
 * with the same WASD loop that gets a still past a title screen, and a world
 * that answered to clicks shipped five motionless seconds as a 2 MB video.
 *
 * So the input comes from a STORYBOARD you write - waits, key presses, drags,
 * clicks, in the order that shows the game at its best - and this file is only
 * the camera. You know which key opens the door and when the boss appears; a
 * script does not.
 *
 *   node tools/record.mjs ./dist --storyboard=preview.json
 *   node tools/record.mjs https://slug.thrixel.world --storyboard=preview.json --out=./preview.webm
 *   node tools/record.mjs ./dist --storyboard=preview.json --size=1080p
 *
 * Storyboard, in viewport pixels of a 1280x720 frame:
 *
 *   { "setup": [ { "note": "off camera: clear the menu, dress the room" },
 *                { "click": [640, 420] }, { "wait": 6000 } ],
 *     "steps": [
 *     { "note": "let the opening view settle" }, { "wait": 3000 },
 *     { "press": "KeyW", "hold": 2500 },        { "move": [700, 270], "ms": 800 },
 *     { "press": "Space" },                      { "click": [480, 270], "hold": 1500 },
 *     { "click": [480, 270], "button": "right" },
 *     { "drag": [480, 300, 640, 300], "ms": 600 },
 *     { "scroll": [0, -600], "ms": 700 },
 *     { "click": [512, 380] },                   { "type": "go" }
 *   ] }
 *
 * SIZE. 1080p by default. The clip is shown at the size of the thing it is
 * standing in for - full-bleed on the world's own page, and the card's art in
 * a listing - and on a 2x laptop that page draws it at around 2400 DEVICE
 * pixels, which a 720p clip reaches only by being upscaled almost twice. The
 * difference shows on edges: foliage, railings, text on a wall. `--size=720p`
 * (or WxH, or the storyboard's width/height) goes back.
 *
 * The viewport is the same number, so the game renders at the resolution it is
 * filmed at - which also means a heavier frame for the GPU, and a slower
 * machine will show it. Check `seconds` against the storyboard's own length.
 *
 * COORDINATES DO NOT SURVIVE A SIZE CHANGE, whatever the scaling below
 * implies. Storyboard positions are scaled by the size ratio on the
 * assumption that the game's UI scales with its viewport, and a HUD anchored
 * to the edges of the window does not: a button 180px from the right edge is
 * 180px from the right edge at every width, and a scaled click lands on empty
 * floor or on the wrong control. Re-running an old storyboard at a new size
 * gives a DIFFERENT CLIP, not the same clip larger. Author at the size you
 * will film at, and look at the frames.
 *
 * SETUP. Everything in `steps` is filmed, so anything the game needs before it
 * is worth looking at used to be filmed too: an empty room filling with
 * furniture, a title card, a lobby. `setup` takes the same steps and runs them
 * BEFORE the clip starts, off camera. Use it to get the game into the state a
 * player reaches after a minute - scene dressed, menu gone, score on the board
 * - and let the clip open there. It is trimmed off with the boot wait, by the
 * same cut, so it costs recording time and nothing else. At most 60 s.
 *
 * Optional top-level keys: width, height (default 1280x720), boot (ms to wait
 * for the game to load before the clip starts; default 3000, and it is cut
 * from the recording so the clip opens on the game, not on a black frame). A
 * game that streams its assets in needs longer than 3000 - raise `boot`, or
 * put the wait in `setup` where you can watch for what you are waiting on.
 *
 * It refuses a clip that does not move. A still is sampled every 1.5 s and
 * the file is deleted when fewer than half the intervals changed, when the
 * page threw, or when the first frame is blank - exit 1, fix the storyboard,
 * record again. The samples are kept in a folder named in the report so you
 * can LOOK at what was recorded before anyone else does; the report names the
 * first frame INSIDE the clip separately, because that one is the still a
 * card shows the instant a stranger hovers it.
 *
 * Two more things it measures and reports rather than refuses, both about the
 * opening, because a card's hover is over before the middle of the clip ever
 * plays: how long it runs before anything moves, and whether its first frame
 * still looks like the page did the instant it loaded - which is a clip that
 * opens on a loading screen even when everything after it moves beautifully.
 *
 * Exit codes: 0 clip written, 1 refused, 2 could not record (no browser, bad
 * storyboard). A world without a clip still publishes; a broken clip must not.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import { diffPct, frameStats, loadChromium, serve } from './lib/headless.mjs';

const MAX_SECONDS = 45;         // a preview, not a playthrough
const MIN_SECONDS = 5;
const SAMPLE_MS = 1500;
const MOVED_PCT = 0.4;          // playcheck's own "responded" threshold
const MIN_MOVING_SHARE = 0.5;   // more than half the clip must be going somewhere
const SETUP_MAX_SECONDS = 60;   // a runway to the good part, not a playthrough
const QUIET_OPENING_MS = 3000;  // longer than this without motion and the hover is wasted

const BASE_ARGS = ['--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', '--enable-gpu-rasterization'];

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (n, d = null) => {
  const hit = args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const fail = (code, ...lines) => {
  for (const l of lines) console.error(`record: ${l}`);
  process.exit(code);
};

/**
 * --doctor: does this machine have what a recording needs? Prints the
 * platform, where Playwright and its ffmpeg were found, whether Chromium
 * launches with the GPU flags, and what renderer WebGL gets. The thing to run
 * on a laptop you are not sitting at before trusting the first clip from it.
 */
if (flag('doctor') === true) {
  const report = { platform: `${platform()} ${process.arch}`, node: process.version };
  const chromium = await loadChromium({ allowInstall: flag('no-install') !== true });
  report.playwright = loadChromium.from ?? null;
  report.ffmpeg = bundledFfmpeg();
  if (!chromium) { report.browser = 'NOT FOUND'; console.log(JSON.stringify(report, null, 2)); process.exit(2); }
  const probe = async (gpu) => {
    const extra = gpu ? gpuLaunch() : { args: [] };
    let browser;
    try {
      try { browser = await chromium.launch({ headless: true, channel: extra.channel, args: [...BASE_ARGS, ...extra.args], timeout: 30000 }); }
      catch (e) { if (!extra.channel) throw e; browser = await chromium.launch({ headless: true, args: [...BASE_ARGS, ...extra.args], timeout: 30000 }); }
      const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
      await page.goto('data:text/html,<canvas></canvas>', { timeout: 20000 });
      const r = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
        const d = gl?.getExtension('WEBGL_debug_renderer_info');
        return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : (gl ? 'unknown' : 'no webgl');
      });
      await browser.close();
      return { ok: true, renderer: r, software: /swiftshader|llvmpipe|software/i.test(r) };
    } catch (e) {
      await browser?.close().catch(() => undefined);
      return { ok: false, error: e.message.split('\n')[0].slice(0, 120) };
    }
  };
  report.gpu = await probe(true);
  report.softwareFallback = await probe(false);
  report.verdict = report.gpu.ok && !report.gpu.software ? 'GPU: clips will be smooth'
    : report.softwareFallback.ok ? 'SOFTWARE ONLY: clips will be choppy on this machine'
      : 'CANNOT RECORD: no browser launches';
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.softwareFallback.ok || report.gpu.ok ? 0 : 2);
}

if (!target || !flag('storyboard')) {
  fail(2, 'usage: record.mjs <bundle-dir|url> --storyboard=<file.json> [--out=preview.webm] [--frames=<dir>] [--port=5598]');
}

// --- the storyboard, checked before a browser is spent on it ----------------

let board;
try {
  board = JSON.parse(await readFile(String(flag('storyboard')), 'utf8'));
} catch (e) {
  fail(2, `could not read the storyboard: ${e.message}`);
}
if (!Array.isArray(board.steps) || board.steps.length === 0) fail(2, 'the storyboard has no "steps"');

/** --size=1080p | 720p | 1440x900. Beats the storyboard, which beats 720p. */
function askedSize() {
  const raw = flag('size');
  if (typeof raw !== 'string') return null;
  const named = { '480p': [854, 480], '540p': [960, 540], '720p': [1280, 720],
                  '1080p': [1920, 1080], '1440p': [2560, 1440] }[raw.toLowerCase()];
  if (named) return named;
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(raw);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
const sized = askedSize();
// Even numbers, which every VP8 encoder wants, and a floor that keeps a typo
// from filming a postage stamp.
const even = (n, min) => Math.max(min, Math.round(n / 2) * 2);
const W = even(sized ? sized[0] : Number(board.width ?? 1920), 320);
const H = even(sized ? sized[1] : Number(board.height ?? 1080), 240);

/** Bits per second for this frame size.
 *
 *  Scaled by pixel count from the 1800k that looked right at 960x540, rather
 *  than fixed: the same bitrate spread over four times the pixels is what
 *  makes a bigger clip look worse than a smaller one.
 *
 *  THE CAP IS THE POINT AT 1080p. Left to the formula a 1080p clip asks for
 *  7200k, which on a 20-second preview is 15 MB - and this file is fetched by
 *  a card on hover and by a world's page on load, before anybody has decided
 *  they want the game. Held at 4500k the same clip is 11 MB, and side by side
 *  at 1080p the two are not tellable apart on interior footage; even 3200k,
 *  the figure 720p uses today, held up. Resolution is what the eye reads here,
 *  not bitrate, so spend on resolution and cap the rest.
 */
const BITRATE_K = Math.min(4500, Math.round(1800 * (W * H) / (960 * 540)));

/** The frame the STORYBOARD's coordinates are written in, and the scale from
 *  it to what we actually film.
 *
 *  Without this, raising the default size silently moved every click: a
 *  storyboard aiming at the middle of a 960x540 frame lands up and to the
 *  left of the middle of a 1280x720 one, and the clip shows the game ignoring
 *  the pointer. Coordinates are therefore RELATIVE to the frame the
 *  storyboard declares, so `--size` changes the sharpness and nothing else.
 */
const FRAME_W = Number(board.width ?? W), FRAME_H = Number(board.height ?? H);
const SX = W / FRAME_W, SY = H / FRAME_H;
const sx = (n) => Math.round(Number(n) * SX);
const sy = (n) => Math.round(Number(n) * SY);
const BOOT_MS = Number(board.boot ?? 3000);

/** How long a phase runs - the clip's length, and what the caps are checked
 *  against, so a 4-minute storyboard is refused before the browser opens
 *  rather than after it. */
const stepMs = (s) => (s.wait ?? 0) + (s.hold ?? 0) + ((s.drag || s.move) ? (s.ms ?? 800) : 0)
  + ((s.press || s.click || s.scroll) && !s.hold ? 80 : 0) + (s.type ? s.type.length * 60 : 0);
const phaseMs = (steps) => steps.reduce((t, s) => t + stepMs(s), 0);

/** The steps that run off camera, to get the game into the state the clip
 *  should open in. Same grammar as `steps`; see the note at the top. */
const setup = board.setup ?? [];
if (!Array.isArray(setup)) fail(2, '"setup" wants a list of steps, the same shape as "steps"');

const check = (steps, what) => {
  for (const [i, s] of steps.entries()) {
    const kinds = ['note', 'wait', 'press', 'down', 'up', 'click', 'move', 'drag', 'scroll', 'type'].filter((k) => k in s);
    if (kinds.length === 0) fail(2, `${what} ${i} does nothing: ${JSON.stringify(s)}`);
    for (const k of ['click', 'move']) if (s[k] && (!Array.isArray(s[k]) || s[k].length !== 2)) fail(2, `${what} ${i}: "${k}" wants [x, y]`);
    if (s.scroll && (!Array.isArray(s.scroll) || s.scroll.length !== 2)) fail(2, `${what} ${i}: "scroll" wants [dx, dy]`);
    if (s.drag && (!Array.isArray(s.drag) || s.drag.length !== 4)) fail(2, `${what} ${i}: "drag" wants [x0, y0, x1, y1]`);
  }
};
check(board.steps, 'step');
check(setup, 'setup step');

const plannedMs = phaseMs(board.steps);
const setupMs = phaseMs(setup);
if (plannedMs > MAX_SECONDS * 1000) {
  fail(2, `the storyboard runs ${(plannedMs / 1000).toFixed(0)} s; a preview is at most ${MAX_SECONDS} s.`,
       'Cut it to three beats: the hook, the core verb, one moment only this game has.',
       'Anything that is only getting the game ready belongs in "setup", which is not filmed.');
}
if (plannedMs < MIN_SECONDS * 1000) {
  fail(2, `the storyboard runs ${(plannedMs / 1000).toFixed(1)} s; a preview needs at least ${MIN_SECONDS} s to show anything.`);
}
if (setupMs > SETUP_MAX_SECONDS * 1000) {
  fail(2, `"setup" runs ${(setupMs / 1000).toFixed(0)} s; it is a runway to the good part, at most ${SETUP_MAX_SECONDS} s.`,
       'If the game needs longer than that to become worth filming, say so to the user rather than filming it anyway.');
}

// --- where things go ----------------------------------------------------------

const isUrl = /^https?:\/\//.test(target);
const bundleDir = isUrl ? null : resolve(target);
if (bundleDir && !existsSync(join(bundleDir, 'index.html'))) fail(2, `${bundleDir} has no index.html at its root`);
const out = resolve(String(flag('out', bundleDir ? join(bundleDir, 'preview.webm') : 'preview.webm')));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const framesDir = resolve(String(flag('frames', join(tmpdir(), 'thrixel-preview', `${basename(bundleDir ?? 'world')}-${stamp}`))));
// Never inside the bundle: everything under it ships.
const samePath = (a, b) => (platform() === 'win32' ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b));
if (bundleDir && samePath(framesDir, bundleDir)) fail(2, '--frames must point outside the bundle directory; everything in it gets published');
const workDir = join(framesDir, 'raw');
await mkdir(workDir, { recursive: true });

const chromium = await loadChromium({ allowInstall: flag('no-install') !== true });
if (!chromium) fail(2, 'no browser, and installing one failed. The world can still publish; say it has no preview yet.');

const port = Number(flag('port', 5598));
const server = isUrl ? null : await serve(bundleDir, port);
const base = isUrl ? target : `http://127.0.0.1:${port}/`;

// --- record ---------------------------------------------------------------------

/**
 * The GPU, if there is one. This is the difference between a clip and a slide
 * show: headless Chromium draws WebGL with SwiftShader (software) unless told
 * otherwise, and a real game under SwiftShader runs at 3-5 fps - measured on a
 * rail shooter that the same machine's GPU drew at 60. The screencast records
 * whatever the page draws, so the choppiness is baked into the file.
 *
 * Per platform, because ANGLE backends are not portable (see the kit's
 * harness.mjs for what forcing the wrong one does). On Linux the working set
 * is the FULL Chromium (`channel: 'chromium'`, not the headless shell) with
 * Vulkan and the GPU sandbox off; every other combination measured here fell
 * back to SwiftShader silently or hung on page load.
 */
function gpuLaunch() {
  const os = platform();
  if (os === 'darwin') return { args: ['--use-angle=metal'] };
  if (os === 'win32') return { args: ['--use-angle=d3d11'] };
  return {
    channel: 'chromium',
    args: ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--enable-gpu', '--disable-gpu-sandbox', '--no-sandbox', '--disable-vulkan-surface'],
  };
}

let browser, context, page;
const errors = [];

/** Launch, open the recording context, load the page. Throws if any of that
 *  fails so the caller can try again without the GPU. */
async function open(gpu) {
  const extra = gpu ? gpuLaunch() : { args: [] };
  try {
    browser = await chromium.launch({ headless: true, channel: extra.channel, args: [...BASE_ARGS, ...extra.args], timeout: 30000 });
  } catch (e) {
    // No full Chromium installed (only the headless shell): same flags on the shell.
    if (!extra.channel) throw e;
    browser = await chromium.launch({ headless: true, args: [...BASE_ARGS, ...extra.args], timeout: 30000 });
  }
  context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: workDir, size: { width: W, height: H } },
  });
  page = await context.newPage();
  errors.length = 0;
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`failed request: ${r.url().split('/').pop()}`));
  // Chromium's console line for a 404 does not say WHICH file; the response does.
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  try {
    await page.goto(base, { waitUntil: 'load', timeout: gpu ? 30000 : 60000 });
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

let usedGpu = flag('software') !== true;
try {
  await open(usedGpu);
} catch (e) {
  if (!usedGpu) fail(2, `could not open the bundle: ${e.message.split('\n')[0]}`);
  console.error(`record: the GPU path did not come up (${e.message.split('\n')[0]}); recording with software rendering instead.`);
  usedGpu = false;
  try { await open(false); } catch (e2) { fail(2, `could not open the bundle: ${e2.message.split('\n')[0]}`); }
}

const t0 = Date.now();
const samples = [];
let sampling = true;
/** A small still every SAMPLE_MS, concurrent with the steps. These are the
 *  gate's evidence and the author's review set, in that order. */
const sampler = (async () => {
  let i = 0;
  while (sampling) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
      const file = join(framesDir, `frame-${String(i++).padStart(2, '0')}.jpg`);
      await writeFile(file, buf);
      samples.push({ file, buf, at: Date.now() - t0 });
    } catch { /* the page is closing */ }
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
})();

/**
 * Move the pointer to (x, y) over `ms` of WALL CLOCK, not over a fixed number
 * of steps. Playwright's own `steps` option is one round trip per step, and a
 * heavy WebGL game on a software renderer answers each one in hundreds of
 * milliseconds - a "900 ms" sweep of 27 steps then takes eight seconds, and a
 * 17-second storyboard came out as an 81-second clip. Pacing by the clock
 * keeps the clip the length the storyboard says, on any machine; a slow one
 * just gets fewer intermediate points along the same path.
 */
let pointer = { x: W / 2, y: H / 2 };
async function glide(x, y, ms) {
  const from = { ...pointer };
  const started = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - started) / ms);
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    if (t >= 1) break;
    await page.waitForTimeout(16);
  }
  pointer = { x, y };
}

/** Play one phase of the storyboard. The same grammar drives `setup` and
 *  `steps`; what separates them is only which side of the clip's start marker
 *  they run on. */
async function run(steps) {
  for (const s of steps) {
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.press) {
      if (s.hold) { await page.keyboard.down(s.press); await page.waitForTimeout(s.hold); await page.keyboard.up(s.press); }
      else await page.keyboard.press(s.press);
    }
    if (s.down) await page.keyboard.down(s.down);
    if (s.up) await page.keyboard.up(s.up);
    if (s.click) {
      // `button` for a right-click ability, `hold` for hold-to-fire: both are
      // common enough in shooters that a storyboard without them cannot show
      // the game's main verb.
      const button = s.button ?? 'left';
      const cx = sx(s.click[0]), cy = sy(s.click[1]);
      if (s.hold) {
        await page.mouse.move(cx, cy);
        pointer = { x: cx, y: cy };
        await page.mouse.down({ button });
        await page.waitForTimeout(s.hold);
        await page.mouse.up({ button });
      } else {
        await page.mouse.click(cx, cy, { button });
        pointer = { x: cx, y: cy };
      }
    }
    if (s.move) await glide(sx(s.move[0]), sy(s.move[1]), s.ms ?? 800);
    if (s.drag) {
      const [x0, y0, x1, y1] = s.drag;
      await page.mouse.move(sx(x0), sy(y0));
      pointer = { x: sx(x0), y: sy(y0) };
      await page.mouse.down();
      await glide(sx(x1), sy(y1), s.ms ?? 800);
      await page.mouse.up();
    }
    if (s.scroll) {
      // Zoom, in most games that have one. Delivered in steps over `ms` rather
      // than as one enormous wheel event, because a camera that snaps from far
      // to near reads as a cut, and because some controllers clamp per event.
      const [dx, dy] = s.scroll;
      const n = Math.max(1, Math.round((s.ms ?? 400) / 60));
      for (let i = 0; i < n; i++) { await page.mouse.wheel(dx / n, dy / n); await page.waitForTimeout(60); }
    }
    if (s.type) await page.keyboard.type(s.type, { delay: 60 });
  }
}

/** What drew the frames. "SwiftShader" means software, and a choppy clip. */
const rendererName = () => page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  const d = gl?.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : (gl ? 'unknown' : 'no webgl');
}).catch(() => 'unknown');

let rawPath = null;
let renderer = 'unknown';
try {
  await page.waitForTimeout(BOOT_MS);
  renderer = await rendererName();
  // The runway, off camera. A game is rarely at its best the instant it
  // finishes loading - the room is bare, the menu is up, nothing has happened
  // yet - and filming from there spends the hover on a scene assembling
  // itself. Everything here is cut with the boot wait, so the clip can open
  // wherever the game is actually worth looking at.
  if (setup.length) await run(setup);
  const clipStart = Date.now() - t0;

  await run(board.steps);
  const clipEnd = Date.now() - t0;
  sampling = false;
  await sampler;
  rawPath = await page.video()?.path();
  await context.close();          // flushes the recording
  board.__span = [clipStart, clipEnd];
} catch (e) {
  sampling = false;
  await sampler.catch(() => undefined);
  errors.push(`fatal: ${e.message}`);
  await context.close().catch(() => undefined);
} finally {
  await browser.close();
  server?.close();
}

// --- the gate ---------------------------------------------------------------------

const software = /swiftshader|llvmpipe|software/i.test(renderer);
const report = { target, out, frames: framesDir, size: `${W}x${H}`, bitrateK: BITRATE_K, renderer, software,
  seconds: null, setupSeconds: +(setupMs / 1000).toFixed(1), sizeKB: null, movingPct: null,
  openingStillMs: null, opensBeforeTheGameDoes: null, firstFrame: null, warnings: [], errors: errors.slice(0, 5) };
const refuse = async (why) => {
  await rm(out, { force: true }).catch(() => undefined);
  report.ok = false;
  report.refused = why;
  console.log(JSON.stringify(report, null, 2));
  console.error(`\nrecord REFUSED the clip: ${why}`);
  console.error(`Look at the frames in ${framesDir}, fix the storyboard, and record again.`);
  process.exit(1);
};

if (errors.length) await refuse(`the page reported errors while the clip ran (${errors[0]})`);
if (!rawPath || !existsSync(rawPath)) await refuse('the browser produced no recording');

const inClip = samples.filter((s) => s.at >= board.__span[0]);
if (inClip.length < 2) await refuse('too short to judge - fewer than two frames were sampled after the clip started');
// The still a card shows the instant somebody hovers it, named on its own
// because it is the one frame with a job separate from the clip's.
report.firstFrame = inClip[0].file;
const first = frameStats(inClip[0].buf);
if (first.std < 2.5) await refuse(`the first frame is blank (std ${first.std}); the game had not drawn anything when the clip began`);
let moved = 0;
for (let i = 1; i < inClip.length; i++) if (diffPct(inClip[i - 1].buf, inClip[i].buf) > MOVED_PCT) moved++;
const movingShare = moved / (inClip.length - 1);
report.movingPct = +(100 * movingShare).toFixed(0);
if (movingShare < MIN_MOVING_SHARE) {
  await refuse(`only ${report.movingPct}% of the clip moves. The world is fine; the storyboard is not - `
    + 'it is probably pressing keys this game does not use, or acting before the game is ready for input.');
}

/**
 * How long the clip runs before anything moves.
 *
 * A clip that passes the gate can still open on a motionless frame, and the
 * opening is not one beat among several: a card plays the clip on hover and
 * stops when the pointer leaves, so the first second or two is the whole
 * audition. Three quiet seconds at the front is a storyboard that started
 * filming before the game was worth filming.
 *
 * Reported, not refused. A game may open on a held shot on purpose, and this
 * measurement cannot tell that from a loading screen - only looking can. It
 * gives the author the number instead of a hunch.
 */
let openingStillMs = 0;
for (let i = 1; i < inClip.length; i++) {
  if (diffPct(inClip[i - 1].buf, inClip[i].buf) > MOVED_PCT) break;
  openingStillMs = inClip[i].at - inClip[0].at;
}
report.openingStillMs = openingStillMs;

/**
 * Does the clip open on the game, or on the page before the game started?
 *
 * The stillness above cannot answer that. A clip that opens on a loading card
 * and cuts to the game two seconds later measures as 100% moving and 0 ms
 * still - the cut IS the motion - and it is exactly the clip nobody wants: the
 * hover spends its whole second on the word "Loading".
 *
 * The first frame sampled is the page the instant it loaded, before the boot
 * wait and before any setup. It is a free, per-game picture of "not started
 * yet". If the clip's own first frame still looks like it, the storyboard
 * began filming too early, whatever happens afterwards.
 *
 * Reported, not refused: a game that draws its whole scene instantly and then
 * waits for a move looks the same at both marks and is perfectly fine.
 */
const preGame = diffPct(samples[0].buf, inClip[0].buf);
report.opensBeforeTheGameDoes = preGame <= MOVED_PCT;
if (report.opensBeforeTheGameDoes) {
  report.warnings.push('the clip\'s first frame is indistinguishable from the page the instant it loaded, '
    + `before the boot wait and any setup (${preGame}% of it differs). It is opening on a loading screen, an `
    + `empty scene or a menu. Look at ${report.firstFrame}, then start the clip later: put the waiting and the `
    + 'getting-ready into "setup", which is not filmed.');
}
if (openingStillMs >= QUIET_OPENING_MS) {
  report.warnings.push(`the clip opens on ${(openingStillMs / 1000).toFixed(1)} s that do not move. `
    + `Look at ${report.firstFrame}: if it could be a loading screen, an empty scene or a menu, the clip `
    + 'starts in the wrong place. Move what gets the game ready into "setup" and open on the action.');
}
if (software) {
  report.warnings.push('a software renderer drew these frames; the game ran at a few frames a second and the clip is choppy for that reason alone.');
}

// --- cut the boot off and put the file where it goes ------------------------------

/**
 * Playwright ships its own ffmpeg for the screencast, and it can re-encode a
 * webm even though it cannot do much else (no image sequences, no filters). Use
 * it to drop the boot wait and the setup phase, so the clip opens where the
 * storyboard says it does. If it cannot be found and there was no setup, the
 * untrimmed clip is kept and the report says so - a clip with three quiet
 * seconds up front beats no clip. With a setup phase it is refused instead:
 * that runway can be a minute long, and a minute of it in front of the clip is
 * not a rough edge, it is a different video.
 *
 * Playwright does not export where it put the binary, so this looks in the
 * places its own installer uses: PLAYWRIGHT_BROWSERS_PATH if set (the value
 * "0" means beside the package), else the per-OS cache. Names per platform
 * and CPU are the ones in Playwright's own registry.
 */
function bundledFfmpeg() {
  const os = platform();
  const arm = process.arch === 'arm64';
  const names = os === 'darwin' ? [arm ? 'ffmpeg-mac-arm64' : 'ffmpeg-mac']
    : os === 'win32' ? ['ffmpeg-win64.exe']
      : [arm ? 'ffmpeg-linux-arm64' : 'ffmpeg-linux'];
  const roots = [];
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (env && env !== '0') roots.push(env);
  if (env === '0' && loadChromium.from) {
    // "beside the package": <playwright-core>/.local-browsers
    roots.push(join(dirname(loadChromium.from), '..', 'playwright-core', '.local-browsers'));
  }
  roots.push(os === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
    : os === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')
      : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright'));
  for (const root of roots) {
    let dirs = [];
    try { dirs = readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse(); } catch { continue; }
    for (const d of dirs) for (const n of names) {
      const p = join(root, d, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

await mkdir(dirname(out), { recursive: true });
const ffmpeg = bundledFfmpeg();
let trimmed = false;
if (ffmpeg) {
  const startS = (board.__span[0] / 1000).toFixed(2);
  const code = await new Promise((ok) => {
    const p = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-ss', startS, '-i', rawPath,
      '-c:v', 'libvpx', '-b:v', `${BITRATE_K}k`, '-deadline', 'good', '-cpu-used', '2', '-an', out], { stdio: 'inherit' });
    p.on('close', ok); p.on('error', () => ok(-1));
  });
  trimmed = code === 0 && existsSync(out);
}
if (!trimmed && setup.length) {
  // Without the cut, "setup" is not off camera at all - it is the first thing
  // a stranger watches, which is the opposite of what it is for.
  await refuse('the boot wait and the setup phase could not be cut off the front (no bundled ffmpeg), '
    + 'and the clip would have opened on the setup. Record without a "setup" phase, or install Playwright\'s ffmpeg.');
}
if (!trimmed) await rename(rawPath, out);
await rm(workDir, { recursive: true, force: true });

report.ok = true;
report.trimmed = trimmed;
report.seconds = +((board.__span[1] - board.__span[0]) / 1000).toFixed(1);
if (report.seconds > plannedMs / 1000 * 1.5) {
  report.slow = `planned ${(plannedMs / 1000).toFixed(0)} s, ran ${report.seconds} s: this machine renders the game slowly, and the clip will look slow too`;
}
report.sizeKB = Math.round((await stat(out)).size / 1024);
report.samples = (await readdir(framesDir)).filter((f) => f.endsWith('.jpg')).length;
console.log(JSON.stringify(report, null, 2));
console.error(`\nrecord: wrote ${out} (${report.seconds}s, ${report.sizeKB} KB, ${report.movingPct}% moving).`);
for (const w of report.warnings) console.error(`record WARNING: ${w}`);
if (software) console.error('record: a machine with a working GPU records the same storyboard smoothly; say so if you publish this one.');
console.error(`record: look at the frames in ${framesDir} before you publish - that is the review, `
  + `and ${report.firstFrame} is the frame a card shows on hover.`);
