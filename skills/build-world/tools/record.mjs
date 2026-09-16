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
 *   { "steps": [
 *     { "note": "let the opening view settle" }, { "wait": 3000 },
 *     { "press": "KeyW", "hold": 2500 },        { "move": [700, 270], "ms": 800 },
 *     { "press": "Space" },                      { "click": [480, 270], "hold": 1500 },
 *     { "click": [480, 270], "button": "right" },
 *     { "drag": [480, 300, 640, 300], "ms": 600 },
 *     { "click": [512, 380] },                   { "type": "go" }
 *   ] }
 *
 * SIZE. 720p by default, because the clip is shown at the size of the thing it
 * is standing in for - full-bleed on the world's own page, and the card's art
 * in a listing - and a 540p frame stretched over a laptop viewport is visibly
 * soft next to the game that replaces it. `--size=1080p` (or WxH, or the
 * storyboard's width/height) buys a sharper clip for roughly twice the bytes;
 * the bitrate follows the pixel count rather than being fixed, so quality
 * holds at every size. The viewport is the same number, so the game renders
 * at the resolution it is filmed at.
 *
 * Optional top-level keys: width, height (default 1280x720), boot (ms to wait
 * for the game to load before the clip starts; default 3000, and it is cut
 * from the recording so the clip opens on the game, not on a black frame).
 *
 * It refuses a clip that does not move. A still is sampled every 1.5 s and
 * the file is deleted when fewer than half the intervals changed, when the
 * page threw, or when the first frame is blank - exit 1, fix the storyboard,
 * record again. The samples are kept in a folder named in the report so you
 * can LOOK at what was recorded before anyone else does.
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
const W = even(sized ? sized[0] : Number(board.width ?? 1280), 320);
const H = even(sized ? sized[1] : Number(board.height ?? 720), 240);

/** Bits per second for this frame size.
 *
 *  Scaled by pixel count from the 1800k that looked right at 960x540, rather
 *  than fixed: the same bitrate spread over four times the pixels is what
 *  makes a bigger clip look worse than a smaller one. Capped, because VP8
 *  stops buying much past this and the clip is fetched before anybody has
 *  decided they want the game.
 */
const BITRATE_K = Math.min(8000, Math.round(1800 * (W * H) / (960 * 540)));

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

/** How long the scripted part runs - the clip's length, and what the caps
 *  are checked against, so a 4-minute storyboard is refused before the
 *  browser opens rather than after it. */
const stepMs = (s) => (s.wait ?? 0) + (s.hold ?? 0) + ((s.drag || s.move) ? (s.ms ?? 800) : 0)
  + ((s.press || s.click) && !s.hold ? 80 : 0) + (s.type ? s.type.length * 60 : 0);
const plannedMs = board.steps.reduce((t, s) => t + stepMs(s), 0);
for (const [i, s] of board.steps.entries()) {
  const kinds = ['note', 'wait', 'press', 'down', 'up', 'click', 'move', 'drag', 'type'].filter((k) => k in s);
  if (kinds.length === 0) fail(2, `step ${i} does nothing: ${JSON.stringify(s)}`);
  for (const k of ['click', 'move']) if (s[k] && (!Array.isArray(s[k]) || s[k].length !== 2)) fail(2, `step ${i}: "${k}" wants [x, y]`);
  if (s.drag && (!Array.isArray(s.drag) || s.drag.length !== 4)) fail(2, `step ${i}: "drag" wants [x0, y0, x1, y1]`);
}
if (plannedMs > MAX_SECONDS * 1000) {
  fail(2, `the storyboard runs ${(plannedMs / 1000).toFixed(0)} s; a preview is at most ${MAX_SECONDS} s.`,
       'Cut it to three beats: the opening view, the core verb, one moment only this game has.');
}
if (plannedMs < MIN_SECONDS * 1000) {
  fail(2, `the storyboard runs ${(plannedMs / 1000).toFixed(1)} s; a preview needs at least ${MIN_SECONDS} s to show anything.`);
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
  const clipStart = Date.now() - t0;

  for (const s of board.steps) {
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
    if (s.type) await page.keyboard.type(s.type, { delay: 60 });
  }
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
const report = { target, out, frames: framesDir, size: `${W}x${H}`, bitrateK: BITRATE_K, renderer, software, seconds: null, sizeKB: null, movingPct: null, errors: errors.slice(0, 5) };
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
if (inClip.length < 2) await refuse('too short to judge - fewer than two frames were sampled after boot');
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

// --- cut the boot off and put the file where it goes ------------------------------

/**
 * Playwright ships its own ffmpeg for the screencast, and it can re-encode a
 * webm even though it cannot do much else (no image sequences, no filters). Use
 * it to drop the boot wait, so the clip opens on the game. If it cannot be
 * found the untrimmed clip is kept and the report says so - a clip with three
 * quiet seconds up front beats no clip.
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
if (software) console.error('record: drawn by a SOFTWARE renderer - the game ran at a few frames a second and the clip will look choppy. '
  + 'A machine with a working GPU records the same storyboard smoothly; say so if you publish this one.');
console.error(`record: look at the frames in ${framesDir} before you publish - that is the review.`);
