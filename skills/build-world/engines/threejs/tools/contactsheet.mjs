#!/usr/bin/env node
/**
 * contactsheet.mjs — tile a shot directory into one labelled grid PNG.
 *
 * Why: a reviewer (human or model) given 11 separate images compares them to
 * each other. Given ONE sheet, they judge the set as a body of work and notice
 * what is inconsistent across it — which is where the real defects live
 * (one shot's exposure off, one material reading flat next to the others).
 * It is also one attachment instead of eleven.
 *
 *   node tools/contactsheet.mjs shots/latest --out=shots/latest/sheet.png --cols=4 --cell=640
 *   node tools/contactsheet.mjs shots/a --vs=shots/b --out=/tmp/ab.png    # A/B rows
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { parseArgs } from './lib/harness.mjs';

const args = parseArgs(process.argv.slice(3));
const dir = resolve(process.argv[2] ?? 'shots/latest');
const vs = args.vs ? resolve(args.vs) : null;
const CELL = Number(args.cell ?? 640);
const COLS = Number(args.cols ?? (vs ? 2 : 4));
const OUT = resolve(args.out ?? join(dir, 'sheet.png'));
const GAP = 8;
const LABEL = 14; // rows of pixels reserved for the label bar

const names = (args.shots ? String(args.shots).split(',') : readdirSync(dir)
  .filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png') && !f.endsWith('sheet.png'))
  .map((f) => f.replace('.png', ''))
).map((s) => s.trim());

/** Box-filter downscale — a nearest-neighbour sheet makes everything look
 *  aliased and reviewers then report aliasing that is not in the game. */
function fit(png, w, h) {
  const out = new PNG({ width: w, height: h });
  const sx = png.width / w;
  const sy = png.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(png.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(png.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * png.width + xx) * 4;
          r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n;
      out.data[o + 1] = g / n;
      out.data[o + 2] = b / n;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

// 5x7 bitmap font, uppercase + digits + a few marks. Enough to label a sheet
// without pulling in a font dependency.
const GLYPHS = {
  A: '01100100101111010011001100110', B: '11110100011110010001100111110', C: '01110100011000010000100001110',
  D: '11110100101000110010100101111', E: '11111100001111010000100001111', F: '11111100001111010000100001000',
  G: '01110100011000010110100100111', H: '10001100011111110001100110001', I: '11111001000010000100001011111',
  J: '00111000100001000010100100110', K: '10001100101100010100100101001', L: '10000100001000010000100001111',
  M: '10001110111010110001100110001', N: '10001110011010110011100110001', O: '01110100011000110001100101110',
  P: '11110100101111010000100001000', Q: '01110100011000110101100100110', R: '11110100101111010100100101001',
  S: '01111100000111000001000011110', T: '11111001000010000100001000010', U: '10001100011000110001100101110',
  V: '10001100011000101010010100100', W: '10001100011000110101101010001', X: '10001010100100001010100110001',
  Y: '10001010100010000100001000010', Z: '11111000100010001000100011111',
  0: '01110100111010110011100101110', 1: '00100011000010000100001001110', 2: '01110100010001001000100011111',
  3: '11110000010111000001100101110', 4: '00010001100101010010111100010', 5: '11111100001111000001100111110',
  6: '00110010001000011110100101110', 7: '11111000010001000100010000100', 8: '01110100101110110001100101110',
  9: '01110100101111100001000100110',
  '-': '00000000001111100000000000000', '.': '00000000000000000000001100110',
  '/': '00001000100010001000100010000', ':': '00000011000110000011000110000',
  ' ': '00000000000000000000000000000',
};

function drawLabel(sheet, text, ox, oy, maxW) {
  const up = text.toUpperCase();
  let x = ox + 2;
  for (const ch of up) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    if (x + 6 > ox + maxW) break;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r * 5 + c] !== '1') continue;
        const px = x + c;
        const py = oy + 3 + r;
        if (px < 0 || py < 0 || px >= sheet.width || py >= sheet.height) continue;
        const i = (py * sheet.width + px) * 4;
        sheet.data[i] = 235;
        sheet.data[i + 1] = 235;
        sheet.data[i + 2] = 235;
        sheet.data[i + 3] = 255;
      }
    }
    x += 6;
  }
}

const tiles = [];
for (const n of names) {
  const pa = join(dir, `${n}.png`);
  if (!existsSync(pa)) continue;
  tiles.push({ label: n, file: pa });
  if (vs) {
    const pb = join(vs, `${n}.png`);
    if (existsSync(pb)) tiles.push({ label: `${n} / B`, file: pb });
  }
}
if (!tiles.length) {
  console.error(`no PNGs to tile in ${dir}`);
  process.exit(2);
}

// Derive cell height from the first image's aspect so nothing is distorted.
const probe = PNG.sync.read(readFileSync(tiles[0].file));
const cw = CELL;
const chh = Math.round((CELL * probe.height) / probe.width);
const rows = Math.ceil(tiles.length / COLS);
const sheet = new PNG({
  width: COLS * cw + (COLS + 1) * GAP,
  height: rows * (chh + LABEL) + (rows + 1) * GAP,
});
sheet.data.fill(20);
for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;

tiles.forEach((t, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const ox = GAP + col * (cw + GAP);
  const oy = GAP + row * (chh + LABEL + GAP);
  const img = fit(PNG.sync.read(readFileSync(t.file)), cw, chh);
  drawLabel(sheet, t.label, ox, oy, cw);
  for (let y = 0; y < chh; y++) {
    const dst = ((oy + LABEL + y) * sheet.width + ox) * 4;
    const src = y * cw * 4;
    sheet.data.set(img.data.subarray(src, src + cw * 4), dst);
  }
});

writeFileSync(OUT, PNG.sync.write(sheet));
console.log(JSON.stringify({ out: OUT, tiles: tiles.length, cols: COLS, cell: `${cw}x${chh}`, size: `${sheet.width}x${sheet.height}` }, null, 2));
