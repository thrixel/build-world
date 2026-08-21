/**
 * Shared harness for every tool in this directory: CLI parsing, dev-server boot,
 * GPU-backed headless Chromium, and the page handshake.
 *
 * Every tool used to re-implement all four of these, which is how the reference
 * project ended up with one capture path that was reproducible and one that was
 * not. Factor it once.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { platform } from 'node:os';
import net from 'node:net';

/** `--flag=value --bool` -> { flag: 'value', bool: true } */
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    })
  );
}

export const portOpen = (port, host = '127.0.0.1') =>
  new Promise((res) => {
    const s = net.connect({ port, host }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

/** Walk up from `from` looking for node_modules/.bin/<bin>. */
function findBin(from, bin) {
  let dir = resolve(from);
  for (let i = 0; i < 8; i++) {
    const p = join(dir, 'node_modules', '.bin', bin);
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * Start the dev server unless something already answers on that port.
 *
 * HMR IS DISABLED (`KIT_NO_HMR=1`, honoured by the vite config template). A file
 * saved by a concurrently-working agent otherwise reloads the page mid-capture
 * and playwright fails with "Execution context was destroyed" — which reads like
 * a harness bug and is not one.
 *
 * The server also binds 127.0.0.1 explicitly: vite's default `localhost` binds
 * ::1 only on some platforms, and the harness connects over IPv4.
 */
export async function ensureServer({ port = 5173, root = process.cwd(), quiet = true } = {}) {
  if (await portOpen(port)) {
    // Attaching to whatever already listens there is usually what you want while
    // iterating — and is a trap when it is a DIFFERENT project's dev server. The
    // symptom is a __READY__ timeout that looks like a game bug. Use a port only
    // this project uses, or pass --port.
    console.error(`[harness] port ${port} already in use — attaching to the existing server`);
    return null;
  }
  const bin = findBin(root, 'vite');
  if (!bin) throw new Error(`vite not found from ${root} — run npm install first`);
  const proc = spawn(bin, ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: quiet ? 'ignore' : 'inherit',
    env: { ...process.env, KIT_NO_HMR: '1' },
  });
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(port)) return proc;
    if (proc.exitCode !== null) break;
  }
  proc.kill();
  throw new Error(`dev server failed to start on ${port} (root=${root})`);
}

/**
 * Headless Chromium flags.
 *
 * DO NOT COPY AN ANGLE BACKEND FLAG FROM ANOTHER PROJECT. `--use-angle=metal` is
 * macOS-only; `--use-angle=d3d11` is Windows-only. Forcing a backend the platform
 * cannot honour does not fall back gracefully — measured in this repo, the
 * combination `--use-angle=gl --use-gl=angle --enable-unsafe-swiftshader` on
 * Linux made every MeshDepthMaterial fail VALIDATE_STATUS, lost the WebGL
 * context during boot, and produced a PURE WHITE 1920x1080 screenshot with
 * `ok: true` in the report. A reviewer then critiques the art of a blank frame.
 *
 * So: only pass an ANGLE backend where it is known-good (darwin), let Chromium
 * choose elsewhere, and let the caller override with `--angle=<backend>`.
 *
 * `--force-color-profile=srgb` and `--force-device-scale-factor=1` are what make
 * two runs comparable at the pixel level; without them the display profile leaks
 * into the PNG.
 */
export function gpuFlags({ vsync = false, angle = null, pinDeviceScale = true } = {}) {
  const os = platform();
  const flags = [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
    '--mute-audio',
  ];
  // Pinning the device scale is what makes two captures comparable pixel for
  // pixel. It also overrides playwright's per-context `deviceScaleFactor`, so a
  // tool that is deliberately emulating a DPR-3 phone must opt out of it.
  if (pinDeviceScale) flags.push('--force-device-scale-factor=1');
  const backend = angle ?? (os === 'darwin' ? 'metal' : os === 'win32' ? 'd3d11' : null);
  if (backend) flags.push(`--use-angle=${backend}`);
  if (!vsync) flags.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  return flags;
}

export async function launchBrowser({ vsync = false, angle = null, pinDeviceScale = true, extraFlags = [] } = {}) {
  return chromium.launch({
    headless: true,
    args: [...gpuFlags({ vsync, angle, pinDeviceScale }), ...extraFlags],
  });
}

/**
 * A page that collects console output and page errors — you always want them.
 *
 * `touch: true` is what makes a phone check possible at all: without it the
 * context dispatches no touch pointers, `matchMedia('(pointer: coarse)')` is
 * false, and a game with a perfectly good touch layer measures as unplayable.
 */
export async function newPage(browser, { w = 1920, h = 1080, dpr = 1, touch = false, mobile = false } = {}) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    hasTouch: touch,
    isMobile: mobile,
  });
  const logs = [];
  page.on('console', (m) => m.type() !== 'debug' && logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  page.__logs = logs;
  return page;
}

