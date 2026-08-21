#!/usr/bin/env node
/**
 * baseline.mjs — REPRODUCIBLE capture. This is the reference-image producer, and
 * with imagediff.mjs it is the pixel gate that makes "optimise with zero visual
 * change" a provable claim instead of a promise.
 *
 * Three differences from capture.mjs, all required for bit-comparability. In the
 * reference project, two runs of the shared-page capture differed on 10 of 11
 * shots; with these three, they are bit-identical:
 *
 *  1. ISOLATION — every shot gets a BRAND NEW PAGE. A shared page leaks particle
 *     age, decal ring-buffer contents, animation phase and auto-exposure state
 *     from the previous shot into the next.
 *  2. LOCKSTEP + FIXED FRAME BUDGET — `?lockstep=1` means the engine schedules no
 *     frames of its own; exactly `settle` frames are pumped by hand, so
 *     `time.frame` at the shutter is a constant on every run and every machine,
 *     and nothing advances during the screenshot RPC.
 *  3. TEMPORAL RESET — drop TAA history / snap exposure before pumping so
 *     accumulators converge from the same starting phase.
 *
 *   node tools/baseline.mjs --out=shots/base
 *   node tools/baseline.mjs --out=/tmp/after --shots=hero,detail
 *   node tools/baseline.mjs --out=/tmp/off --query=prewarm=0    # A/B a boot option
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as H from './lib/harness.mjs';

const args = H.parseArgs();
const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const HH = Number(args.h ?? 1080);
const SETTLE = Number(args.settle ?? 90);
const OUTDIR = resolve(args.out ?? 'shots/base');
const ROOT = resolve(args.root ?? process.cwd());

const server = await H.ensureServer({ port: PORT, root: ROOT });
const browser = await H.launchBrowser();

mkdirSync(OUTDIR, { recursive: true });
const report = {
  ok: true, outDir: OUTDIR, size: `${W}x${HH}`, isolated: true, lockstep: true,
  settle: SETTLE, query: args.query ?? null, shots: [], errors: [],
};

// Discover the shot list from a throwaway page, so the list cannot depend on
// whichever shot happened to run first.
const probe = await H.newPage(browser, { w: 64, h: 64 });
await H.open(probe, H.buildUrl({ port: PORT, lockstep: true, query: args.query }));
const all = await H.listShots(probe);
await probe.close();

const wanted = args.shots ? String(args.shots).split(',').map((s) => s.trim()) : all;

for (const name of wanted) {
  const page = await H.newPage(browser, { w: W, h: HH });
  try {
    await H.open(page, H.buildUrl({ port: PORT, lockstep: true, shot: name, query: args.query }));
    const applied = await H.applyShot(page, name, SETTLE);
    if (applied?.error) throw new Error(applied.error);
    await H.resetTemporal(page);
    await H.pump(page, SETTLE); // exactly SETTLE engine frames
    await H.present(page, 2); // compositor has the final frame; nothing simulates
    const px = await H.screenshotChecked(page, `${OUTDIR}/${name}.png`);
    const lost = await H.contextLost(page);
    if (px.blank || lost) report.ok = false;
    report.shots.push({
      shot: name,
      ok: !px.blank && !lost,
      pixels: { mean: px.mean, std: px.std, blank: px.blank },
      contextLost: lost,
      info: await H.renderInfo(page),
      logs: H.errorsOnly(page.__logs),
    });
  } catch (e) {
    report.ok = false;
    report.shots.push({ shot: name, ok: false, error: e.message, logs: H.errorsOnly(page.__logs) });
  } finally {
    await page.close();
  }
}

report.errors = report.shots.flatMap((s) => s.logs ?? []);
await browser.close();
server?.kill();

writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
H.finish(report);
