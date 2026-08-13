# Roblox Studio

Engine-specific rules for the Roblox Studio path. The shared Thrixel asset pipeline is in
[../../SKILL.md](../../SKILL.md); this file covers only what differs for Roblox.

The deliverable here is almost entirely *instructions*, not a library. Goal to Game gives the
coding agent a skill it reads before building. The shared pipeline (asset planning, `thrixel_*`
tool calls, mesh grouping) is in SKILL.md; what follows is the Roblox-specific layer: the import
boundary, the material mapping, the screenshot/verification loop, and the measured pitfalls.

---

## Rules for game dev

When developing in Roblox Studio, you MUST set up the following checklist and verifiably check off
each item:

1. **You MUST drive Studio through its import path, not by hand-assembling parts.** Every Thrixel
   asset enters as a mesh (`MeshPart`) via the Studio 3D Importer (File → Import 3D, or drag an
   `.fbx` into the 3D viewport). Never rebuild a Thrixel model out of `Part`s.
2. **Every mesh you import MUST pass Roblox's import-boundary validation.** Studio rejects meshes
   that are non-manifold, have exposed holes/backfaces, or exceed 20,000 triangles. Validate
   *before* import — see "The import boundary" below. A rejected import is the single most common
   failure on this path.
3. **One `MeshPart` carries one appearance.** Architect's semantic material slots (`Paint`,
   `Glass`, `Chrome`, `Rubber`, `Rim`, ...) do not survive as submeshes in Roblox. Each slot must
   become its own `MeshPart` with its own `SurfaceAppearance`. See "Material slots" below.
4. **You MUST run the screenshot verification loop** — Studio in edit mode AND in play mode, from
   at least 10 angles — and send every shot set to a harsh critic. See "Verification loop".
5. **Download every Thrixel asset as FBX** (`format="fbx"`). Roblox Studio's 3D Importer reads FBX
   natively; it does not read GLB. OBJ is a fallback that loses materials.
6. **Fix the forward axis once at import.** Thrixel's forward axis is inconsistent per asset. Read
   the bounding box or thumbnail, decide facing per asset, and correct it at import rather than
   discovering a lighthouse that faces sideways.
7. **Mostly avoid organic animations.** Animate through code (Tweens, `RunService`, constraints)
   where possible. Avoid humanoids or animals; Roblox's rigging adds import and scale complexity.

---

## Import format

Download `.fbx` — Roblox Studio reads it natively:

```
thrixel_download(submission_id=..., format="fbx")
```

Group BEFORE importing with `thrixel_group_parts` (free, runs on Thrixel's servers, no local
Blender needed), then import the grouped FBX through the Studio 3D Importer.

```
thrixel_group_parts(
  submission_id   = "<submission>",
  keep_groups     = [{"name": "FL"}, {"name": "FR"}, {"name": "RL"}, {"name": "RR"}],
  target_triangles = 20000,
)
```

Call `thrixel_inspect_model` first to get the real part names — a `keep_groups` entry that matches
nothing fails the job on purpose.

---

## The import boundary — why Roblox is stricter than the other engines

