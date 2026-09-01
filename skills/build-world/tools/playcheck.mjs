#!/usr/bin/env node
/**
 * playcheck.mjs - does the bundle you are about to publish actually RUN?
 *
 * Run this on the assembled bundle before every publish. It is the last gate
 * before a link reaches another human, and it catches the one failure that
 * every other check misses: a game that builds cleanly, packages cleanly,
 * uploads cleanly, and throws on the first frame.
 *
 * That is not hypothetical. A build shipped to thrixel.world with
 * `window.loadOrbModel = loadOrbModel` left behind after the function it named
 * had been refactored away. Vite does not care - a ReferenceError is a runtime
 * event, not a bundling one - so the build passed, the publish succeeded, and
 * the report said "fully playable, 60 FPS". The page was black. Nobody had
 * opened it.
 *
 * Engine-agnostic on purpose: it drives a real browser and reads the frame, so
 * it works on a kit game, a hand-written one, a Unity WebGL build, or a folder
 * a user handed over. It knows nothing about your game's internals.
 *
 * What it checks, on a desktop viewport and again on a phone:
 *   loads          no pageerror, no console error, no failed asset request
 *   renders        the frame is not blank or a flat wall of one colour
 *   responds       input changes what is on screen - keys on desktop, a real
 *                  touch drag on the phone
 *   fits           no horizontal overflow, canvas fills the screen, and the
 *                  drawing buffer is not asking a phone GPU for desktop pixels
 *
 * It also LEAVES THE COVER BEHIND. The browser is already open, the game is
 * already running and already being driven, so the same session writes
 * cover.png into the bundle - the still that listings show. It is never
 * written over one the author supplied, and not written at all if the checks
 * failed: artwork for a broken game is worse than none. Pass --no-capture to
 * skip it.
 *
 *   node tools/playcheck.mjs ./dist
 *   node tools/playcheck.mjs https://slug.thrixel.world     # after publishing
 *   node tools/playcheck.mjs ./dist --shot=check.png --keep-serving
 *   node tools/playcheck.mjs ./dist --no-capture            # skip the cover
 *
 * Exit codes: 0 pass, 1 the bundle is broken, 2 could not check (no browser).
 * Treat 2 as "unknown", never as "fine".
 */

import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (n, d = null) => {
  const hit = args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

if (!target) {
  console.error('usage: playcheck.mjs <bundle-dir|url> [--shot=out.png] [--port=5599]');
  process.exit(2);
}

/**
 * Find a browser, and if there is not one, GET one.
 *
 * The self-install is the whole point. An earlier version of this script just
 * exited with "no browser, install one yourself" - and in a real run the agent
 * dutifully ran the check, read that message, published anyway, and told the
 * user the game worked perfectly. A gate with an easy way past it is not a
 * gate; it is a suggestion. So the missing-browser case is fixed rather than
 * reported. It costs one ~130 MB download, once per machine, and it is the
 * difference between a check that runs and a check that gets stepped around.
 */
async function loadChromium({ allowInstall = true } = {}) {
  const here = new URL('.', import.meta.url).pathname;
  const cacheRoot = join(homedir(), '.cache', 'thrixel-playcheck');
  const candidates = [
    'playwright', 'playwright-core',
    // The three.js kit installs its own; borrow it rather than duplicating.
    resolve(here, '../engines/threejs/node_modules/playwright/index.mjs'),
    resolve(here, '../engines/threejs/node_modules/playwright/index.js'),
    join(cacheRoot, 'node_modules', 'playwright', 'index.mjs'),
    join(cacheRoot, 'node_modules', 'playwright', 'index.js'),
  ];
  for (const mod of candidates) {
    try {
      const { chromium } = await import(mod);
      if (chromium) return chromium;
    } catch { /* keep looking */ }
  }
  if (!allowInstall) return null;

  console.error('playcheck: no headless browser found. Installing one now (~130 MB, once');
  console.error(`playcheck: per machine, into ${cacheRoot}). This is not optional -`);
  console.error('playcheck: a bundle nobody has opened is a bundle nobody has checked.');
  try {
    await mkdir(cacheRoot, { recursive: true });
    const run = (cmd, cmdArgs) => new Promise((ok) => {
      const p = spawn(cmd, cmdArgs, { cwd: cacheRoot, stdio: 'inherit', shell: false });
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
        if (chromium) return chromium;
      } catch { /* fall through */ }
    }
  } catch { /* fall through to the null return */ }
  return null;
}

/** Static file server with no dependencies. Refuses to serve outside the root. */
function serve(root, port) {
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
      server.missing.push(clean);
      res.writeHead(404).end('not found');
    }
  });
  server.missing = [];
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

