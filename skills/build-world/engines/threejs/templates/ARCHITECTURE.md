# <PROJECT> — engine contract

**Every owner must read this before writing code. It is the only coordination
mechanism.** Fill in the bracketed parts and delete this line.

Target: <one sentence naming the genre AND the quality bar, e.g. "a browser <genre>
whose visual and tactile quality stands next to <named reference>">. WebGL2 +
Three.js, <asset policy: e.g. meshes and textures should be generated using Thrixel
according to the guidelines in root SKILL.md. Sounds must be generated procedurally.>.

## Hard rules

1. **You own your directory. Never edit files outside it.** Another owner owns
   every other directory; your edit will be clobbered or will break them.
2. **Never import another subsystem's module.** Get it at runtime:
   `const fx = ctx.get('fx')`. This is what makes isolated work safe.
3. **No new runtime dependencies.** `three` only. No CDN fetches, no external
   images/audio/models except those made with Thrixel. Any assets made with Thrixel
   should be downloaded. The game must run fully offline, self-contained.
4. **No `Math.random()` in gameplay or visuals.** Use `ctx.rng` or a
   `ctx.rng.fork()` you keep. Capture reproducibility depends on it.
5. **No wall-clock time.** Animate off `ctx.time` (`elapsed`, `dt`, `frame`), never
   `performance.now()`, `Date.now()`, or a CSS animation. Instrumentation that only
   logs a duration is fine.
6. **Allocate nothing per frame.** Preallocate in `init()` and reuse. A
   `new THREE.Vector3()` inside `update()` is a bug.
7. **Dispose what you create.** Geometries, materials, textures and render targets
   are freed in `dispose()`.
8. **Respect the budgets in `ctx.config.q`.** Never exceed one; report rejections.
9. `npm run build` must pass, `node tools/smoke.mjs` must pass, and
   `node tools/capture.mjs` must produce a frame after your change. If you break
   the boot, nobody else can work.

## Subsystem interface

```js
export class MySystem {
  static id = 'mysystem';        // unique; how others reach you
  static deps = ['render'];      // ids that must init() before you

  async init(ctx) {}             // build resources; may await
  fixedUpdate(h, ctx) {}         // optional, fixed rate, deterministic simulation
  update(dt, ctx) {}             // optional, once per frame
  lateUpdate(dt, ctx) {}         // optional, after all update()
  resize(w, h, ctx) {}           // optional
  async prewarmMaterials(ctx) {} // optional: compile every material you can produce,
                                 // WITHOUT spawning objects, drawing a gameplay
                                 // frame, or touching the clock/RNG
  dispose() {}                   // optional
}
```

`ctx` provides: `scene`, `camera`, `overlayScene`, `overlayCamera`, `canvas`,
`config`, `events`, `input`, `time`, `rng`, `get(id)`, `peek(id)`, `has(id)`.

- `scene` / `camera` — the world. `overlayScene` / `overlayCamera` — anything
  attached to the viewer that must never clip into world geometry, drawn after the
  world with a cleared depth buffer.
- `time` — `{ elapsed, raw, dt, fixed, alpha, scale, frame }`. Use `alpha` to
  interpolate rendered transforms between fixed steps.
- `config.q` — the active quality preset. Honour every budget in it.

## Ownership map

| id | directory | owns |
|---|---|---|
| `render` | `src/render/` | the WebGLRenderer, all post-processing, shadows, the final composite |
| `<...>` | `src/<...>/` | <...> |

Shared, owned by the lead (do not edit): `src/core/`, `src/main.js`, `src/dev/`,
`tools/`, build config.

## Cross-subsystem events

Emit and listen via `ctx.events`. Payloads are plain objects. The canonical set:

| event | payload | emitted by |
|---|---|---|
| `<domain>:<verb>` | `{ ... }` | `<system>` |

For each event also state, where it could be ambiguous, **who acts on it**. The
reference project lost time to damage being applied twice because both the emitter
and the target's listener applied it.

If you need an event that is not listed, add a row here in the same commit.

## Shared vocabularies

Any string both sides of an event must agree on goes here — surface types, entity
classes, damage types, tile kinds, animation state names. Example:

`concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`, `water`, `foliage`, `fabric`,
`flesh`, `rubber`, `plaster`

## Render integration

What `render` exposes to everyone else, and the rules for using it:

```js
const r = ctx.get('render');
r.renderer            // do not change its state outside a frame
r.screenSize          // { width, height } of the internal target
r.setTimeOfDay(hour)  // if the project has one
r.resetTemporal()     // drop temporal history — used by the capture harness
// r.registerPass(pass) / r.addLight(light) / r.depthTexture / ... as applicable
```

Per-object opt-outs, and the ONE flag that controls each (see PITFALLS C3):

```js
mesh.userData.noShadow  = true  // do not cast into the shadow pass
mesh.userData.noPrepass = true  // keep out of the depth/normal/velocity prepass
```

### Light-count stability

Anything registering distance-culled punctual lights must keep the **visible count
constant** — the count is a shader permutation key. Use `LightPool` (intensity 0,
`visible` stays true) or `LightBallast` (fixed slot budget topped up in
`lateUpdate`). See PITFALLS B2.

## Quality bar

Every visual subsystem is reviewed against <reference>. Non-negotiables:

- Unless a requested art style, **no flat or untextured surfaces.** 
  Albedo variation at more than one frequency, a normal map, roughness variation,
  and a detail layer visible at 0.5 m.
- **No uniform lighting.** Contact shadows, bounce, AO, and a clear key/fill/rim
  separation.
- **Physically plausible values.** Albedo 0.02-0.9, metals are 0 or 1, real-world
  light intensities, exposure-driven rather than multiplier-driven.
- **Every action has weight.** Recoil/impulse, camera shake, an audio transient, and
  a visual FX on every impact.

## Debug hooks (the capture harness depends on these)

Each subsystem exposes a hook the shot list can drive, so any state can be
captured on demand and cleared afterwards:

| system | hook | kinds |
|---|---|---|
| `fx` | `debugBurst(kind, opts)` | `'none'` must fully clear |
| `ai` | `debugStage(kind)` | `'none'` must despawn |
| `ui` | `debugState(mode)` | `'clean'` must reset |
| `<...>` | `<...>` | |

`opts.grabFrame` is how many frames the harness will pump before the shutter — use
it to land a transient's peak on the captured frame. Re-seed your RNG inside the
hook so a staged effect is identical regardless of what ran before it.