Unity and three.js will happily load whatever geometry you hand them. Roblox **will not**. The
Studio importer validates geometry at the import boundary against
[Roblox's mesh specifications](https://create.roblox.com/docs/art/modeling/specifications):

- **20,000 triangles per mesh, hard cap.** A mesh over the cap is refused. Thrixel's Architect
  output is 99–342 mesh nodes per model, and individual nodes routinely exceed 20k after a detail
  pass (Sculptor output arrives at 90–160k triangles). Grouping and decimation are not optional.
- **Watertight / manifold.** No exposed holes, no open edges, no non-manifold vertices. A mesh
  with a crack will fail to import, not import-and-render-wrong.
- **Nonzero thickness.** Infinitely thin surfaces (a single plane, a glass sheet with no thickness)
  are refused. Anything that should read as a thin sheet needs real thickness added before import.

This is the key difference from the other engines and it changes the whole workflow: **geometry
prep happens before import, not after.**

### The pre-import checklist (run on every asset)

1. **Group first.** `thrixel_group_parts` merges everything that does not move into one `Body`
   mesh and keeps named moving parts separate (with `keep_groups`). Do this on Thrixel's servers —
   it is free and correct.
2. **Hit the triangle budget with `thrixel_reduce_triangles`.** It is free and it welds coincident
   vertices before decimating, so UV seams do not crack open (see "Pitfall: decimating by hand").
   Target ≤ 20,000 triangles per resulting mesh. Never re-run the detailer at a lower target to
   lighten something.
3. **Verify watertight + thickness.** After grouping/decimating, load the FBX in Blender and run
   *Select → Select All by Trait → Non-Manifold*; anything selected is a hole. For thin parts,
   add a solidify modifier (or model real thickness) before export. If Blender is not available,
   import into Studio and watch for the importer's "Unable to import" or missing-part warnings —
   but catching it in Blender is cheaper than a round-trip through Studio.
4. **Fix the forward axis** (see rules above).

---

## Material slots — the structure that does not survive

Architect output carries semantic material slots (`Paint`, `Glass`, `Chrome`, `Rubber`, `Rim`,
...). Unity keeps these as **submeshes** on the joined mesh, so each surface stays addressable
per-material. Roblox has **no submesh-level material assignment**: a `MeshPart` takes one
appearance, full stop. `thrixel_group_parts` joins the slots into `Body`, and at that point the
per-slot addressing is baked into the FBX's submesh/material data — which Roblox cannot read.

So the semantic slots must be **split back into separate `MeshPart`s** at import time:

- **Recommended: split by material before import.** In Blender, load the grouped FBX and run
  *Edit Mode → P → By Material* (or *Separate → By Material*). Export. Each resulting mesh becomes
  its own `MeshPart` in Studio, and each gets its own `SurfaceAppearance`. This preserves
  `Paint`/`Glass`/`Chrome`/`Rubber` as separately skinnable surfaces — which is what makes
  independently generated assets look like one set.
- **Fallback: import as one mesh, one appearance.** If a prop is visually simple (e.g. one painted
  body, no glass/chrome worth distinguishing), import `Body` whole and give it a single
  `SurfaceAppearance`. Accept that `Glass` and `Chrome` slots read as painted. Right for small
  props; wrong for hero vehicles where glass and chrome are the point.
- **Never** try to fake per-slot materials with decals on a single mesh — a decal wraps the whole
  surface, not a semantic slot.

### Assigning the PBR maps

A `SurfaceAppearance` (child of the `MeshPart`) holds up to five PBR maps:

| Map | Roblox property | Architect slot it serves |
|---|---|---|
| Albedo / base colour | `ColorMap` | `Paint` |
| Roughness | `RoughnessMap` | `Paint` / `Rubber` |
| Metalness | `MetalnessMap` | `Chrome` / `Rim` |
| Normal | `NormalMap` | everything |
| Emissive | `EmissiveMap` | emissive accents (lamps, screens) |

If Thrixel returns a single texture per slot, assign it as `ColorMap` and set `RoughnessMap` /
`MetalnessMap` to sensible constants via the numeric `Roughness` / `Metalness` properties. If it
returns a PBR set (color/normal/roughness/metalness), map each image to its property. Re-skinning
the slots with authored PBR is what makes separately generated assets read as one consistent set.

---

## Thrixel asset import inspect loop

For EVERY Thrixel asset you import, launch an inspection subagent and give it this exact loop. You
MUST rigorously follow each step; never skip one. Inspect at two points:

1. **When the asset is first imported** (Studio, edit mode):
   - Confirm the forward axis and fix it once if wrong.
   - Place the model and screenshot it from many angles to find floating artefacts, patches of
     inverted triangles, missing parts, and non-manifold seams that slipped past validation.
   - Check that every `MeshPart` that should have a `SurfaceAppearance` actually has one, and that
     glass/chrome read as glass/chrome (not painted grey).
2. **When the asset is in game, in play mode:**
   - Most issues only appear in the running place. Screenshot through the play-mode viewport.
   - Inspect closely for: large floating mesh sections, missing or inverted triangles, assets
     floating off the ground, wrong orientation, materials interacting with lighting incorrectly
     (large flashes, washed-out specular), and parts that should move but are welded to the body.

---

## Verification loop

You MUST run this play-mode verification loop. Create at least one detailed playtest script that
drives the game, run it, and capture at least 5 screenshots throughout. Send each set to a harsh
critic subagent; keep building until it agrees the result looks absolutely AAA quality.

Tell the subagent to be especially critical about:

- The camera is wrong (framing, FOV, clipping into geometry)
- Thrixel assets flickering or large parts missing
- Players/vehicles glitching through the ground or colliding into things
- Visual connectivity issues (seams between `MeshPart`s, floating props)
- LOD / streaming pop-in being visible or jarring
- Meshes that imported grey/purple because the texture did not load
- Character or vehicle orientation (vehicles driving sideways, turrets rotating off-axis)

### Screenshot capture in Studio

Roblox has no first-class headless screenshot API the way three.js has `capture.mjs`. The reliable
options, in order:

1. **Studio built-in:** View → Take Screenshot (writes a PNG). Manual but exact — the viewport you
   are looking at is the image you get. Use it for the review set.
2. **A Studio plugin** that drives the camera and captures the viewport per shot. Write one
   `LocalScript` plugin once per project (it lives in `src/` if you use Rojo, or in a `.rbxl`).
   The plugin positions the camera, waits a frame, and triggers the screenshot. This is the
   Roblox analogue of `tools/capture.mjs`.
3. **`ViewportFrame`** in a `ScreenGui` for composited, deterministic in-game renders. Useful for
   the "most looked at" shots (vehicle viewmodel, held item) that must not clip into the world.

For automation with Rojo, keep the plugin in the project and document the shot list (see
`templates/ARCHITECTURE.md`).

---

## Determinism doctrine

Roblox gives you less control than three.js, but the same four rules apply in spirit:

1. **All randomness through one seeded generator.** `math.randomseed(seed)` once at boot, and draw
   every random number from `math.random` / `Random.new(seed)`. Never reseed mid-run and never use
   unseeded `Random.new()` in gameplay that must be reproducible.
2. **All animation off the engine clock.** Use `RunService.Stepped` / `RunService.Heartbeat`'s
   `dt` (or a fixed-timestep accumulator), never `os.clock()`, `tick()`, or `time()` for gameplay
   animation. `tick()` is fine for logging a duration, nothing else.
3. **Fixed-timestep simulation, interpolated presentation.** Accumulate `dt` and step simulation
   at a fixed `STEP` (e.g. 1/60). Read input edges in the per-frame callback, never inside the
   fixed step.
4. **Capture deterministically.** Drive the camera from the same scripted path each run, so the
   frame at the shutter resolves the same way run to run.

Roblox's physics engine steps independently of your scripts, so bit-identical captures are not
achievable the way they are in three.js. Treat "reproducible to the eye" as the bar, and say so in
the report rather than claiming bit-identical.

---

## Performance doctrine

The things that actually cost you frames in Roblox, in the order they bite:

1. **Part count, not just triangle count.** Every `MeshPart` is a physics/layout object. Hundreds
   of MeshParts per model × a dozen models = thousands of parts, and Studio and the client both
   pay for it. Group aggressively (`thrixel_group_parts`), and split by material slot only where
   the material actually matters.
2. **Triangles over the 20k cap fail the import** — but triangles under it still cost rendering.
   Use `target_triangles` on scattered props (trees, crates) to keep instanced dressing light.
3. **Shadow casting.** Every mesh that casts shadows multiplies the shadow pass. Set
   `CastShadow = false` on small props and foliage; keep it on only for hero geometry.
4. **Material/texture variety.** Each unique `SurfaceAppearance`/texture adds memory and bind
   cost. Share textures across a set via `thrixel_retexture_model` with a shared
   `reference_image_id`.
5. **Streaming.** Enable `StreamingEnabled` for large places so only the geometry near the player
   loads. Incompatible with a few legacy systems; verify nothing depends on the whole `Workspace`
   being loaded.

Measure and report: `p50/p95/p99/max` frame time, part count, triangle count per `MeshPart`,
number of unique textures, and the spread across at least 3 runs. A single run of a gameplay
profiler varies enough to have produced confidently wrong conclusions.

---

## Multiple concurrent game builds — ignore this in 95% of cases

**Skip this entire section unless the user has explicitly said they are running several agents
building different games on one machine at the same time.** The normal case is one agent, one
place, and none of the below applies. Do not restructure a normal build around it, and do not
raise it with the user unprompted.

If they have said so:

- **Different place files / Rojo project roots only.** Two agents editing one `.rbxl` hard-fails:
  Studio's save/autosave will clobber one of you. Use Rojo (one project root per agent, each
  synced to a different place) or separate `.rbxl` files.
