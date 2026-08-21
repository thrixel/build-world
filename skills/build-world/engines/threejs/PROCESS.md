# Process — running the loop

How to actually spend the iterations. `threejs.md` is the method; this is the
operating manual for review rounds, agent briefs and stopping conditions.

---

## 1. The loop

```
                 ┌─────────────────────────────────────────┐
                 v                                         │
  capture ──> contact sheet ──> critique + MEASURE ──> fix ─┘
   (all shots)   (one image)     (rubric + pixelstats)   (one owner
                                                          per coupled
                                                          concern)
```

One round is: `capture.mjs` → `contactsheet.mjs` → critique → fixes →
`smoke.mjs` → recapture. Budget it so you can run 5-10 rounds; if a round costs
more than that, cut the shot count or the settle frames, not the measurement.

**Never skip `smoke.mjs`.** A round that ships a beautiful frame and a broken game
is worse than no round: the next critique is against a build nobody can play.

---

## 2. Critiquing well

### The brief

A critic that is only told "is this good?" produces prose. Give it:

1. **The reference bar, explicitly.** "Compare against <named reference>" — and if
   you have reference frames, put them side by side and ask which is better,
   blind. In the reference project, every critic in every round picked the real
   AAA frame. Knowing that is more useful than a score.
2. **What each shot is for** — the `doc` line from the shot list. Otherwise the
   critic reviews composition when the shot exists to show material detail.
3. **A rubric with axes**, so scores are comparable across rounds.
4. **A demand for specificity**: subsystem, object, and mechanism. "The wall looks
   bad" is unactionable; "the wall's albedo variation is one frequency, so it reads
   as noise at 0.5 m" names the fix.
5. **A defect count**, separately from the score. Score movement is noisy; a count
   of frame-ruining defects is not. Track both — in the reference project, three
   parallel rounds moved the score up while the defect count went *up* too, and
   that divergence is what exposed the approach as wrong.

### The rubric (adapt the axes, keep the shape)

| axis | what a low score means |
|---|---|
| Materials | flat, single-frequency noise, no detail at 0.5 m, no edge wear or grime |
| Lighting | uniform, no key/fill/rim separation, no contact shadows, no bounce |
| Composition | nothing leads the eye, silhouettes unreadable, scale ambiguous |
| Detail density | empty surfaces, repeated props at identical yaw/scale, clean edges |
| Feedback / weight | actions without recoil, shake, impact FX, audio transient |
| UI | unreadable over gameplay, misaligned, inconsistent type scale |
| Coherence | one shot's exposure or palette inconsistent with the others |

Score each 0-10, list defects with severity, and demand the single highest-leverage
fix per subsystem.

### Then measure, before acting

Critique tells you where to look. These tell you what is there:

```bash
node tools/pixelstats.mjs shots/latest          # L, saturation, clipping, detail energy
node tools/crop.mjs shots/latest/detail.png /tmp/c.png 0.3 0.35 0.25 0.3 --scale=3
node tools/pixelstats.mjs shots/round-04 --vs=shots/round-05   # did it actually change?
```

Rules of thumb from the `pixelstats` output:
- `crush% > 10` — shadow detail is gone, not "moody"
- `blown% > 0.5` — highlights are glare, not "punchy"
- `sat% < 5` — reads grey/plastic; `> 25` reads cartoon (undesirable UNLESS a requested art style)
- `edge` near 0 over a surface region — that surface is genuinely flat; no amount
  of lighting work will fix it
- `BR` (blue minus red) the same sign everywhere — the whole frame is one colour
  temperature, so there is no key/fill separation to read

---

## 3. Briefing an owner

A good brief for one pass, whether it is you in the next hour or a subagent:

```
YOU OWN src/<dir>/ ONLY. Read ARCHITECTURE.md first, then your subsystem's code.

TASK: <one coupled concern, named>

WHAT THE CRITICS SAID (verbatim, with the shot names):
  ...

WHAT THE MEASUREMENTS SAY:
  <pixelstats / profiler / selftest output>

CONSTRAINTS
  - no new dependencies; no Math.random(); no per-frame allocation
  - honour ctx.config.q budgets; dispose what you create
  - implement prewarmMaterials() if you create materials
  - your port is <5300+n>          (concurrent agents collide on strictPort)

VERIFY BEFORE YOU CLAIM ANYTHING
  npx vite build
  node tools/smoke.mjs --port=<port>
  node tools/capture.mjs --shots=<the shots this affects> --out=/tmp/<you> --port=<port>
  node tools/mobilecheck.mjs --port=<port>    (if you touched input, UI or the renderer)
  <the gate, if this is a no-visual-change pass>

REPORT
  measured numbers before and after, not impressions. What you tried and reverted,
  and why. Anything you needed outside your directory — describe it, do not edit it.
  IF THE BRIEF IS WRONG, SAY SO AND PROVE IT WITH A MEASUREMENT. The most valuable
  result on this project came from an agent that contradicted its brief.
```

The last line is not a formality. See PITFALLS E2.

---

## 4. What to parallelise

Independence is defined by **coupling, not by directory**.

**Parallelise:**
- discovery/search: many readers, no writers
- independent audits of one dimension each (perf, a11y, correctness, budgets)
- per-item verification of a finding list — one skeptic per finding, prompted to
  *refute*, kill the finding if the majority refute it
- N independent design options, scored, best one taken forward with grafts
- mechanical migrations over disjoint files
- subsystems with no shared visual budget: audio, UI, input, save/load

**Do not parallelise:**
- tonemapping / exposure / sky / indirect light / material albedo — one system
- anything where two agents must agree on a number
- anything whose correctness is only visible in the composite
- a "fix the art" fan-out. It measurably makes things worse.

When you do fan out, give each agent: its own directory, its own port, the same
contract file, and an explicit statement of what it must NOT touch.

---

## 5. Performance passes

Order matters. Determinism first, or nothing after it is verifiable.

1. **Determinism.** Remove every wall-clock dependency. Prove it: an expensive boot
   step toggled on/off must be `identical: true` through the gate.
2. **Capture the canonical baseline** — after the art has settled, before any
   optimisation. Everything later is judged against these exact PNGs. Do not reuse
   an older baseline: it will flag intended art changes as regressions.
3. **Attribute before optimising.** `profile.mjs` tells you whether a hitch is a
   shader compile (`progDelta > 0`), lazy resource creation (`geoDelta`/`texDelta`),
   or real GPU/CPU cost. Optimising the wrong one is the default outcome.
4. **Optimise, one concern at a time, each gated.** Faster + one pixel moved =
   failed. Revert and report as not viable, or find the cause and eliminate it.
5. **Re-measure 3+ times and report the spread**, plus a cold-cache run
   (`--warmup=0`), which is the real first-load experience.

Typical order of wins: pre-warm every shader → hold the light count constant →
instance repeated geometry → cull shadow casters per cascade → merge static
geometry → sector/portal visibility → LOD → `renderScale`.

---

## 6. Stopping and reporting

**Stop a loop** when the score plateaus over two rounds. Then change the
measurement, not the effort: crop closer, add a shot for an unwatched axis, or
replace a subjective axis with a number.

**Report** with: what it is, how to run it, the subsystem table, the tooling, the
measured performance table (before/after), and an *honest assessment* naming
specific shortfalls and any known-unfixed root cause. Include the process finding —
what worked and what did not — because that is the part that transfers to the next
project.

A report that says "matches AAA" when eleven blind critics chose the reference every
time is not a report. Say the gap, name the mechanism, and let the numbers stand.
