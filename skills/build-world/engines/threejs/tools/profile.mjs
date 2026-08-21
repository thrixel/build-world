#!/usr/bin/env node
/**
 * profile.mjs — gameplay profiler. Reproduces the conditions a real player hits,
 * which a static-camera benchmark completely misses.
 *
 * THE LESSON THIS TOOL ENCODES: a static-camera benchmark on the reference
 * project reported 94 fps while the game was unplayable. Real gameplay at Retina
 * device pixel ratio (3.34 MP internal, not 2.07) ran 12-17 fps with 728-1236 ms
 * stalls. A MEDIAN FRAME TIME HIDES EXACTLY THE STALLS PLAYERS NOTICE. So this
 * tool reports the DISTRIBUTION (p50/p95/p99/max), lists every hitch, and
 * attributes each one via the per-frame delta in WebGL program count, geometry
 * count and texture count:
 *
 *   progDelta > 0 on a slow frame  -> shader compilation (the classic; see PITFALLS #2/#3)
 *   geoDelta / texDelta > 0        -> lazy resource creation during play
 *   neither                        -> real GPU or CPU cost, go look at draw calls
 *
 * What it drives, all four of which change the answer:
 *   - real device pixel ratio (--dpr=2)
 *   - a MOVING camera: new shadow cascades, new frusta, streaming, culling churn
 *   - input held down: whatever "playing" means for this game (--drive=...)
 *   - whatever the game's own busy-state hook stages (AI, physics, crowds)
 *
 *   node tools/profile.mjs --dpr=2 --frames=900
 *   node tools/profile.mjs --dpr=2 --frames=900 --warmup=0     # COLD first-load
 *   node tools/profile.mjs --runs=3                            # report the spread
 */
import { resolve } from 'node:path';
import * as H from './lib/harness.mjs';

const args = H.parseArgs();
const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1512);
const HH = Number(args.h ?? 982);
const DPR = Number(args.dpr ?? 2);
const FRAMES = Number(args.frames ?? 900);
const RUNS = Number(args.runs ?? 1);
/** Discard the first N frames: control handover and the first shadow-cascade fit
 *  are one-time costs, not steady state. `--warmup=0` keeps them, which is how
 *  you see the COLD first-load experience — a lazily compiled program lands in
 *  exactly those frames, so the default view is blind to the stall pre-warm
 *  exists to remove. Always report both. */
const WARMUP = Number(args.warmup ?? 60);
/** Comma-separated key codes to hold, e.g. --drive=KeyW,Mouse0 */
const DRIVE = String(args.drive ?? 'KeyW').split(',').filter(Boolean);
/** Frames of the DRIVE keys held vs released, so a fire/reload cycle happens. */
const CYCLE = Number(args.cycle ?? 90);
const ROOT = resolve(args.root ?? process.cwd());

const server = await H.ensureServer({ port: PORT, root: ROOT });
const browser = await H.launchBrowser({ vsync: false });