const chromium = await loadChromium({ allowInstall: flag('no-install') !== true });
if (!chromium) {
  console.error('');
  console.error('playcheck: COULD NOT CHECK - no browser, and installing one failed.');
  console.error('  The bundle has NOT been verified. It may be completely broken.');
  console.error('  Either fix the install (npm i playwright && npx playwright install chromium)');
  console.error('  or open the bundle yourself with a static server and look at it.');
  console.error('  Do NOT tell anyone the game works. "Published but unverified" is the');
  console.error('  only honest thing to say after this exit code.');
  process.exit(2);
}

const isUrl = /^https?:\/\//.test(target);
const port = Number(flag('port', 5599));
const server = isUrl ? null : await serve(resolve(target), port);
const base = isUrl ? target : `http://127.0.0.1:${port}/`;

const report = { target, checks: [] };
let ok = true;
const ck = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  if (!pass) ok = false;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', '--enable-gpu-rasterization'],
});

/** Mean and variance of a sampled frame - a blank or flat frame gives ~0 std. */
function frameStats(buf) {
  let n = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < buf.length; i += 4096) {
    const v = buf[i]; sum += v; sumSq += v * v; n++;
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(2) };
}
const diffPct = (a, b) => {
  let n = 0, t = 0;
  for (let i = 0; i < a.length && i < b.length; i += 512) { t++; if (Math.abs(a[i] - b[i]) > 8) n++; }
  return +(100 * n / t).toFixed(2);
};