- **Screenshots: capture from inside Studio**, never from the OS screen-grab of the frontmost
  window. Two Studio instances on one machine will fight over which one is "frontmost", and you
  will screenshot another agent's game and critique it as your own. This is silent, not an error.
- **The Thrixel concurrency cap is account-wide.** Several agents generating at once spend that
  cap on each other; batch or stagger generation across the agents.
- **FPS numbers are contended.** Several Studio instances with physics running on one machine make
  the ≥30 FPS check meaningless. Measure with the other agents idle.

---

## Budgets

Roblox does not give you a `ctx.config.q` budget object the way the three.js kit does. Establish
the equivalent in one shared `ModuleScript` (e.g. `ReplicatedStorage.Config`) and honour it
everywhere:

- max `MeshPart` per model, max triangles per `MeshPart` (≤ 20,000 hard, lower for props)
- max unique `SurfaceAppearance` textures per place
- max concurrent `Tween`s, max `RunService` bindings, max parts per frame allocated
- a budget that can be silently exceeded is not a budget — return `nil` at capacity and count
  rejections.

When a pass reduces coverage (top-N, sampling, no retry), say so in the report.

---

## When to stop

Stop a review loop when the score plateaus across two rounds — running the same loop again
produces churn, not progress. Change the *measurement* instead: crop closer, add a shot for the
axis nobody is looking at (a close-up of the glass slot, a low-light angle), or replace subjective
critique with a number (part count, triangle count, a profiler run).

Stop the project when the remaining gap is a known root cause you can name, and write it down
instead of hiding it. "The glass slot reads as painted because we imported `Body` whole rather
than splitting by material" is a deliverable; "done, looks great" is not.

---

Read `PITFALLS.md` before importing any mesh or assigning any `SurfaceAppearance` — every entry
cost at least one full iteration round on this path. Read `PROCESS.md` before briefing any agent
or running a review round.
