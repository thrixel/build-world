/**
 * headless.mjs - what playcheck and record share: a browser that is always
 * there, a static server for the bundle, and two frame measurements.
 *
 * Engine-agnostic like both callers. Nothing here knows about the three.js
 * kit; engines/threejs/tools/lib/harness.mjs is that kit's own harness and
 * imports playwright directly because the kit installs it.
 */

import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
};

/**
 * Find a browser, and if there is not one, GET one.
 *
 * The self-install is the whole point. An earlier version of playcheck just
 * exited with "no browser, install one yourself" - and in a real run the agent
 * dutifully ran the check, read that message, published anyway, and told the
 * user the game worked perfectly. A gate with an easy way past it is not a
 * gate; it is a suggestion. So the missing-browser case is fixed rather than
 * reported. It costs one ~130 MB download, once per machine, and it is the
 * difference between a check that runs and a check that gets stepped around.
 */
export async function loadChromium({ allowInstall = true, log = console.error } = {}) {
  // fileURLToPath, not URL.pathname: on Windows the latter is "/C:/Users/..."
  // with percent-encoded spaces, and every candidate below silently misses.
  const here = fileURLToPath(new URL('.', import.meta.url));
  const cacheRoot = join(homedir(), '.cache', 'thrixel-playcheck');
  const candidates = [
    'playwright', 'playwright-core',
    // The three.js kit installs its own; borrow it rather than duplicating.
    resolve(here, '../../engines/threejs/node_modules/playwright/index.mjs'),
    resolve(here, '../../engines/threejs/node_modules/playwright/index.js'),
    join(cacheRoot, 'node_modules', 'playwright', 'index.mjs'),
    join(cacheRoot, 'node_modules', 'playwright', 'index.js'),
  ];
  for (const mod of candidates) {
    try {
      const { chromium } = await import(mod);
      if (chromium) { loadChromium.from = mod; return chromium; }
    } catch { /* keep looking */ }
  }
  if (!allowInstall) return null;

  log('playcheck: no headless browser found. Installing one now (~130 MB, once');
  log(`playcheck: per machine, into ${cacheRoot}). This is not optional -`);
  log('playcheck: a bundle nobody has opened is a bundle nobody has checked.');
  try {
    await mkdir(cacheRoot, { recursive: true });
    const run = (cmd, cmdArgs) => new Promise((ok) => {
      // npm and npx are .cmd shims on Windows, which Node refuses to spawn
      // without a shell (and cannot find without one). Elsewhere no shell,
      // so arguments are never re-parsed.
      const p = spawn(cmd, cmdArgs, { cwd: cacheRoot, stdio: 'inherit', shell: process.platform === 'win32' });
      p.on('close', (code) => ok(code));
      p.on('error', () => ok(-1));
    });
    if (await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error', 'playwright']) !== 0) return null;
    // The npm package does not bring the browser binary with it.
    if (await run('npx', ['--yes', 'playwright', 'install', 'chromium']) !== 0) return null;
    for (const mod of [join(cacheRoot, 'node_modules', 'playwright', 'index.mjs'),
                       join(cacheRoot, 'node_modules', 'playwright', 'index.js')]) {
      try {
        const { chromium } = await import(mod);
        if (chromium) { loadChromium.from = mod; return chromium; }
      } catch { /* fall through */ }
    }
  } catch { /* fall through to the null return */ }
  return null;
}

/** Static file server with no dependencies. Refuses to serve outside the root.
 *  `server.missing` collects every 404, so a caller can say what the bundle
 *  referenced and did not contain. Binds loopback unless told otherwise;
 *  serve.mjs passes 0.0.0.0 so a phone on the same network can reach it. */
export function serve(root, port, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = resolve(join(root, clean === '/' ? '/index.html' : clean));
    if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      // The browser asks for these on its own; a bundle without them is not
      // missing anything, and a 404 here shows up as a console error that
      // record.mjs would refuse the clip over. Full Chromium asks for a
      // favicon on every load; the headless shell never does, which is why
      // playcheck never saw it.
      if (clean === '/favicon.ico' || clean.startsWith('/apple-touch-icon')) {
        res.writeHead(204).end();
        return;
      }
      server.missing.push(clean);
      res.writeHead(404).end('not found');
    }
  });
  server.missing = [];
  return new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, host, () => ok(server));
  });
}

/** Mean and variance of a sampled frame - a blank or flat frame gives ~0 std. */
export function frameStats(buf) {
  let n = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < buf.length; i += 4096) {
    const v = buf[i]; sum += v; sumSq += v * v; n++;
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(2) };
}

/** Percentage of sampled bytes that differ between two encoded frames. Coarse
 *  on purpose: it tells "moved" from "did not", which is all either caller
 *  asks, and it costs nothing. */
export function diffPct(a, b) {
  let n = 0, t = 0;
  for (let i = 0; i < a.length && i < b.length; i += 512) { t++; if (Math.abs(a[i] - b[i]) > 8) n++; }
  return +(100 * n / t).toFixed(2);
}

/** Luminance on a coarse grid (default 32x18) from a PNG screenshot.
 *  Decodes the PNG itself (8-bit RGB/RGBA, no interlace: what Chromium writes),
 *  so two frames compare by what is ON SCREEN rather than by encoded bytes:
 *  any change to a compressed file shifts every byte after it. */
export function gridLuma(png, gw = 32, gh = 18) {
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const depth = png[24], type = png[25];
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (depth !== 8 || !bpp) return null;
  const parts = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), kind = png.toString('ascii', o + 4, o + 8);
    if (kind === 'IDAT') parts.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = w * bpp, row = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const sums = new Float64Array(gw * gh), counts = new Uint32Array(gw * gh);
  for (let y = 0, p = 0; y < h; y++) {
    const f = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[p++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
    const gy = Math.min(gh - 1, Math.floor(y * gh / h));
    for (let x = 0; x < w; x++) {
      const i = x * bpp, g = gy * gw + Math.min(gw - 1, Math.floor(x * gw / w));
      sums[g] += 0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2]; counts[g]++;
    }
    row.copy(prev);
  }
  return Array.from(sums, (s, i) => s / (counts[i] || 1));
}

/** Mean absolute luminance change between two grids, 0-255. */
export function gridDiff(a, b) {
  if (!a || !b) return null;
  let t = 0;
  for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]);
  return +(t / a.length).toFixed(2);
}

/** Percentage of grid cells whose luminance moved by more than `threshold`.
 *  A small sprite moving changes a few cells a lot; water shimmer changes many
 *  cells a little. The mean alone mistakes the first for nothing. */
export function gridChanged(a, b, threshold = 10) {
  if (!a || !b) return null;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > threshold) n++;
  return +(100 * n / a.length).toFixed(2);
}

/** Luminance range across the grid: a frame with anything on it has contrast. */
export function gridRange(g) {
  if (!g) return 0;
  return +(Math.max(...g) - Math.min(...g)).toFixed(1);
}