export function buildUrl({ port = 5173, capture = true, lockstep = false, shot = null, query = '' } = {}) {
  const p = new URLSearchParams();
  if (capture) p.set('capture', '1');
  if (lockstep) p.set('lockstep', '1');
  if (shot) p.set('shot', shot);
  const extra = query ? `&${String(query).replace(/^[?&]/, '')}` : '';
  return `http://127.0.0.1:${port}/?${p.toString()}${extra}`;
}

/** Navigate and wait for the game's own readiness signal (a FRAME COUNT — see
 *  lib/shots.js signalReady — not a timeout). */
export async function open(page, url, { timeout = 90000 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction('window.__READY__ === true', null, { timeout });
  return page;
}

export const applyShot = (page, name, settle) =>
  page.evaluate(({ s, g }) => window.__APPLY_SHOT__(s, { grabFrame: g }), { s: name, g: settle });

export const listShots = (page) => page.evaluate('Object.keys(window.__SHOTS__ ?? {})');

/** Advance n engine frames (lockstep) or wait out n rAFs (free-running). */
export const pump = (page, n) => page.evaluate((k) => window.__PUMP__(k), n);

/** Yield rAFs without advancing simulation, so the compositor has the frame. */
export const present = (page, n = 2) => page.evaluate((k) => window.__PRESENT__(k), n);

/** Ask the renderer to drop temporal history so accumulation starts from a known
 *  phase. Optional hook; harmless if the game does not implement it. */
export const resetTemporal = (page) =>
  page.evaluate(() => {
    const r = window.__ENGINE__?.ctx?.peek?.('render');
    return !!(r?.resetTemporal?.() ?? r?.resetHistory?.() ?? r?.invalidateHistory?.() ?? false);
  });

export const renderInfo = (page) => page.evaluate('window.__RENDER_INFO__ ?? null');

export const gpuName = (page) =>
  page
    .evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'NO WEBGL2';
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })
    .catch(() => 'n/a');

/** Has the WebGL context died? A lost context keeps `ok:true` everywhere else
 *  while every later frame is blank, so check it on every capture. */
export const contextLost = (page) =>
  page
    .evaluate(() => {
      const gl = window.__ENGINE__?.ctx?.peek?.('render')?.renderer?.getContext?.();
      return gl ? gl.isContextLost() : null;
    })
    .catch(() => null);

/**
 * Screenshot to `path` AND check it is not blank. A uniform frame means a lost
 * context, a camera inside geometry, a failed clear or a shot that points at the
 * sky — all of which otherwise produce a green report and a wasted review round.
 */
export async function screenshotChecked(page, path, { flatStd = 1.5 } = {}) {
  const buf = await page.screenshot({ path, type: 'png' });
  const png = PNG.sync.read(buf);
  let n = 0, sum = 0, sumSq = 0;
  // Every 16th pixel is plenty to detect a uniform frame and costs ~nothing.
  for (let i = 0; i < png.data.length; i += 64) {
    const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    sum += l;
    sumSq += l * l;
    n++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return { path, mean: +mean.toFixed(1), std: +std.toFixed(2), blank: std < flatStd };
}

export const errorsOnly = (logs) => logs.filter((l) => /^\[pageerror\]|^\[error\]/.test(l));

/** Print JSON and exit non-zero on failure — every tool is a gate first and a
 *  report second, so it has to be usable from a script. */
export function finish(report, { ok = report.ok !== false } = {}) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}
