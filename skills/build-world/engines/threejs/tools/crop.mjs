#!/usr/bin/env node
/**
 * crop.mjs — crop and magnify a region of a shot, and print its mean colour.
 *
 * Reviewing a 1920x1080 frame at 1920x1080 hides everything a close-range player
 * would see: texel density, normal-map detail, aliasing on thin geometry, the
 * "blocky" read of low-poly hands or props. Crop 300x200 and scale 3x and the
 * defect is unmissable — this is how "material richness" complaints get turned
 * into a specific, fixable observation.
 *
 * Fractional coordinates so the same command works at any capture resolution.
 *
 *   node tools/crop.mjs shots/latest/hero.png /tmp/wall.png 0.05 0.4 0.2 0.25 --scale=3
 *   node tools/crop.mjs shots/latest/hero.png /tmp/wall.png 96 432 384 270      # pixels
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parseArgs } from './lib/harness.mjs';

const [, , inp, outp, X, Y, W, H] = process.argv;
const args = parseArgs(process.argv.slice(8));
if (!inp || !outp || X === undefined) {
  console.error('usage: crop.mjs in.png out.png x y w h [--scale=3]');
  process.exit(2);
}
const src = PNG.sync.read(readFileSync(inp));
const S = Number(args.scale ?? 1);
// Values <= 1 are treated as fractions of the image.
const px = (v, dim) => (Number(v) <= 1 ? Math.round(Number(v) * dim) : Math.round(Number(v)));
const x = px(X, src.width), y = px(Y, src.height);
const w = Math.max(1, Math.min(src.width - x, px(W, src.width)));
const h = Math.max(1, Math.min(src.height - y, px(H, src.height)));

const dst = new PNG({ width: Math.round(w * S), height: Math.round(h * S) });
for (let j = 0; j < dst.height; j++) {
  for (let i = 0; i < dst.width; i++) {
    const sx = Math.min(src.width - 1, x + Math.floor(i / S));
    const sy = Math.min(src.height - 1, y + Math.floor(j / S));
    const a = (sy * src.width + sx) * 4;
    const b = (j * dst.width + i) * 4;
    dst.data[b] = src.data[a];
    dst.data[b + 1] = src.data[a + 1];
    dst.data[b + 2] = src.data[a + 2];
    dst.data[b + 3] = 255;
  }
}
writeFileSync(outp, PNG.sync.write(dst));

let r = 0, g = 0, b = 0, n = 0, edge = 0;
const lum = (i) => 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
for (let j = y + 1; j < y + h - 1; j++) {
  for (let i = x + 1; i < x + w - 1; i++) {
    const a = (j * src.width + i) * 4;
    r += src.data[a]; g += src.data[a + 1]; b += src.data[a + 2];
    edge += Math.abs(
      4 * lum(a) - lum(a - 4) - lum(a + 4) - lum(a - src.width * 4) - lum(a + src.width * 4)
    );
    n++;
  }
}
console.log(
  JSON.stringify({
    in: inp, out: outp, rect: [x, y, w, h], scale: S,
    mean: [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)],
    L: +(0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (b / n)).toFixed(1),
    // Detail energy. Under ~1.0 over a surface region means it is genuinely flat.
    edge: +(edge / n).toFixed(2),
  })
);