async function run(label, opts) {
  const page = await browser.newPage(opts);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`failed request: ${r.url().split('/').pop()}`));

  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  // Give the game a moment to boot, load assets and draw a few frames.
  await page.waitForTimeout(3500);

  const layout = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const b = c?.getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight,
      viewportMeta: document.querySelector('meta[name=viewport]')?.content ?? null,
      canvas: c ? { w: Math.round(b.width), h: Math.round(b.height), dw: c.width, dh: c.height } : null,
    };
  });

  const a = await page.screenshot({ type: 'png' });
  if (opts.hasTouch) {
    // A real drag on the left of the screen: the movement half of any touch
    // scheme. Dispatched as pointer events so pointer- and touch-based games
    // both see it.
    await page.evaluate(async () => {
      const el = document.querySelector('canvas') || document.body;
      const mk = (t, x, y) => el.dispatchEvent(new PointerEvent(t, {
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      const x = Math.round(innerWidth * 0.2), y = Math.round(innerHeight * 0.75);
      mk('pointerdown', x, y);
      for (let i = 1; i <= 24; i++) { mk('pointermove', x, y - i * 8); await new Promise((r) => requestAnimationFrame(r)); }
      mk('pointerup', x, y - 192);
    });
  } else {
    for (const k of ['KeyW', 'ArrowUp', 'Space']) await page.keyboard.down(k);
    await page.mouse.move(200, 300);
    await page.mouse.move(520, 340, { steps: 12 });
    await page.waitForTimeout(600);
    for (const k of ['KeyW', 'ArrowUp', 'Space']) await page.keyboard.up(k);
  }
  await page.waitForTimeout(900);
  const b2 = await page.screenshot({ type: 'png' });

  const stats = frameStats(a);
  const responded = diffPct(a, b2);
  const shot = flag('shot');
  if (shot && opts.hasTouch) await page.screenshot({ path: String(shot) });

  ck(`${label}: loads without errors`, errors.length === 0, errors[0] ?? 'clean');
  ck(`${label}: draws something`, stats.std > 2.5, `frame std ${stats.std} (a blank or flat page is ~0)`);
  ck(`${label}: responds to input`, responded > 0.4, `${responded}% of the frame changed`);
  if (opts.hasTouch) {
    ck('phone: no horizontal overflow', layout.scrollW <= layout.innerW + 1, `scrollWidth ${layout.scrollW} vs ${layout.innerW}`);
    ck('phone: has a viewport meta tag', !!layout.viewportMeta,
       layout.viewportMeta ?? 'MISSING - a phone renders the page zoomed out');
    if (layout.canvas) {
      const mp = layout.canvas.dw * layout.canvas.dh / 1e6;
      ck('phone: drawing buffer is phone-sized', mp <= 2.6,
         `${mp.toFixed(2)} MP - cap devicePixelRatio if this is high`);
    }
  }
  report[label] = { errors: errors.slice(0, 5), frame: stats, respondedPct: responded, layout };
  await page.close();
}

// ---------------------------------------------------------------------------
// Cover capture
//
// Listings show a still, and it comes from the bundle itself (cover.png at its
// root), which is why it can be produced here: this process already has a
// browser open with the game running in it.
//
// WITHDRAWN: this also recorded a preview.webm, a five-second silent clip the
// listings played on hover. The idea is sound and the plumbing was fine; the
// clips were not. The input loop below drives WASD and Space, so a world that
// answers to clicks or drags recorded five motionless seconds and shipped a
// 2 MB image pretending to be a video - worse than no clip, because the card
// then promises something that is not there. Restoring it needs three things
// first: probe which inputs actually move the picture (playcheck already
// measures exactly that, as respondedPct, and capture never read it), treat
// "no input at all" as a candidate since many scenes animate on their own,
// and refuse to ship a clip whose frames do not change.
//
// Capture happens in its own context rather than piggy-backing on a check run:
// the checks want a clean, undisturbed first paint, and this context is scaled
// to the card's aspect rather than to the viewport each check asserts about.
//
// The input pass is still worth its two seconds for a still image. It is what
// gets the shot past a title screen and into something that looks like the
// game.
// ---------------------------------------------------------------------------

const COVER_W = 960, COVER_H = 540;   // 16:9, the aspect every listing card uses
const COVER_DRIVE_MS = 2000;

async function capture(outDir) {
  const has = async (name) => {
    try { await stat(join(outDir, name)); return true; } catch { return false; }
  };
  // Author-supplied artwork always wins. Someone who picked a cover meant it.
  const wantCover = !(await has('cover.png') || await has('cover.jpg')
    || await has('cover.jpeg') || await has('cover.webp'));
  if (!wantCover) return { skipped: 'bundle already has a cover' };

  const context = await browser.newContext({
    viewport: { width: COVER_W, height: COVER_H },
  });
  const page = await context.newPage();
  const made = {};
  try {
    await page.goto(base, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);   // boot, load assets, draw a few frames

    // Drive briefly before shooting, so the still shows the game rather than
    // whatever its title screen happens to be.
    const until = Date.now() + COVER_DRIVE_MS;
    while (Date.now() < until) {
      await page.keyboard.down('KeyW');
      await page.mouse.move(300 + Math.random() * 360, 260 + Math.random() * 200, { steps: 10 });
      await page.waitForTimeout(220);
      await page.keyboard.up('KeyW');
      await page.keyboard.press('Space');
      await page.waitForTimeout(220);
    }
    await page.screenshot({ path: join(outDir, 'cover.png') });
    made.cover = 'cover.png';
  } finally {
    await page.close();
    await context.close();
  }
  return made;
}

try {
  await run('desktop', { viewport: { width: 1280, height: 720 } });
  await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  if (server?.missing.length) {
    ck('every referenced file is in the bundle', false,
       `missing: ${[...new Set(server.missing)].slice(0, 6).join(', ')}`);
  }
  // Only after the checks, and only if they passed: a cover for a game that
  // throws on load advertises a broken thing. Skipped for a URL target too -
  // there is no bundle directory to write into.
  if (ok && !isUrl && flag('no-capture') !== true) {
    try {
      report.artwork = await capture(resolve(target));
    } catch (e) {
      // Never fail a passing bundle over artwork. The listing falls back to a
      // generated gradient, which is a complete answer.
      report.artwork = { error: e.message };
    }
  }
} catch (e) {
  ck('fatal', false, e.message);
} finally {
  await browser.close();
  server?.close();
}

report.ok = ok;
console.log(JSON.stringify(report, null, 2));
if (!ok) {
  console.error('\nplaycheck FAILED - do not publish this bundle.');
  console.error('Fix what is listed above and run it again. A game that throws on load');
  console.error('looks exactly like a working one from the terminal.');
}
process.exit(ok ? 0 : 1);
