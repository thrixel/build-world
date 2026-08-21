#!/usr/bin/env node
/**
 * imagediff.mjs — THE PIXEL GATE.
 *
 * Per-pixel comparison of two shot directories. This is what turns "this
 * optimisation is visually neutral" from a claim into a measurement, and it is
 * the single highest-leverage tool in the kit: it lets an agent make aggressive
 * changes to a renderer it does not fully understand and still prove it broke
 * nothing.
 *
 *   node tools/imagediff.mjs --a=shots/base --b=/tmp/after
 *   node tools/imagediff.mjs --a=shots/base --b=/tmp/after --write-diff --tol=1
 *
 * Exit code 0 only if every shot is within epsilon. Read `identical` for the
 * strict verdict — for a no-visual-change contract, require identical:true, not
 * withinEpsilon. "Imperceptible" is how a regression gets in.
 *
 * Both inputs must come from tools/baseline.mjs. Comparing shared-page captures
 * measures the harness, not your change.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from './lib/harness.mjs';

const args = parseArgs();
if (!args.a || !args.b) {
  console.error('usage: imagediff.mjs --a=<dirA> --b=<dirB> [--tol=0] [--write-diff]');
  process.exit(2);
}
const A = resolve(args.a);
const B = resolve(args.b);
/** Per-channel 0-255 delta below which a pixel counts as unchanged. */
const TOL = Number(args.tol ?? 0);

const names = readdirSync(A).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png')).sort();
if (!names.length) {
  console.error(`no PNGs in ${A}`);
  process.exit(2);
}

const rows = [];
let worst = null;

for (const n of names) {
  const pb = join(B, n);
  if (!existsSync(pb)) {
    rows.push({ shot: n, status: 'MISSING_IN_B', changedPct: 100, maxDelta: 255 });
    continue;
  }
  const a = PNG.sync.read(readFileSync(join(A, n)));
  const b = PNG.sync.read(readFileSync(pb));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push({
      shot: n, status: 'SIZE_MISMATCH', changedPct: 100, maxDelta: 255,
      a: `${a.width}x${a.height}`, b: `${b.width}x${b.height}`,
    });
    continue;
  }

  let diffPx = 0, sum = 0, maxD = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1; // bbox of the change
  const total = a.width * a.height;
  const diff = args['write-diff'] ? new PNG({ width: a.width, height: a.height }) : null;

  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2])
    );
    sum += d;
    if (d > maxD) maxD = d;
    const changed = d > TOL;
    if (changed) {
      diffPx++;
      const px = (i >> 2) % a.width;
      const py = (i >> 2) / a.width | 0;
      if (px < bx0) bx0 = px;
      if (px > bx1) bx1 = px;
      if (py < by0) by0 = py;
      if (py > by1) by1 = py;
    }
    if (diff) {
      // Hot magenta over a dimmed original, so a human can see WHERE it moved.
      diff.data[i] = changed ? 255 : a.data[i] >> 2;
      diff.data[i + 1] = changed ? 0 : a.data[i + 1] >> 2;
      diff.data[i + 2] = changed ? 255 : a.data[i + 2] >> 2;
      diff.data[i + 3] = 255;
    }
  }
  if (diff) writeFileSync(join(B, n.replace('.png', '.diff.png')), PNG.sync.write(diff));

  const pct = (diffPx / total) * 100;
  const row = {
    shot: n,
    changedPct: +pct.toFixed(4),
    changedPx: diffPx,
    maxDelta: maxD,
    meanDelta: +(sum / total).toFixed(3),
    // The bbox is what tells you WHICH subsystem moved: a change confined to the
    // bottom-left is the HUD, a full-frame change is tonemapping or exposure.
    bbox: diffPx ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null,
  };
  rows.push(row);
  if (!worst || pct > worst.changedPct) worst = row;
}

const identical = rows.every((r) => r.changedPct === 0);
const withinEpsilon = rows.every((r) => (r.changedPct ?? 100) < 0.05 && (r.maxDelta ?? 255) <= Math.max(2, TOL));

console.log(JSON.stringify({ a: A, b: B, tol: TOL, shots: rows.length, identical, withinEpsilon, worst, rows }, null, 2));
process.exit(withinEpsilon ? 0 : 1);
