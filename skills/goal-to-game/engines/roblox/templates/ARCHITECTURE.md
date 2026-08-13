# <PROJECT> — place contract (Roblox)

**Every owner must read this before writing code. It is the only coordination mechanism.** Fill in
the bracketed parts and delete this line.

Target: <one sentence naming the genre AND the quality bar, e.g. "a Roblox <genre> whose visual and
tactile quality stands next to <named reference>">. Roblox Studio (Luau), <asset policy: meshes and
textures generated using Thrixel per the guidelines in root SKILL.md; sounds generated
procedurally>.

## Hard rules

1. **You own your Model / directory. Never edit outside it.** Another owner owns every other part
   of the place; your edit will be clobbered or will break them.
2. **Never `require` another subsystem's module directly.** Reach it through the registry:
   `local fx = Ctx:Get("fx")`. This is what makes isolated work safe.
3. **No new dependencies.** Core Roblox services only. No external images/audio/models except those
   made with Thrixel. The place must run fully offline, self-contained.
4. **No unseeded randomness in gameplay or visuals.** Use the seeded RNG from
   `ReplicatedStorage.Config` (a `Random.new(seed)` you keep). Reproduction depends on it.
5. **No wall-clock time.** Animate off `RunService.Stepped` / `RunService.Heartbeat`'s `dt` (or the
   fixed-timestep accumulator), never `os.clock()`, `tick()`, or `time()` for gameplay animation.
   Logging a duration is fine.
6. **Allocate nothing per frame.** Preallocate tables/parts in `Init()` and reuse them. Creating a
   new `Instance` or table inside the per-frame callback is a bug.
7. **Destroy what you create.** Parts, attachments, tweens and bindings you own are cleaned up in
   `Teardown()`.
8. **Respect the budgets in `ReplicatedStorage.Config`.** Never exceed one; report rejections.
9. **The place must load, the play-test script must pass, and a screenshot must capture after your
   change.** If you break boot, nobody else can work.

## Module interface

Every subsystem is a `ModuleScript` under `ReplicatedStorage.<subsystem>/` exporting a table:

```lua
local MySystem = {}
MySystem.id = "mysystem"        -- unique; how others reach you
MySystem.deps = { "render" }    -- ids that must Init() before you

function MySystem.Init(ctx) end            -- build resources
function MySystem.FixedStep(h, ctx) end    -- optional, fixed rate, deterministic simulation
function MySystem.Step(dt, ctx) end        -- optional, once per frame (RunService.Stepped)
function MySystem.LateStep(dt, ctx) end    -- optional, after all Step()
function MySystem.Teardown() end           -- optional; Destroy() what you created

return MySystem
```

`Ctx` provides: `Config` (quality budgets), `Events` (the event bus), `Input`, `Clock`
(`elapsed`, `dt`, `fixed`, `alpha`, `frame`), `Rng`, and `Get(id)` / `Has(id)`.

- `Clock.alpha` interpolates rendered transforms between fixed steps, exactly as in the three.js
  kit.
- `Config.q` is the active quality preset. Honour every budget in it.

## Ownership map

| id | Model / folder | owns |
|---|---|---|
| `render` | `Workspace` lighting + `ReplicatedStorage.render/` | lighting rig, sky, post-FX, the final look |
| `<...>` | `ReplicatedStorage.<...>/` | <...> |

Shared, owned by the lead (do not edit): `ReplicatedStorage.Ctx`, `ReplicatedStorage.Config`,
`StarterPlayer`, `StarterGui`, the screenshot plugin, the play-test script.

## Cross-subsystem events

Emit and listen via `Ctx.Events` (a thin wrapper over `BindableEvent`s). Payloads are plain tables.
The canonical set:

| event | payload | emitted by |
|---|---|---|
| `<domain>:<verb>` | `{ ... }` | `<system>` |

For each event also state, where it could be ambiguous, **who acts on it**. The reference project
lost time to damage being applied twice because both the emitter and the target's listener applied
it.

If you need an event that is not listed, add a row here in the same commit.

## Shared vocabularies

Any string both sides of an event must agree on goes here — surface types, entity classes, damage
types, material-slot names, animation state names. The material-slot names come from Thrixel's
Architect and MUST match the slots you split out at import:

`Paint`, `Glass`, `Chrome`, `Rubber`, `Rim`, `Plastic`, `Fabric`, `Wood`, `Metal`

## Material / appearance integration

What the "materials" owner exposes to everyone else, and the rules for using it:

```lua
local m = Ctx:Get("materials")
m:ApplyAppearance(meshPart, "Glass")   -- assigns the authored SurfaceAppearance for a slot
m:SetAppearanceForSet(model, { Paint = "body", Chrome = "rim" })
-- m:BuildAppearance(slot, baseTexture) / m:RegisterTexture(id, assetId) as applicable
```

Per-object opt-outs, and the ONE flag that controls each (see PITFALLS):

```lua
meshPart.CastShadow = false   -- keep out of the shadow pass (small props, foliage)
meshPart.CanCollide = false   -- decoration that should never block movement
```

### Appearance-count stability

Every unique `SurfaceAppearance`/texture adds memory and bind cost. Share textures across a set via
`thrixel_retexture_model` with a shared `reference_image_id`, and keep the number of unique
appearances in a place below the budget in `Config.q`. See PITFALLS C.

## Quality bar

Every visual subsystem is reviewed against <reference>. Non-negotiables:

- Unless a requested art style, **no flat or untextured surfaces.** Albedo variation at more than
  one frequency, a normal map, roughness variation, and a detail layer visible at close range.
- **No uniform lighting.** Contact shadows, bounce, AO, and a clear key/fill/rim separation.
- **Physically plausible values.** Metals are 0 or 1 metalness, glass reads as glass (not painted
  grey), real-world light intensities, exposure-driven rather than multiplier-driven.
- **Every action has weight.** Recoil/impulse, camera shake, an audio transient, and a visual FX on
  every impact.

## Debug hooks (the screenshot plugin depends on these)

Each subsystem exposes a hook the shot list can drive, so any state can be captured on demand and
cleared afterwards (in Roblox, via a `BindableFunction` or a debug `RemoteEvent` that the screenshot
plugin calls):

| system | hook | kinds |
|---|---|---|
| `fx` | `DebugBurst(kind, opts)` | `"none"` must fully clear |
| `ai` | `DebugStage(kind)` | `"none"` must despawn |
| `ui` | `DebugState(mode)` | `"clean"` must reset |
| `<...>` | `<...>` | |

`opts.grabFrames` is how many frames the harness will pump before the shutter — use it to land a
transient's peak on the captured frame. Re-seed your RNG inside the hook so a staged effect is
identical regardless of what ran before it.
