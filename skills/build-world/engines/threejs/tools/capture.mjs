#!/usr/bin/env node
/**
 * capture.mjs — the fast review set. Capture one or many named shots in ONE
 * browser session, report render stats and every console error.
 *
 * This is what you look at while iterating, and what a visual critic reviews.
 * It is NOT the pixel gate: one page is reused across shots, so particle age,
 * decal ring buffers, animation phase and exposure state leak forward and two
 * runs will differ. Use baseline.mjs when you need bit-comparable output.
 *
 *   node tools/capture.mjs                                  # every shot
 *   node tools/capture.mjs --shots=hero,detail --out=shots/iter-03
 *   node tools/capture.mjs --list
 *   node tools/capture.mjs --w=2560 --h=1440 --settle=120
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as H from './lib/harness.mjs';

const args = H.parseArgs();
const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const H_ = Number(args.h ?? 1080);
/** Frames rendered after the shot is applied, before the shutter. Enough for
 *  temporal AA to converge, exposure to adapt, LOD to settle. */
const SETTLE = Number(args.settle ?? 90);
const OUTDIR = resolve(args.out ?? 'shots/latest');
const ROOT = resolve(args.root ?? process.cwd());

const server = await H.ensureServer({ port: PORT, root: ROOT });
const browser = await H.launchBrowser();
const page = await H.newPage(browser, { w: W, h: H_ });

const report = { ok: true, outDir: OUTDIR, size: `${W}x${H_}`, settle: SETTLE, shots: [], errors: [] };

try {
  await H.open(page, H.buildUrl({ port: PORT, query: args.query }));
  const all = await H.listShots(page);

  if (args.list) {
    console.log(JSON.stringify(all, null, 2));
  } else {
    const wanted = args.shots ? String(args.shots).split(',').map((s) => s.trim()) : args.shot ? [args.shot] : all;
    mkdirSync(OUTDIR, { recursive: true });
    for (const name of wanted) {
      if (!all.includes(name)) {
        report.ok = false;
        report.shots.push({ shot: name, ok: false, error: `unknown shot (have: ${all.join(', ')})` });
        continue;
      }
      const before = page.__logs.length;
      const applied = await H.applyShot(page, name, SETTLE);
      await H.pump(page, SETTLE);
      const shotStats = await H.screenshotChecked(page, `${OUTDIR}/${name}.png`);
      const lost = await H.contextLost(page);
      if (shotStats.blank || lost) report.ok = false;
      report.shots.push({
        shot: name,
        ok: !applied?.error && !shotStats.blank && !lost,
        file: shotStats.path,
        doc: await page.evaluate((s) => window.__SHOTS__[s]?.doc ?? '', name),
        // A uniform frame is never art. Fail loudly rather than hand a reviewer
        // a blank image with ok:true.
        pixels: { mean: shotStats.mean, std: shotStats.std, blank: shotStats.blank },
        contextLost: lost,
        info: await H.renderInfo(page),
        newLogs: page.__logs.slice(before),
      });
    }
  }
} catch (e) {
  report.ok = false;
  report.fatal = e.message;
  report.gpu = await H.gpuName(page);
} finally {
  report.errors = H.errorsOnly(page.__logs);
  if (report.errors.length) report.ok = false;
  await browser.close();
  server?.kill();
}

if (!args.list) {
  try {
    writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
  } catch {
    /* out dir may not exist if we failed before mkdir */
  }
  H.finish(report);
}
