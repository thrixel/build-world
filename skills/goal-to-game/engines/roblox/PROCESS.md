# Process — running the loop (Roblox)

How to actually spend the iterations. `roblox.md` is the method; this is the operating manual for
review rounds, agent briefs and stopping conditions, adapted from the three.js kit to the tools
Roblox actually has.

---

## 1. The loop

```
                 ┌──────────────────────────────────────────────┐
                 v                                              │
  capture ──> contact sheet ──> critique + MEASURE ──> fix ─────┘
  (Studio     (one labelled     (rubric + DevConsole /        (one owner
   screenshot  image per shot)   Performance Stats)          per coupled
   plugin)                                                      concern)
```

One round is: screenshot plugin (all shots) → contact sheet (one labelled image) → critique →
fixes → play-test script (the Roblox analogue of `smoke.mjs`) → recapture. Budget it so you can run
5–10 rounds; if a round costs more than that, cut the shot count, not the measurement.

**Never skip the play-test script.** A round that ships a beautiful frame and a broken place is
worse than no round: the next critique is against a build nobody can play. The play-test script
must at minimum spawn, drive the player/vehicle, and reach the main gameplay loop without erroring.

---

## 2. Critiquing well

### The brief

A critic that is only told "is this good?" produces prose. Give it:

1. **The reference bar, explicitly.** "Compare against <named reference>" — and if you have
   reference frames, put them side by side and ask which is better, blind.
2. **What each shot is for** — the `doc` line from the shot list. Otherwise the critic reviews
   composition when the shot exists to show material detail (the glass slot, the PBR metalness).
3. **A rubric with axes**, so scores are comparable across rounds.
4. **A demand for specificity**: subsystem, object, and mechanism. "The lighthouse looks bad" is
   unactionable; "the lighthouse's stone reads as one flat albedo with no roughness variation, so
   it looks plastic at 0.5 m" names the fix.
5. **A defect count**, separately from the score. Score movement is noisy; a count of frame-ruining
   defects is not. Track both.

### The rubric (adapt the axes, keep the shape)

| axis | what a low score means |
|---|---|
| Materials | flat, single-frequency noise, no detail at close range, no PBR separation (glass reads painted, chrome reads grey) |
| Lighting | uniform, no key/fill/rim separation, no contact shadows, no bounce |
| Composition | nothing leads the eye, silhouettes unreadable, scale ambiguous |
| Detail density | empty surfaces, repeated props at identical yaw/scale, clean edges |
| Feedback / weight | actions without recoil, shake, impact FX, sound transient |
| UI | unreadable over gameplay, misaligned, inconsistent type scale |
| Coherence | one shot's exposure or palette inconsistent with the others |

Score each 0–10, list defects with severity, and demand the single highest-leverage fix per
subsystem.

### Then measure, before acting

Critique tells you where to look. Studio's tools tell you what is there:

- **Performance Stats** (Studio → View → Stats, or the `Developer Console` → Performance tab):
  frame time, part count, triangle count, draw calls, physics time. The Roblox analogue of
  `pixelstats.mjs` + `profile.mjs`.
- **MicroProfiler** for hitch attribution — a spike in "Physics" vs "Render" vs "Network" tells you
  which budget you are blowing.
- **Part/triangle budget**: `Workspace:GetDescendants()` filtered to `MeshPart` gives you a real
  part count; sum triangles from the `MeshPart` geometry (or read the import report) for a real
  triangle count. A "looks fine" impression is not a number.

Rules of thumb:

- **> 20,000 triangles on any mesh** → it should have failed import; if it did not, you have a
  hand-authored or split mesh that will hurt.
- **Hundreds of `MeshPart`s per model** → you grouped wrong; the material-slot split should be the
  *only* thing multiplying parts.
- **Frame time p99 > 33 ms sustained** → you are below 30 FPS and failing the stated bar; find the
  hitch, do not rationalise it.

---

