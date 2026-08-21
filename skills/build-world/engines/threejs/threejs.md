# three.js

Engine-specific rules for the Three.js path. The shared Thrixel asset pipeline is in
[../../SKILL.md](../../SKILL.md); this file covers what you need to know for Three.js.

---

This kit is for building an ambitious browser game in Three.js from a single
open-ended prompt ("make me a AAA <genre> game", "build X in ThreeJS, make it perfect,
loop until it's great"). It provides the harness that makes visual quality measurable,
a reusable engine/tooling library, the sequential-owner process that beats parallel fan-out,
and the measured Three.js pitfalls that eat whole iteration rounds. Use when starting
such a project, when a Three.js game "looks wrong" or stutters and you need to find out
why, or when setting up screenshot review, a pixel-diff gate, or a gameplay profiler.

## Building a Three.js game from one prompt

A one-prompt game brief ("build a AAA X, make it perfect, keep iterating") is not a
coding problem. It is a **measurement** problem. You will write more code than you
can hold in context, judged on a quality axis you cannot see from the terminal, in
a runtime that hides its two worst failure modes (shader compilation stalls and
nondeterminism) from every naive test you would write.

Everything in this kit exists to make the loop *converge*: build → capture →
measure → fix, with each step cheap enough to run many times and honest enough
that its verdict means something.

This kit was distilled from a full run of that brief — an FPS, ~55k lines, 11
subsystems, no art assets, scored by adversarial critics over multiple rounds.
Numbers quoted below are measured from that project, not estimates. "The reference
project" throughout these docs means that build.

Projects you build with this kit will differ from that build in that you will use Thrixel
(see top-level [../../SKILL.md](../../SKILL.md) to create 3D models.

---

## The seven rules

1. **Write the contract before the code.** One file (`ARCHITECTURE.md`) that names
   every subsystem, who owns which directory, the interface, and the event
   vocabulary. Systems reach each other through `ctx.get(id)` at runtime and never
   import each other.
2. **Build the harness before the game.** A named shot list plus screenshot
   capture, on day one, with a still-ugly blockout. You cannot iterate on quality
   you cannot see, and a harness added later is always the wrong shape.
3. **One owner per coupled concern, working sequentially.** Parallel fan-out over
   directories loses to sequential single-owner passes on anything visual. See
   *Sequential beats parallel* below — this is the biggest single finding.
4. **Determinism is a feature, not a nicety.** Fixed timestep, seeded RNG,
   engine-clock-only animation, lockstep capture. It is what turns "I think this
   looks the same" into `identical: true`.
5. **Measure the frame, don't argue about it.** A critic says *where* it looks
   wrong; `tools/pixelstats.mjs` says *what is actually there*. Three review rounds
   went the wrong direction on the reference project for want of one measurement.
6. **A median frame time is a lie.** Profile real gameplay at real DPR and report
   p99 and every hitch. A static-camera benchmark said 94 fps for a game running
   12-17 fps with 1.2-second stalls.
7. **Report honestly, including the gap.** "It does not match a modern AAA title,
   here is specifically where and why" is a deliverable. "Done, looks great" is
   not, and the next round of work will be built on it.

---

## Phase plan

Do these in order. Each phase ends with something you can run.

### Phase 0 — Contract (30 min, no game code)

Write `ARCHITECTURE.md` from `templates/ARCHITECTURE.md`. Decide:

- the subsystem list and the **directory each one owns**
- the shared `ctx` and the subsystem interface (`init/fixedUpdate/update/lateUpdate/resize/prewarmMaterials/dispose`)
- the **event vocabulary** — every cross-subsystem message, its payload, and who
  emits it. Getting this wrong is the main source of double-applied damage,
  duplicated FX and "who owns this" churn.
- the shared **vocabulary of kinds** your game needs (surface types, entity
  classes, damage types, tile types) so FX, audio and gameplay agree
- hard rules: no new dependencies, no `Math.random()`, no per-frame allocation,
  dispose what you create, the build must pass and a capture must succeed after
  every change

### Phase 1 — Spine (the first thing that runs)

`lib/` gives you the whole spine; copy `example/` and gut it.

- `Engine` + `Registry` + `EventBus` + seeded `Rng` + `Input`
- a render system that owns the renderer and nothing else
- `installShotApi` + `signalReady` + `prewarm`
- `tools/capture.mjs` producing a PNG of a grey box

**Gate:** `node tools/capture.mjs --list` shows your shots and `node tools/smoke.mjs`
passes. Nothing else starts until this works.

### Phase 2 — Shot list + blockout

Write the shot list (`example/shots.js` is the annotated template) and a blockout
level. 8-12 shots, one per axis you will be judged on, each with a `doc` line
saying what it is *for*.

For any genre, cover: **establishing** (art direction), **close detail** (material
quality at 0.5 m — the most common failure), **two lighting extremes**, **an
enclosed space** (AO/bounce/contact shadows), **the thing the player looks at most**
(weapon/vehicle/avatar/board), **transient FX at its peak**, **UI over gameplay**.

Point each shot at something deliberately placed. A review shot aimed at random
geometry produces critiques of the wrong thing for rounds on end.

**Gate:** `node tools/capture.mjs` writes every shot, no blanks, no console errors;
`node tools/contactsheet.mjs shots/latest` gives one reviewable image.

### Phase 3 — Subsystems

One owner per subsystem, working inside its directory. Every subsystem, before it
is "done":

- honours the budgets in `ctx.config.q` and never exceeds them
- allocates nothing per frame (`lib/pool.js`)
- disposes everything it creates (`lib/dispose.js`)
- implements `prewarmMaterials()` (`lib/prewarm.js`)
- exposes a **debug hook** the shot list can drive (`debugBurst`, `debugStage`,
  `debugPose`, `debugState`) so its output can be captured on demand
- has a **self-test or bench** if its correctness is not visible in a screenshot
  (`lib/selftest.js`, and `example/feeltest.mjs` for the browser-driven shape) —
  physics tunnelling, path solvability, audio silence or clipping, NaN geometry,
  generator budgets, and anything that is a *relationship* between two runtime
  quantities (does W move you where the camera points? is the jump arc the height
  you specified? does the projectile lead the target?). This class of bug passes a
  clean build, a full shot set AND a smoke test — see PITFALLS F.

### Phase 4 — Review loop

```
capture → contact sheet → critic → fix (one owner per coupled concern) → recapture
```

Run it until the score plateaus, then change what you are measuring rather than
running the same loop again. See `PROCESS.md` for the critic brief, the scoring
rubric, and how to keep a critic honest.

### Phase 5 — Performance, behind the pixel gate

Do this **after** the art settles, never during, and never without the gate:

```bash
node tools/baseline.mjs --out=shots/base            # reference, before any change
# ... optimise ...
node tools/baseline.mjs --out=/tmp/after
node tools/imagediff.mjs --a=shots/base --b=/tmp/after   # must be identical:true
node tools/profile.mjs --dpr=2 --frames=900 --runs=3     # p99 and hitches, 3 runs
```

Then check the device you did not develop on, before anyone gets a link:

```bash
node tools/mobilecheck.mjs --port=5273    # phone viewport, DPR 3, touch, no keyboard
```

An optimisation that is 20% faster and moves one pixel is a failed optimisation.
Either find why it moved and eliminate it, or revert and report it as not viable.
Never rationalise a diff as imperceptible — that is how a regression ships.

**The gate has a prerequisite** most projects fail: nothing may animate off
`performance.now()`. Prove it by A/B-ing an expensive boot step:

```bash
node tools/baseline.mjs --out=/tmp/off --query=prewarm=0
node tools/baseline.mjs --out=/tmp/on  --query=prewarm=1
node tools/imagediff.mjs --a=/tmp/off --b=/tmp/on        # must be identical:true
```

On the reference project this reported 78-88% of pixels changed before the
wall-clock dependencies were fixed. In this kit's `example/` it reports
`identical: true` — that is the bar, and it is reachable.

### Phase 6 — Honest report

State what was achieved, what was measured, and where it falls short *specifically*
(name the subsystem and the mechanism). Include the numbers: fps distribution,
worst frame, programs compiled during play, boot time, draw calls, triangles. Give
the shortfalls their own section — one line each, naming the subsystem and the
mechanism, e.g. "hands: blocky finger slabs that don't convincingly grip the
weapon", "indirect light: an approximation, not real GI". `PROCESS.md` §6 has the
full shape.

---

## Sequential beats parallel — the biggest finding

Measured on the reference project, on the same codebase, with the same critics:

| approach | quality score | frame-ruining defects |
|---|---|---|
| 3 rounds x 6 parallel agents, one directory each | +0.46 | 60 → 47 → **66** (worse) |
| 1 sequential pass, one owner per coupled concern | **+1.00** | 66 → **26** |

**Why:** tonemapping, sky, exposure, indirect light and material albedo are *one
coupled system*. Isolated agents each fixed their local symptom by breaking a
shared assumption — one crushed albedos to fight bright highlights while another
raised exposure to fight dark shadows, and the sum was worse than either.

**The rule:** parallelise only what is genuinely independent, and define
independence by *coupling*, not by directory.

- **Safe to parallelise:** discovery and search (many readers, no writers),
  independent audits, per-item verification of a finding list, generating N
  independent design options to choose between, mechanical migrations over disjoint
  files, one-directory work where the directories share no visual coupling
  (audio vs UI vs input).
- **Not safe:** anything touching a shared visual budget (light, colour, exposure,
  tone), anything where two agents must agree on a number, any change whose
  correctness is only visible in the composite of several subsystems.

Also from the same project: **the most valuable single result came from an agent
contradicting its own brief.** Every critic for three rounds reported the weapon as
"untextured". It was not — it was specular-dominated, diffuse measured at L=26
against a shipped L=67, and the prior rounds' albedo-crushing (done to satisfy the
complaints) had caused it. The fix was the opposite of what was asked for.
So: brief agents to report when the brief is wrong, and give them the measurement
tools to prove it.

---

## What the kit gives you

### `lib/` — runtime (import from `lib/index.js`)

| file | what it is for |
|---|---|
| `engine.js` | frame loop, fixed timestep, `ctx`, boot-with-visible-failure |
| `registry.js` | topo-sorted subsystems, `ctx.get(id)`, event bus |
| `rng.js` | seeded xoshiro128** + `fork()`, value noise, fbm |
| `config.js` | quality presets as budgets, URL-driven config, `autoQuality()` by device |
| `input.js` | per-frame input snapshot, keyboard + mouse + **touch**, `inject()` so bots drive the real input layer |
| `touchui.js` | on-screen stick indicator and action buttons, hidden until a real finger arrives |
| `shots.js` | **the capture API**: named shots, lockstep determinism, fixed shutter |
| `prewarm.js` | shader pre-warm + the four traps that make it useless |
| `lights.js` | `LightBallast` / `LightPool` — hold the light count constant |
| `pool.js` | `scratch()`, `Pool`, `InstanceRing`, `ParticleStore` — zero per-frame allocation |
| `dispose.js` | `disposeTree`, `Owned` — GPU resources are not garbage collected |
| `selftest.js` | measured-vs-expected table harness for non-visual subsystems |

### `tools/` — harness

| tool | what it is for |
|---|---|
| `capture.mjs` | fast review set, all shots in one session, blank-frame detection |
| `baseline.mjs` | **reproducible** capture — isolated page + lockstep per shot |
| `imagediff.mjs` | **the pixel gate**; reports the changed bounding box |
| `contactsheet.mjs` | tile a shot set into one labelled image for review |
| `pixelstats.mjs` | luminance/saturation/clipping/detail-energy per shot and region |
| `crop.mjs` | crop + magnify a region; close-range defects are invisible at 1:1 |
| `profile.mjs` | gameplay profiler: real DPR, moving camera, p99, hitch attribution |
| `smoke.mjs` | 8-second "does it still work" gate; drives the real input layer |
| `mobilecheck.mjs` | phone viewport + DPR 3 + touch: can a thumb actually play it? |
| `example/feeltest.mjs` | pattern: a **bench** for correctness no screenshot shows |
| `tools/lib/harness.mjs` | shared CLI/server/browser plumbing for all of the above |

### `example/` — a working game using all of it

Small but real: procedural surfaces, instanced props, an FX system with pooled
lights and a decal ring buffer, a DOM HUD, seven shots. Verified in this repo:
two independent `baseline.mjs` runs are **bit-identical on all 7 shots**, and
`prewarm=0` vs `prewarm=1` is **identical**, i.e. the pixel gate genuinely works.

```bash
npm run setup                     # npm ci + the Chromium binary (~115 MB, once
                                  # per machine — npm install does NOT fetch it)
npm run dev                       # play it
node tools/capture.mjs --out=shots/latest --port=5273
node tools/contactsheet.mjs shots/latest
node tools/smoke.mjs --port=5273 --events=weapon:fire,bullet:impact --expect=forward
node tools/mobilecheck.mjs --port=5274    # 13 checks, incl. "a thumb can move the player"
node example/feeltest.mjs --port=5279     # 29 measured movement assertions
```

Use a project-specific `--port`. Attaching to another project's dev server on
5173 presents as a `__READY__` timeout that looks like a game bug.

---

## Determinism doctrine

Four rules. Break any one and the pixel gate silently becomes noise, which costs
you the ability to verify anything for the rest of the project.

1. **All randomness through `ctx.rng`** (`fork()` per subsystem, so one system's
   consumption cannot shift another's sequence). No `Math.random()`.
2. **All animation off `ctx.time`** (`elapsed`, `dt`, `frame`) — never
   `performance.now()`, `Date.now()`, or CSS animations/transitions. Instrumentation
   that only logs a duration is fine.
3. **Simulation in `fixedUpdate`**, presentation interpolated with `time.alpha`.
   Read input edges in `update`, never in `fixedUpdate`.
4. **Capture in lockstep** — the engine schedules no frames; the harness pumps
   exactly N. Otherwise the frame index at the shutter drifts 10-20 frames run to
   run and everything phase-locked to it resolves differently.

## Performance doctrine

The three things that actually cost you frames in Three.js, in the order they bit:

1. **Shader compilation during play.** 86-146 programs compiled mid-gameplay,
   up to 30 on one frame, 700 ms - 3.9 s stalls. Fix: `prewarmMaterials()` on every
   subsystem, plus hold the visible light count constant (`lib/lights.js`).
2. **Draw calls and unculled shadow casters.** ~1350 draw calls with every opaque
   mesh submitted to every cascade. Fix: instancing, per-cascade caster culling,
   merged static geometry, sector/portal visibility.
3. **Resolution, not geometry.** A DPR-2 laptop renders 3.34 MP internally, not
   2.07. Always profile at real DPR; `renderScale` is the first knob.

Report `p50/p95/p99/max`, hitch count with per-frame program deltas, boot time,
heap growth, and the **spread across at least 3 runs**. Single runs of a gameplay
profiler vary enough to have produced one confidently wrong conclusion.

## Mobile — the device most of your players will use

A finished game becomes a link, and a link gets opened on a phone. Every other
tool in this directory measures the game on a 1920x1080 desktop with a mouse and
a keyboard, which is the one setup most of the people you share with will not be
using. Treat phone playability as a requirement of "done", not as a port.

**The kit already does the hard half.** `lib/input.js` feeds touch into the same
per-frame snapshot the keyboard feeds: the left of the screen is a floating
analog stick that lands in `axis2()`, the right is a look-drag that lands in
`look`, and `input.bindButton(el, 'jump')` routes an on-screen button to the same
`held('jump')`. So **gameplay code needs no touch branch anywhere** — if your
systems read actions rather than key codes, they are already mobile.

What you still have to do, in the order it bites:

1. **Cap the pixel ratio.** A phone reports `devicePixelRatio` 3, so an uncapped
   renderer asks a phone GPU for ~3.5x the pixels of a 1080p laptop. This is the
   single biggest mobile performance fact and it is one line:
   `renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxPixelRatio) * q.renderScale)`.
   `maxPixelRatio` is a budget in every quality preset.
2. **Start phones on a lower preset.** `autoQuality()` returns `low` for a
   coarse-pointer device. It is deliberately crude — no UA sniffing, no GPU
   guessing — and a game that wants better should watch its own first seconds of
   frame time and call `config.setQuality()`. Capture mode ignores all of this
   and pins `high`, or the pixel gate would vary by machine.
3. **Show the controls.** `TouchControls` (`lib/touchui.js`) draws the stick
   indicator and a small cluster of action buttons, and stays hidden until
   `input.touchActive` — so a headless capture never sees it and your pixel gate
   is unaffected. Verified in this repo: adding the whole touch layer left all
   seven baseline shots `identical: true`. **Touch input with no visible controls
   is the most common mobile failure**, and it does not look like a bug to the
   player: they see a 3D scene, tap once, and leave.
4. **Size the HUD for a thumb and a small screen.** 44 CSS px is the floor for
   anything pressable. 12px monospace diagnostics are unreadable on a phone.
5. **Get the viewport right.** `viewport-fit=cover` plus `100dvh` (not `100vh`,
   which on iOS Safari means the height without the URL bar), `touch-action:
   none` on the canvas, `overscroll-behavior: none` on the body so a downward
   drag does not pull-to-refresh mid-game, and `env(safe-area-inset-*)` padding
   so the HUD clears the notch and the home indicator. `example/index.html` has
   all of it with the reasons in comments.
6. **Design for one thumb per side.** A control scheme needing a modifier key, a
   scroll wheel, or four simultaneous keys has no touch equivalent. Decide this
   while designing the controls, not after.

**The gate:**

```bash
node tools/mobilecheck.mjs --port=5273
```

It emulates a 390x844 phone at DPR 3 with touch pointers and no keyboard, then
dispatches a real swipe on the left of the screen and asserts the player moved.
That single assertion is the one that matters: a keyboard-only game passes
`smoke.mjs`, passes every capture, looks perfect in a contact sheet, and is
completely unplayable on a phone. It also checks horizontal overflow, the
drawing-buffer size, tap-target sizes, and writes a phone-shaped screenshot —
**look at it**, because a HUD designed on a 27-inch monitor fails in ways no
assertion catches.

Frame rate is REPORTED, not gated: headless Chromium without a usable GPU falls
back to SwiftShader, where this kit's own example measures 9 fps at desktop
resolution, and a threshold that fails every game on those machines just teaches
people to ignore the output. Judge performance with `profile.mjs` on a real GPU,
and phone performance on a real phone.

## Budgets

Put every budget in `ctx.config.q` and honour it. A budget that can be silently
exceeded is not a budget: `lib/pool.js` returns `null` at capacity and counts
rejections rather than growing. When a pass reduces coverage (top-N, sampling, no
retry), say so in the report — silent truncation reads as "covered everything".

---

## Genre adaptation

The kit is genre-generic; only the shot list and the debug hooks change.

| genre | the "most looked at" shot | busiest-state hook | non-visual self-test |
|---|---|---|---|
| FPS / TPS | weapon viewmodel, ADS | firefight staged | physics tunnelling, ballistics |
| Racing | cockpit / chase cam at speed | full grid + weather | vehicle dynamics, lap validity |
| Platformer | character at apex + landing | many actors + FX | jump arc, coyote/buffer timing |
| RTS / city | overview + max zoom-in | max units + fog | pathfinding solvability, economy |
| Puzzle / board | board at rest + mid-animation | worst-case board | rules engine, solver, no dead states |
| Horror / adventure | the lit-from-one-source room | scripted set piece | trigger reachability, save/load |

The overlay scene (`ctx.overlayScene`) is for anything attached to the viewer that
must never clip into the world: weapon, held tool, cockpit interior, held card.

---

## When to stop

Stop a review loop when the score plateaus across two rounds — running the same
loop again produces churn, not progress. Change the *measurement* instead: crop
closer, add a shot for the axis nobody is looking at, or replace subjective
critique with a number (`pixelstats.mjs`, a self-test, a profiler run).

Stop the project when the remaining gap is a known root cause you can name. Write
it down instead of hiding it. The reference project shipped with a documented
20x irradiance mismatch in its viewmodel light rig — naming it is worth more than
another round of guessing.

---

Read `PITFALLS.md` before writing renderer, FX or capture code — every entry cost
the reference project at least one full iteration round. Read `PROCESS.md` before
briefing any agent or running a review round.
