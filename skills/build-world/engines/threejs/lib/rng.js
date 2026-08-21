/**
 * Deterministic PRNG (xoshiro128**) with the sampling helpers a game actually
 * needs. ALL gameplay and visual randomness must run through this, never
 * Math.random(), or captures are not reproducible and the pixel gate
 * (tools/imagediff.mjs) is worthless.
 *
 * Use fork() to give each subsystem its own stream: two systems drawing from one
 * stream make each one's output depend on how many numbers the other consumed,
 * which turns an unrelated change into a visual diff.
 */
export class Rng {
  constructor(seed = 0x9e3779b9) {
    this.seed(seed);
  }

  seed(s) {
    // SplitMix32 to spread one 32-bit seed across the four state words.
    let z = s >>> 0;
    const next = () => {
      z = (z + 0x9e3779b9) >>> 0;
      let x = z;
      x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
      x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
      return (x ^ (x >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    this._spare = undefined;
    return this;
  }

  /** Uniform uint32. */
  u32() {
    const rot = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rot(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rot(this.s3, 11);
    return result;
  }

  /** Uniform [0,1). */
  float() {
    return this.u32() / 4294967296;
  }

  /** Uniform [min,max). */
  range(min, max) {
    return min + (max - min) * this.float();
  }

  /** Uniform integer [min,max] inclusive. */
  int(min, max) {
    return min + (this.u32() % (max - min + 1));
  }

  /** Uniform [-1,1]. */
  signed() {
    return this.float() * 2 - 1;
  }

  bool(p = 0.5) {
    return this.float() < p;
  }

  /** Standard normal via Box–Muller; the pair's second sample is cached. */
  gauss() {
    if (this._spare !== undefined) {
      const v = this._spare;
      this._spare = undefined;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * this.float();
    this._spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  pick(arr) {
    return arr[this.u32() % arr.length];
  }

  /** In-place Fisher–Yates. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.u32() % (i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Uniform point in the unit disc — spread cones, splash positions, emission. */
  disc(out = { x: 0, y: 0 }) {
    const r = Math.sqrt(this.float());
    const a = this.float() * Math.PI * 2;
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    return out;
  }

  /** Uniform direction on the unit sphere. */
  sphere(out = { x: 0, y: 0, z: 0 }) {
    const z = this.signed();
    const a = this.float() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    out.z = z;
    return out;
  }

  /** Independent stream derived from this one. Give one to each subsystem. */
  fork() {
    return new Rng(this.u32());
  }

  /** Snapshot / restore — needed by anything that must be simulation-transparent
   *  (see lib/prewarm.js: it steps nothing, but hooks might). */
  save() {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3, spare: this._spare };
  }

  load(s) {
    this.s0 = s.s0;
    this.s1 = s.s1;
    this.s2 = s.s2;
    this.s3 = s.s3;
    this._spare = s.spare;
    return this;
  }
}

/** Deterministic 2D/3D value hash — for "random-looking" detail that must be a
 *  pure function of position (dressing, per-instance variation, noise seeds). */
export function hash3(x, y, z) {
  let h = Math.imul(Math.round(x * 1013) ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ Math.round(y * 1619), 0xc2b2ae35);
  h = Math.imul(h ^ Math.round(z * 31337), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth value noise, period 1 unit. Deterministic, allocation-free. */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

/** Fractal sum of noise3. octaves>4 rarely pays for itself on CPU. */
export function fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
  let f = 1, a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise3(x * f, y * f, z * f);
    norm += a;
    f *= lacunarity;
    a *= gain;
  }
  return sum / norm;
}