## 3. Briefing an owner

A good brief for one pass, whether it is you in the next hour or a subagent:

```
YOU OWN <ReplicatedStorage/<dir>/ or the specific Model> ONLY. Read
templates/ARCHITECTURE.md first, then the module(s) you own.

TASK: <one coupled concern, named>

WHAT THE CRITICS SAID (verbatim, with the shot names):
  ...

WHAT THE MEASUREMENTS SAY:
  <frame time / part count / triangle count / DevConsole output>

CONSTRAINTS
  - honour ReplicatedStorage.Config budgets
  - no new imports you did not clear; no unseeded Random.new() in gameplay
  - every MeshPart gets a SurfaceAppearance if it needs one; CastShadow=false on dressing
  - your Rojo project root is <this one>   (concurrent agents collide on Studio)

VERIFY BEFORE YOU CLAIM ANYTHING
  <open the place, run the play-test script, capture the shots this affects>

REPORT
  measured numbers before and after, not impressions. What you tried and reverted, and why.
  Anything you needed outside your directory — describe it, do not edit it.
  IF THE BRIEF IS WRONG, SAY SO AND PROVE IT WITH A MEASUREMENT.
```

The last line is not a formality. The most valuable result on the three.js reference project came
from an agent that contradicted its brief and proved it with a measurement.

---

## 4. What to parallelise

Independence is defined by **coupling, not by directory**.

**Parallelise:**

- discovery/search: many readers, no writers
- independent audits of one dimension each (perf, materials, correctness, budgets)
- per-item verification of a finding list — one skeptic per finding, prompted to *refute*
- N independent design options, scored, best one taken forward
- mechanical migrations over disjoint files / disjoint Models
- subsystems with no shared visual budget: audio, UI, input, save/load

**Do not parallelise:**

- lighting / exposure / sky / material response — one coupled system, even in Roblox
- anything where two agents must agree on a number
- anything whose correctness is only visible in the composite
- a "fix the art" fan-out. It measurably makes things worse.

When you fan out, give each agent: its own Rojo root (or Model), its own place file, the same
contract file, and an explicit statement of what it must NOT touch.

---

## 5. Performance passes

Order matters. Get the geometry right first, or nothing after it is verifiable.

1. **Geometry first.** Group → decimate to ≤ 20k → watertight/thickness check → split by material
   slot. A perf pass on broken geometry is wasted work.
2. **Capture the canonical baseline** — after the art has settled, before any optimisation.
   Everything later is judged against these exact screenshots and numbers.
3. **Attribute before optimising.** MicroProfiler tells you whether a hitch is render, physics, or
   network. Optimising the wrong one is the default outcome.
4. **Optimise, one concern at a time, each gated.** Faster + a visible change = failed. Revert and
   report as not viable, or find the cause and eliminate it.
5. **Re-measure 3+ times and report the spread**, plus a cold-start run (fresh Studio load), which
   is the real first-load experience.

Typical order of wins: group parts → cut shadow casting on dressing → instance repeated geometry
(recolour one mesh rather than import many) → enable StreamingEnabled for large places → reduce
unique textures via a shared `reference_image_id` → LOD where the engine supports it.

---

## 6. Stopping and reporting

**Stop a loop** when the score plateaus over two rounds. Then change the measurement, not the
effort: crop closer, add a shot for an unwatched axis (the glass slot in low light), or replace a
subjective axis with a number.

**Report** with: what it is, how to run it, the subsystem/Model table, the tooling (screenshot
plugin, play-test script), the measured performance table (before/after), and an *honest
assessment* naming specific shortfalls and any known-unfixed root cause. Include the process
finding — what worked and what did not — because that is the part that transfers to the next
project.

A report that says "matches AAA" when the blind critic chose the reference every time is not a
report. Say the gap, name the mechanism ("the glass slot reads as painted because we imported
`Body` whole rather than splitting by material"), and let the numbers stand.
