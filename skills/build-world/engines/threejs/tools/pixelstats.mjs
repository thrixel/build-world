#!/usr/bin/env node
/**
 * pixelstats.mjs — read the numbers out of a shot instead of arguing about it.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS: in the reference project every visual
 * critic for three rounds reported the weapon as "untextured". It wasn't. It was
 * specular-dominated: the diffuse term measured L=26 against a shipped L=67.
 * Prior rounds had been *crushing albedos* to fight complaints about bright
 * parts, which killed diffuse and made the reported problem worse. Three rounds
 * of work went the wrong way because nobody measured the frame.
 *
 * A critic tells you WHERE it looks wrong. This tells you WHAT is actually there.
 * Run it on the same shot before and after and the argument is over.
 *
 *   node tools/pixelstats.mjs shots/latest
 *   node tools/pixelstats.mjs shots/latest --shots=hero,detail
 *   node tools/pixelstats.mjs shots/latest --regions=sky:0.4,0.03,0.6,0.13 --regions=floor:0.4,0.8,0.6,0.95
 *   node tools/pixelstats.mjs shots/a --vs=shots/b        # side-by-side table
 *
 * Reading the output:
 *   p1 / p50 / p99   the tonal range actually used. p1 near 0 and p99 near 255 on
 *                    every shot means the image is contrast-clipped, not "punchy".
 *   >250 %           blown highlights. Above ~0.5% of the frame reads as glare.
 *   <12 %            crushed shadows. Above ~10% means detail is gone, not "moody".
 *   sat %            mean saturation. Procedural art tends to land 8-15%; under 5%
 *                    reads as grey/plastic, over 25% as cartoon.
 *   BR               blue-minus-red. Positive = cool, negative = warm. This is how
 *                    you check that shadows are cool and key light is warm rather
 *                    than everything being one temperature.
 *   edge             mean |laplacian|. Near zero over a region means FLAT — no
 *                    texture detail at all, which is the #1 complaint against
 *                    procedural surfaces and is measurable rather than arguable.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { parseArgs } from './lib/harness.mjs';

const args = parseArgs(process.argv.slice(3));
const dir = resolve(process.argv[2] ?? 'shots/latest');
if (!existsSync(dir)) {
  console.error(`no such directory: ${dir}`);
  process.exit(2);
}

const DEFAULT_REGIONS = {
  top: [0.35, 0.02, 0.65, 0.15],
  mid: [0.35, 0.42, 0.65, 0.58],
  bottom: [0.35, 0.80, 0.65, 0.96],
  left: [0.03, 0.35, 0.16, 0.65],
  right: [0.84, 0.35, 0.97, 0.65],
};
const regions = { ...DEFAULT_REGIONS };
for (const spec of [].concat(args.regions ?? [])) {
  if (typeof spec !== 'string') continue;
  const [name, nums] = spec.split(':');
  const v = String(nums).split(',').map(Number);
  if (v.length === 4 && v.every(Number.isFinite)) regions[name] = v;
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function analyse(file) {
  const png = PNG.sync.read(readFileSync(file));
  const { width: W, height: H, data } = png;
  const hist = new Uint32Array(256);
  let n = 0, sr = 0, sg = 0, sb = 0, maxL = 0, satSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = lum(r, g, b);
    hist[Math.min(255, Math.round(L))]++;
    n++; sr += r; sg += g; sb += b;
    if (L > maxL) maxL = L;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx > 0 ? (mx - mn) / mx : 0;
  }
  const pct = (p) => {
    let c = 0;
    const t = n * p;
    for (let i = 0; i < 256; i++) {
      c += hist[i];
      if (c >= t) return i;
    }
    return 255;
  };
  let above250 = 0, below12 = 0;
  for (let i = 250; i < 256; i++) above250 += hist[i];
  for (let i = 0; i < 12; i++) below12 += hist[i];

  const regionStats = {};
  for (const [k, [x0, y0, x1, y1]] of Object.entries(regions)) {
    const px0 = Math.max(1, Math.floor(x0 * W)), px1 = Math.min(W - 1, Math.floor(x1 * W));
    const py0 = Math.max(1, Math.floor(y0 * H)), py1 = Math.min(H - 1, Math.floor(y1 * H));
    let rr = 0, gg = 0, bb = 0, cnt = 0, edge = 0;
    for (let y = py0; y < py1; y++) {
      for (let x = px0; x < px1; x++) {
        const i = (y * W + x) * 4;
        rr += data[i]; gg += data[i + 1]; bb += data[i + 2];
        // 4-neighbour laplacian on luminance: local detail energy.
        const L0 = lum(data[i], data[i + 1], data[i + 2]);
        const at = (dx, dy) => {
          const j = ((y + dy) * W + (x + dx)) * 4;
          return lum(data[j], data[j + 1], data[j + 2]);
        };
        edge += Math.abs(4 * L0 - at(-1, 0) - at(1, 0) - at(0, -1) - at(0, 1));
        cnt++;
      }
    }
    regionStats[k] = {
      rgb: [+(rr / cnt).toFixed(1), +(gg / cnt).toFixed(1), +(bb / cnt).toFixed(1)],
      L: +lum(rr / cnt, gg / cnt, bb / cnt).toFixed(1),
      BR: +((bb - rr) / cnt).toFixed(1),
      edge: +(edge / cnt).toFixed(2),
    };
  }

  return {
    mean: [+(sr / n).toFixed(1), +(sg / n).toFixed(1), +(sb / n).toFixed(1)],
    L: +lum(sr / n, sg / n, sb / n).toFixed(1),
    satPct: +((100 * satSum) / n).toFixed(1),
    p1: pct(0.01), p50: pct(0.5), p99: pct(0.99), p999: pct(0.999), max: Math.round(maxL),
    blownPct: +((100 * above250) / n).toFixed(3),
    crushedPct: +((100 * below12) / n).toFixed(2),
    regions: regionStats,
  };
}

const wanted = args.shots
  ? String(args.shots).split(',').map((s) => `${s.trim()}.png`)
  : readdirSync(dir).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png')).sort();

const out = {};
for (const f of wanted) {
  const p = join(dir, f);
  if (!existsSync(p)) {
    out[f.replace('.png', '')] = { error: 'MISSING' };
    continue;
  }
  out[f.replace('.png', '')] = analyse(p);
}

const vs = args.vs ? resolve(args.vs) : null;
const outB = {};
if (vs) {
  for (const k of Object.keys(out)) {
    const p = join(vs, `${k}.png`);
    outB[k] = existsSync(p) ? analyse(p) : { error: 'MISSING' };
  }
}

if (args.json) {
  console.log(JSON.stringify(vs ? { a: out, b: outB } : out, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    pad('shot', 12) + pad('L', 7) + pad('sat%', 7) + pad('p1', 5) + pad('p50', 5) + pad('p99', 6) +
      pad('blown%', 8) + pad('crush%', 8) + 'regions L/BR/edge'
  );
  for (const [k, s] of Object.entries(out)) {
    if (s.error) {
      console.log(pad(k, 12) + s.error);
      continue;
    }
    const reg = Object.entries(s.regions).map(([n, r]) => `${n}=${r.L}/${r.BR}/${r.edge}`).join(' ');
    console.log(
      pad(k, 12) + pad(s.L, 7) + pad(s.satPct, 7) + pad(s.p1, 5) + pad(s.p50, 5) + pad(s.p99, 6) +
        pad(s.blownPct, 8) + pad(s.crushedPct, 8) + reg
    );
    if (vs && !outB[k]?.error) {
      const t = outB[k];
      const d = (a, b) => (b - a >= 0 ? `+${(b - a).toFixed(1)}` : (b - a).toFixed(1));
      console.log(
        pad('  vs', 12) + pad(t.L, 7) + pad(t.satPct, 7) + pad(t.p1, 5) + pad(t.p50, 5) + pad(t.p99, 6) +
          pad(t.blownPct, 8) + pad(t.crushedPct, 8) + `dL=${d(s.L, t.L)} dSat=${d(s.satPct, t.satPct)}`
      );
    }
  }
}