const runs = [];
for (let run = 0; run < RUNS; run++) {
  const page = await H.newPage(browser, { w: W, h: HH, dpr: DPR });
  const t0 = Date.now();
  // NOT capture mode: the frame loop must free-run so real pacing is measured.
  await H.open(page, `http://127.0.0.1:${PORT}/${args.query ? `?${args.query}` : ''}`);
  const bootMs = Date.now() - t0;

  const internal = await page.evaluate(() => {
    const r = window.__ENGINE__.ctx.peek('render');
    const gl = r?.renderer?.getContext?.();
    return {
      pixelRatio: r?.renderer?.getPixelRatio?.() ?? null,
      drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
      // The number that matters. A DPR-2 laptop renders ~60% more pixels than
      // the 1920x1080 your capture harness measured.
      megapixels: gl ? +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(2) : null,
      quality: window.__ENGINE__.config.quality,
      renderScale: window.__ENGINE__.config.q?.renderScale ?? null,
      prewarm: window.__PREWARM__ ?? null,
      bootMarks: window.__ENGINE__.bootMarks ?? null,
    };
  });

  // Hand control to the player and let the game stage its busy state.
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input?.takeControl?.() ?? Object.assign(e.input ?? {}, { enabled: true, frozen: false });
    e.ctx.peek('player')?.setControlEnabled?.(true);
    // Optional game hook: stage the most expensive thing that legitimately
    // happens during play (a firefight, a wave, a crowd, max particles).
    e.ctx.peek('ai')?.debugStage?.('busy');
    for (const id of ['fx', 'ai', 'world', 'physics']) e.ctx.peek(id)?.debugBusy?.(true);
  });

  const samples = await page.evaluate(
    ({ FRAMES, DRIVE, CYCLE }) =>
      new Promise((done) => {
        const e = window.__ENGINE__;
        const r = e.ctx.peek('render');
        const info = r?.renderer?.info;
        const out = [];
        let last = performance.now();
        let i = 0;
        const tick = () => {
          const now = performance.now();
          const dt = now - last;
          last = now;
          // Move the camera: forces new cascades, new frusta, culling churn.
          e.camera.rotation.y += 0.006;
          if (e.input) {
            // Edge-correct injection (see lib/input.js inject()): re-press every
            // CYCLE frames so tapped-action paths run too, not just held ones.
            const phase = i % (CYCLE * 2);
            const push = (code, on) => e.input.inject?.(code, on) ?? (on ? e.input.down.add(code) : e.input.down.delete(code));
            if (phase === 0) for (const code of DRIVE) push(code, true);
            else if (phase === CYCLE) for (const code of DRIVE) push(code, false);
            else if (phase < CYCLE && phase % 6 === 0) for (const code of DRIVE) push(code, true);
          }
          out.push({
            i,
            dt,
            progs: info?.programs?.length ?? 0,
            calls: info?.render.calls ?? 0,
            tris: info?.render.triangles ?? 0,
            geos: info?.memory.geometries ?? 0,
            texs: info?.memory.textures ?? 0,
            heap: performance.memory ? performance.memory.usedJSHeapSize >> 20 : 0,
          });
          if (++i >= FRAMES) return done(out);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { FRAMES, DRIVE, CYCLE }
  );

  const warm = samples.slice(WARMUP);
  const dts = warm.map((s) => s.dt).sort((a, b) => a - b);
  const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(2);
  const med = q(0.5);

  // A hitch is a frame well outside this build's own normal, not a fixed ms
  // threshold — a 30 fps game and a 120 fps game have different normals.
  const hitches = [];
  for (let k = 1; k < warm.length; k++) {
    const s = warm[k];
    if (s.dt <= Math.max(2 * med, med + 8)) continue;
    const prev = warm[k - 1];
    hitches.push({
      frame: s.i,
      ms: +s.dt.toFixed(1),
      progDelta: s.progs - prev.progs,
      geoDelta: s.geos - prev.geos,
      texDelta: s.texs - prev.texs,
      cause: s.progs > prev.progs ? 'shader-compile' : s.geos > prev.geos || s.texs > prev.texs ? 'resource-create' : 'gpu/cpu',
    });
  }

  const first = warm[0];
  const lastS = warm[warm.length - 1];
  runs.push({
    bootMs,
    internal,
    frames: warm.length,
    frameTimeMs: { p1: q(0.01), p50: med, p90: q(0.9), p95: q(0.95), p99: q(0.99), max: q(1) },
    fps: { p50: +(1000 / med).toFixed(0), p95: +(1000 / q(0.95)).toFixed(0), p99: +(1000 / q(0.99)).toFixed(0) },
    hitchCount: hitches.length,
    hitchPctOfFrames: +((hitches.length / warm.length) * 100).toFixed(2),
    worstHitches: hitches.sort((a, b) => b.ms - a.ms).slice(0, 15),
    programs: { start: first.progs, end: lastS.progs, compiledDuringPlay: lastS.progs - first.progs },
    resources: { geosStart: first.geos, geosEnd: lastS.geos, texStart: first.texs, texEnd: lastS.texs },
    heapMb: { start: first.heap, end: lastS.heap, growth: lastS.heap - first.heap },
    drawCalls: { min: Math.min(...warm.map((s) => s.calls)), max: Math.max(...warm.map((s) => s.calls)) },
    triangles: { min: Math.min(...warm.map((s) => s.tris)), max: Math.max(...warm.map((s) => s.tris)) },
    errors: H.errorsOnly(page.__logs).slice(0, 6),
  });
  await page.close();
}

await browser.close();
server?.kill();

// A single run of a profiler like this varies a lot and has already produced one
// confidently wrong conclusion. Report the spread whenever RUNS > 1.
const report =
  RUNS === 1
    ? runs[0]
    : {
        runs,
        spread: {
          fpsP50: runs.map((r) => r.fps.p50),
          fpsP99: runs.map((r) => r.fps.p99),
          maxFrameMs: runs.map((r) => r.frameTimeMs.max),
          programsDuringPlay: runs.map((r) => r.programs.compiledDuringPlay),
          bootMs: runs.map((r) => r.bootMs),
        },
      };
console.log(JSON.stringify(report, null, 2));
