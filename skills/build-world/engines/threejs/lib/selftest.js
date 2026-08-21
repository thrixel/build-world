/**
 * A 40-line assert harness for subsystem self-tests. No dependencies, runs in
 * node and in the browser.
 *
 * WHY IT EXISTS: a screenshot cannot show that a capsule tunnelled through a
 * wall, that a ragdoll is gaining energy, that a nav path is unreachable, that a
 * synthesised sound is silent or clipping, or that a generated mesh has NaN
 * vertices. Those are exactly the failures that a visual critic will report as
 * something else ("the enemy looks wrong") and send you hunting in the wrong
 * subsystem.
 *
 * The pattern that paid off in the reference project: every non-visual subsystem
 * ships a `selftest` that prints a TABLE of measured-vs-expected, runnable as
 * `node src/<system>/selftest.mjs`. Measured numbers, not assertions that pass
 * silently — the table is the artifact you paste into a report, and a reviewer
 * can see a value drifting before it crosses a threshold.
 *
 *   const t = suite('physics');
 *   t.ok(hit !== null, 'ray hits the wall');
 *   t.near(speed, 4.57, 0.12, 'walk top speed', 'm/s');
 *   t.range(slide, 0.75, 0.95, 'slide duration', 's');
 *   process.exit(t.report());
 */
export function suite(name) {
  const rows = [];
  let failures = 0;

  const push = (pass, label, measured, expected, unit) => {
    rows.push({ pass, label, measured, expected, unit: unit ?? '' });
    if (!pass) failures++;
    return pass;
  };

  return {
    name,
    section(title) {
      rows.push({ section: title });
    },
    ok(cond, label, detail = '') {
      return push(!!cond, label, cond ? 'yes' : 'NO', detail || 'yes');
    },
    eq(got, want, label, unit) {
      return push(got === want, label, got, want, unit);
    },
    near(got, want, tol, label, unit) {
      return push(Number.isFinite(got) && Math.abs(got - want) <= tol, label, fmt(got), `${want} ±${tol}`, unit);
    },
    range(got, lo, hi, label, unit) {
      return push(Number.isFinite(got) && got >= lo && got <= hi, label, fmt(got), `${lo}..${hi}`, unit);
    },
    finite(arr, label) {
      let bad = 0;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
      return push(bad === 0, label, `${bad} non-finite`, '0 non-finite');
    },
    /** Report as a table. Returns the exit code: 0 = all pass. */
    report({ log = console.log } = {}) {
      const w = (s, n) => String(s).padEnd(n);
      log(`\n${name} — ${rows.filter((r) => r.pass === true).length}/${rows.filter((r) => 'pass' in r).length} pass`);
      log(w('TEST', 34) + w('MEASURED', 16) + w('EXPECTED', 18) + 'RESULT');
      for (const r of rows) {
        if (r.section) {
          log(`\n${r.section}`);
          continue;
        }
        log(w(r.label, 34) + w(r.measured + r.unit, 16) + w(r.expected + r.unit, 18) + (r.pass ? 'PASS' : 'FAIL'));
      }
      if (failures) log(`\n${failures} FAILURE${failures > 1 ? 'S' : ''}`);
      return failures ? 1 : 0;
    },
    get failures() {
      return failures;
    },
    rows,
  };
}

const fmt = (v) =>
  typeof v === 'number' ? (Math.abs(v) < 100 ? v.toFixed(3) : v.toFixed(1)) : String(v);

/**
 * Statistics for measuring feel and cost. `p(0.99)` is the number that matters
 * for frame time; a mean or median hides exactly the stalls players notice.
 */
export function stats(values) {
  const a = Float64Array.from(values).sort();
  const n = a.length;
  if (!n) return { n: 0 };
  let sum = 0;
  for (const v of a) sum += v;
  const p = (q) => a[Math.min(n - 1, Math.max(0, Math.floor(n * q)))];
  return {
    n,
    min: a[0],
    max: a[n - 1],
    mean: sum / n,
    p1: p(0.01), p50: p(0.5), p90: p(0.9), p95: p(0.95), p99: p(0.99),
    p: (q) => p(q),
  };
}
