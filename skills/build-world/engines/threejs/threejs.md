# three.js

Engine rules for the three.js path. The Thrixel asset pipeline is in
[../../SKILL.md](../../SKILL.md); this file covers the game itself.

In this build the game is plain HTML and ES modules loading three.js from a CDN through an
import map, with no build step. You cannot run it, so the discipline below is about writing
code that is right the first time and saying honestly what you checked.

## The rules

1. **Write the contract before the code.** Start from `templates/ARCHITECTURE.md`: name every
   subsystem, what it owns, its interface and its events. Systems reach each other through
   `ctx.get(id)` at runtime and never import each other.
2. **Determinism is a feature.** Fixed timestep, seeded RNG (`lib/rng.js`), animation driven by
   the engine clock only. It makes behaviour reproducible, which is what makes a bug fixable.
3. **Read your own code as the player would play it.** Walk each control from the input
   snapshot to what moves on screen. Check every model path you load is in `assets`. A game
   that throws on its first frame is a black screen, and nothing will tell you but reading.
4. **Report honestly, including the gap.** "The water is flat colour, not reflective" is useful.
   "Done, looks great" about a game you could not run is not.

## What the kit gives you

`lib/` is plain browser modules (import from `lib/index.js`). Copy the ones you use into `files`.

| file | what it is for |
|---|---|
| `engine.js` | frame loop, fixed timestep, `ctx`, boot-with-visible-failure |
| `registry.js` | topo-sorted subsystems, `ctx.get(id)`, event bus |
| `rng.js` | seeded xoshiro128** + `fork()`, value noise, fbm |
| `config.js` | quality presets as budgets, URL-driven config, `autoQuality()` by device |
| `input.js` | per-frame input snapshot, keyboard + mouse + **touch** |
| `touchui.js` | on-screen stick and action buttons, hidden until a real finger arrives |
| `prewarm.js` | shader pre-warm, so programs do not compile mid-game |
| `lights.js` | `LightBallast` / `LightPool`: hold the light count constant |
| `pool.js` | `scratch()`, `Pool`, `InstanceRing`, `ParticleStore`: no per-frame allocation |
| `dispose.js` | `disposeTree`, `Owned`: GPU resources are not garbage collected |

`example/` is a small working game built on all of it; `example/index.html` has the mobile
viewport setup with the reasons in comments.

## Performance

The three things that actually cost frames in three.js, in the order they bite:

1. **Shader compilation during play.** Dozens of programs compiling mid-game cause stalls of
   seconds. Call `prewarmMaterials()` for every subsystem, and hold the visible light count
   constant (`lib/lights.js`).
2. **Draw calls and shadow casters.** Instance repeated meshes, merge static geometry, and run
   `thrixel_group_parts` on every Thrixel model so it arrives as a few meshes, not hundreds.
3. **Resolution.** A phone reports `devicePixelRatio` 3. Cap it:
   `renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxPixelRatio) * q.renderScale)`.

## Mobile: the device most players will use

A finished game becomes a link, and a link gets opened on a phone. Phone playability is part of
"done".

`lib/input.js` feeds touch into the same per-frame snapshot as the keyboard: the left of the
screen is a floating stick (`axis2()`), the right a look-drag (`look`), and
`input.bindButton(el, 'jump')` routes an on-screen button to `held('jump')`. If gameplay reads
actions rather than key codes, it needs no touch branch.

What you still have to do:

1. **Cap the pixel ratio** (above).
2. **Start phones on a lower preset.** `autoQuality()` returns `low` for a coarse pointer.
3. **Show the controls.** Use `TouchControls` (`lib/touchui.js`). Touch input with no visible
   controls is the most common mobile failure: the player taps once and leaves.
4. **Size the HUD for a thumb.** 44 CSS px is the floor for anything pressable.
5. **Get the viewport right.** `viewport-fit=cover`, `100dvh` (not `100vh`), `touch-action: none`
   on the canvas, `overscroll-behavior: none` on the body, and `env(safe-area-inset-*)` padding.
6. **One thumb per side.** A control needing a modifier key or four keys at once has no touch
   equivalent. Decide this while designing the controls.

## Budgets

Put every budget in `ctx.config.q` and honour it. `lib/pool.js` returns `null` at capacity rather
than growing. When you cut scope (fewer enemies, simpler effects), say so.

## Genre adaptation

The kit is genre-generic.

| genre | what players look at most | the busiest moment to design for |
|---|---|---|
| FPS / TPS | the held weapon, aiming | a firefight |
| Racing | chase camera at speed | a full grid |
| Platformer | the character at the top of a jump and landing | many actors and effects |
| RTS / city | the overview and the closest zoom | the most units |
| Puzzle / board | the board at rest and mid-animation | the worst-case board |
| Horror / adventure | a room lit from one source | a scripted set piece |

The overlay scene (`ctx.overlayScene`) is for anything attached to the viewer that must never
clip into the world: a held weapon or tool, a cockpit.

Read `PITFALLS.md` before writing renderer, effects or input code.
