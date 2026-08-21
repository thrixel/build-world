# Pitfalls

Every entry here cost the reference project at least one full iteration round, and
most of them present as a *different* problem than their cause. Format: symptom →
cause → fix. Numbers are measured.

---

## A. Determinism — why "it looks the same" is unprovable

### A1. The frame index at the shutter drifts run to run
**Symptom:** two identical capture runs differ on 10 of 11 shots. Adding an
expensive boot step "changes the visuals". Nothing in the diff corresponds to any
change you made.
**Cause:** the engine's own rAF loop keeps stepping while the driver does round
trips (waiting for readiness, applying the shot, the screenshot RPC). How many
frames fit inside those round trips is wall-clock dependent, so `time.frame` at the
shutter drifts 10-20 frames. Everything phase-locked to the absolute frame index —
TAA jitter, AO/reflection noise rotation (`frame % 64`), exposure adaptation,
scripted transients — resolves differently.
**Fix:** lockstep capture. The engine schedules no frames; `__PUMP__(n)` advances
exactly n. `lib/shots.js`, and `tools/baseline.mjs` uses it.

### A2. Frame 1's delta depends on the boot path
**Symptom:** a one-frame difference that lives forever in every accumulator.
**Cause:** `_last` is stamped with a real clock by `start()` and again by prewarm,
so frame 1's `dt` is 0 in one path and 1/60 in another.
**Fix:** in capture mode, force `_last` to a synthetic value before every step so
`dt` is exactly 1/60 on every frame *including the first*. `lib/shots.js`.

### A3. Wall-clock animation
**Symptom:** the pixel gate reports 78-88% of pixels changed when you add a 1.4 s
boot step. Mean channel delta up to 3.9 on transient-heavy shots.
**Cause:** subsystems animating off `performance.now()` / `Date.now()` /
`setTimeout` cadence / CSS transitions instead of `ctx.time`.
**Fix:** route every visual or simulation time read through `ctx.time`. Leave pure
instrumentation alone. A/B an expensive boot step to prove you got them all.

### A4. `will-change: transform` on an animated HUD element
**Symptom:** a DOM overlay differs between runs for no reason.
**Cause:** it promotes the element to a composited layer whose raster is taken at a
wall-clock-dependent moment.
**Fix:** don't use it on anything animated.

### A5. A shared page leaks state between shots
**Symptom:** shot 1 is reproducible, shots 2-11 are not.
**Cause:** particle ages, decal ring buffers, animation phase and auto-exposure
carry forward.
**Fix:** one fresh page per shot (`tools/baseline.mjs`). Keep the shared-page tool
(`capture.mjs`) for fast review only, and never diff its output.

### A6. Looping debug state survives into the next shot
**Symptom:** phantom regressions — a burst of gunfire in the HUD shot, decals
behind the UI.
**Cause:** shot N's scripted transient is still running during shot N+1.
**Fix:** `clearState(engine)` before every shot's own `apply()`. Re-seed the RNG in
the debug hook so a staged burst is identical regardless of what ran before it.

### A7. Your own debug overlay defeats your gate
**Symptom:** every shot reports changed; the diff bounding box is a 7x9 px box in
the corner.
**Cause:** the HUD prints the live WebGL program count / fps / timings, and your
change altered that number. (This happened in this kit's own `example/`.)
**Fix:** volatile diagnostics only when `!config.deterministic`. The captured HUD
shows game state, which is deterministic. And read the bbox — it identifies the
culprit in one look.

---

## B. Shader programs — the invisible frame-rate killer

### B1. Programs compile during play
**Symptom:** "the game freezes sometimes". 700 ms - 3.9 SECOND frames. Median fps
looks fine.
**Cause:** three compiles a program the first time a permutation is actually drawn.
Measured: 86-146 programs compiled during play, up to 30 on one frame.
**Fix:** `prewarmMaterials()` on every subsystem, run before the first frame
(`lib/prewarm.js`). Verify with `tools/profile.mjs`: `programs.compiledDuringPlay`
must be 0, and check `--warmup=0` too, since a cold-cache compile lands in exactly
the frames the default view discards.

### B2. The visible point-light count is a permutation key
**Symptom:** +33 to +36 programs and 640-900 ms on a single frame, five times in
900 frames, while just walking down a street.
**Cause:** three bakes the number of *visible* lights of each type into every
material's cache key. Distance culling flips `light.visible`, so every lit material
in the scene recompiles. 17 practicals swept the count 9-8-7-6-5-4.
**Fix:** hold the count constant. Either drive `intensity` to 0 and leave `visible`
true, or park zero-intensity ballast lights and top the count up every
`lateUpdate`. `lib/lights.js`. Exactly pixel-neutral: colour x intensity of 0 adds
a float 0.0 to the irradiance accumulator. Pre-compiling every possible count
instead costs 9.5 s of boot (595 programs for counts 0-16) — the wrong trade.

### B3. Compiling with no render target bound warms the wrong variant
**Symptom:** pre-warm reports 47 programs compiled and the same shaders still
compile during play.
**Cause:** three folds `outputColorSpace` and `toneMapping` into the cache key and
reads BOTH off the *currently bound* target. With the canvas bound you get the
srgb + tone-mapped variant; the world is drawn into an HDR target needing
srgb-linear + NoToneMapping. Measured: 25 of 47 pre-warmed programs were the unused
canvas variant.
**Fix:** bind a 1x1 render target while compiling. Nothing is drawn into it.
`lib/prewarm.js`, `compileMeshes()`.

### B4. `compileAsync(scene, camera)` only reaches the forward lit variant
**Symptom:** the shadow pass, the depth prepass, the post chain and any override
material still compile on the first frame that needs them.
**Fix:** the owning subsystem compiles its own variants in `prewarmMaterials()`.
Compile the REAL meshes (borrow them into a scratch scene without re-parenting):
`renderer.compile` walks `scene.children` for materials and only uses the target
scene for lights/fog/environment, so this is what guarantees the key matches —
down to InstancedMesh-ness and the geometry's attribute set.

### B5. Patching after compiling throws the program away
**Symptom:** 26 of 144 live programs are unpatched duplicates — 18% of the boot
compile budget spent on programs that never draw anything.
**Cause:** `onBeforeCompile` injection plus `material.needsUpdate = true` after
something already pre-compiled it.
**Fix:** patch first, compile second. Warm the renderer's own hook before other
subsystems'.

### B6. Some keys can only be known after the first frame
**Symptom:** warming a subsystem early makes it *worse* — it latches a "warmed"
flag and the real programs compile on first use anyway (12 programs / 142-159 ms on
the frame the trigger is first pulled).
**Cause:** the key depends on the visible light count, settled only inside the
first rendered frame.
**Fix:** that subsystem self-warms on frame 2 and is excluded from the central
pre-warm (`selfWarming` in `lib/prewarm.js`).

### B7. Pre-warm that spawns gameplay objects is not pixel-neutral
**Symptom:** up to 254/255 channel deltas after enabling pre-warm.
**Cause:** decals live in a persistent ring buffer, spawned actors have no despawn
hook, and stepping the engine advances clocks, RNG and exposure.
**Fix:** the contract is *build and compile without spawning, drawing a gameplay
frame, or touching the clock/RNG*. Snapshot and restore camera, clock, RNG and
accumulator anyway. Anything that actually *runs* a pass (rather than compiling)
must be bisected against the gate before you trust it.

---

## C. Three.js API traps

### C1. An InstancedMesh vanishes when its origin leaves the frustum
**Cause:** three culls the whole InstancedMesh against the geometry's bounding
sphere at the mesh's origin.
**Fix:** `frustumCulled = false`, or maintain real instance bounds.
`lib/pool.js InstanceRing`.

### C2. `instanceMatrix.needsUpdate` per instance
**Fix:** write all instances, then set the flag once per frame.

### C3. `castShadow` may not be consulted at all
**Cause:** a shadow pass drawn with `scene.overrideMaterial` never reads
`mesh.castShadow`.
**Fix:** define ONE opt-out flag in the contract (e.g.
`mesh.userData.noShadow`) and have the renderer honour it. Document it, because
other subsystems (LOD, off-screen actors) depend on it.

### C4. Shadow bias is coupled to map size
**Cause:** a bias tuned at 2048 peters/acnes at 4096 or 1024.
**Fix:** scale bias with map size; use `normalBias` for the thin-geometry case.

### C5. Un-snapped shadow frustum fitting makes edges crawl
**Symptom:** reviewers report "flickering shadows" while walking.
**Fix:** snap the shadow camera's centre to shadow-map texel size.

### C6. Metals ignore `specularIntensity`; albedo becomes F0
**Symptom:** a "black" part renders bright; tweaking specular does nothing.
**Cause:** three folds albedo into F0 at `metalness = 1`.
**Fix:** use roughness and albedo. Remember that even a dielectric has F0=0.04, so
a *black* material still renders at a measurable luminance under a strong rig —
measured L=110 against a background of 91 in the reference project's viewmodel.

### C7. GPU resources are never garbage collected
**Symptom:** VRAM climbs over a session; with HMR the page goes black after a few
saves as contexts are lost.
**Fix:** `dispose()` on every geometry/material/texture/render target, and
`import.meta.hot.dispose(() => engine.dispose())`. `lib/dispose.js`.

### C8. Per-frame allocation
**Symptom:** unattributable periodic hitches, growing heap.
**Fix:** module-scope scratch objects, typed-array stores, fixed pools.
`lib/pool.js`. A `new THREE.Vector3()` inside `update()` is a bug.

### C9. A 2-triangle floor cannot receive a light gradient
**Symptom:** flat-looking ground; a point light does nothing to it.
**Fix:** tessellate large receivers, and use boxes (real thickness) for walls so
openings have reveals and light does not leak at edges.

---

## D. Harness and environment

### D1. Copying ANGLE flags between platforms loses the context
**Symptom (measured in this repo):** every `MeshDepthMaterial` fails
`VALIDATE_STATUS`, the WebGL context is lost during boot, and the harness writes a
**pure white 1920x1080 PNG with `ok: true`**. A reviewer then critiques a blank
frame.
**Cause:** `--use-angle=metal` is macOS-only, `--use-angle=d3d11` Windows-only;
forcing a backend the platform cannot honour does not degrade gracefully. The
specific killer here was `--use-angle=gl --use-gl=angle --enable-unsafe-swiftshader`
on Linux.
**Fix:** platform-aware flags, and **check every capture for a blank frame and a
lost context** (`tools/lib/harness.mjs screenshotChecked` / `contextLost`). Print
the GPU string on failure.

### D2. HMR reloads the page mid-capture
**Symptom:** `Execution context was destroyed` — looks like a harness bug.
**Cause:** a file saved by a concurrently-working agent triggers a hot reload.
**Fix:** disable HMR when the harness owns the server (`KIT_NO_HMR=1`).

### D3. `localhost` vs `127.0.0.1`
**Cause:** vite's default `localhost` binds ::1 only on some platforms.
**Fix:** bind 127.0.0.1 explicitly in the vite config and connect to it.

### D4. Attaching to someone else's dev server
**Symptom:** a readiness timeout that looks like a game bug; a screenshot of
another project.
**Fix:** a project-specific port, and a warning when the port was already open.

### D5. Concurrent agents collide on `strictPort`
**Fix:** assign each agent its own port (`5300 + n`) in its brief.

### D6. Readiness by timeout instead of by frame count
**Symptom:** flaky captures; output that changes when boot time changes.
**Fix:** raise `__READY__` after exactly N *frames* (`signalReady`), so the shot is
always applied at the same engine frame no matter how long boot took.

### D7. `down.add(code)` does not create a press edge
**Symptom:** a bot/profiler drives the game and reports zero events, for a game
that works fine by hand.
**Cause:** writing straight into the held set skips the pending→edge promotion, so
anything gated on `pressed()` never fires.
**Fix:** `input.inject(code, isDown)` (`lib/input.js`), which lands where a DOM
event would. Drive the real input layer, not a canned camera path: only then do the
state machines, animation and AI reactions in the recording match the game.

### D8. Screenshot vs canvas readback
Use `page.screenshot()` when any UI is DOM — it composites both. Canvas readback
gets you WebGL only, and `readPixels` on the default framebuffer after presentation
returns nothing useful.

### D9. `--force-device-scale-factor=1` overrides an emulated phone DPR
**Symptom:** a phone-viewport check reports comfortable numbers and a real phone
stutters.
**Cause:** the flag that makes two captures pixel-comparable also beats
playwright's per-context `deviceScaleFactor`, so "a phone at DPR 3" measures as a
phone-shaped desktop at DPR 1 — the half of the problem that was never hard.
**Fix:** `launchBrowser({ pinDeviceScale: false })` for that tool only, and keep
the pin everywhere the pixel gate runs. Also pass `hasTouch: true`, or the context
dispatches no touch pointers, `(pointer: coarse)` is false, and a game with a
perfectly good touch layer measures as unplayable.

---

## D-mobile. Phones

### DM1. The game is keyboard-only and every other gate passes
**Symptom:** builds, captures, contact sheets and `smoke.mjs` are all green; the
published link is dead on a phone.
**Cause:** every tool in this kit drives the game with key codes. Nothing in the
desktop loop ever asks whether a thumb could play it.
**Fix:** `tools/mobilecheck.mjs`, whose central assertion is that a real swipe on
the left of the screen moves the player. Read actions (`axis2()`, `held()`), never
key codes, in gameplay code and the touch layer feeds them for free.

### DM2. An uncapped `devicePixelRatio` on a phone
**Symptom:** 12-17 fps on a phone for a scene a laptop runs at 120.
**Cause:** a phone reports DPR 3. `setPixelRatio(devicePixelRatio)` then asks a
phone GPU for ~3.5x the pixels of a 1080p desktop. Resolution, not geometry — the
same lesson as the desktop profiler, one device further along.
**Fix:** `Math.min(devicePixelRatio, ctx.config.q.maxPixelRatio)`, a budget in
every preset. `mobilecheck.mjs` fails on a drawing buffer over 2.6 MP.

### DM3. Touch works, and nobody can find it
**Symptom:** the input layer is correct, testers report "it does nothing".
**Cause:** no on-screen controls. A player who sees a 3D scene and no buttons taps
once and leaves; they do not discover that the left half is a stick.
**Fix:** `TouchControls` (`lib/touchui.js`). It stays hidden until
`input.touchActive`, so it costs the pixel gate nothing — verified: adding the
whole touch layer left all seven baseline shots `identical: true`.

### DM4. Pull-to-refresh eats the game, and `100vh` hides its bottom
**Symptom:** dragging down reloads the page mid-play; the HUD's bottom row sits
under the iOS URL bar; a look-drag stops responding after ~100ms.
**Cause:** three separate browser defaults — `overscroll-behavior` allowing the
refresh gesture, `100vh` on iOS meaning the height *without* browser chrome, and
the browser claiming an un-declared gesture as a scroll so `pointermove` simply
stops arriving.
**Fix:** `overscroll-behavior: none`, `height: 100dvh`, `touch-action: none` on
the canvas (`Input` sets it programmatically too, since a project's own CSS may
not). All three are in `example/index.html` with comments.

### DM5. An invisible on-screen button still swallows clicks
**Symptom:** a dead zone in the bottom-right corner on desktop.
**Cause:** hiding a control layer with `opacity: 0` leaves it in hit-testing.
**Fix:** `visibility: hidden` (or `pointer-events: none`) on the layer, not just
opacity.

---

## E. Review process

### E1. A median frame time hides the actual problem
A static-camera benchmark said 94 fps while the game was unplayable: real gameplay
at Retina DPR (3.34 MP internal, not 2.07) ran 12-17 fps with 728-1236 ms stalls.
**Fix:** profile real gameplay at real DPR, report p50/p95/p99/max, list every
hitch with its per-frame program/geometry/texture delta, and run it 3+ times.

### E2. Critics report the symptom, not the cause
Every critic for three rounds said the weapon was "untextured". It was
specular-dominated: diffuse measured L=26 against a shipped L=67. Rounds of
albedo-crushing (to fight "too bright") had caused it. The fix was the opposite of
the brief.
**Fix:** measure the frame (`tools/pixelstats.mjs`, `tools/crop.mjs`) before acting
on a critique, and brief agents to contradict the brief when the numbers say so.

### E3. A review shot pointed at nothing
The impact shot was aimed down an open street for three rounds, so the burst it
existed to show was staged 20+ m away and never legible. Every critique of that
shot was about something else.
**Fix:** aim each shot at deliberately placed geometry and state what it is for.

### E4. Reviewing at 1:1 hides close-range defects
**Fix:** `tools/crop.mjs <shot> <out> 0.3 0.35 0.25 0.3 --scale=3`. Texel density,
normal detail and blocky silhouettes only show up magnified. `edge` in the tool's
output quantifies "is this surface actually flat".

### E5. Parallel visual agents fight each other
See threejs.md — 3x6 parallel agents moved the score +0.46 and made frame-ruining
defects *worse* (60 → 66); one sequential pass moved it +1.00 and cut them to 26.
**Fix:** one owner per coupled concern, sequentially.

### E6. Silent scope reduction
A pass that samples, takes top-N, or skips retries and does not say so reads as
full coverage.
**Fix:** log what was dropped.

---

## F. Gameplay correctness no screenshot can show

These are the failures that pass a clean build, a full shot set and a smoke test.
Each needs a **bench**: drive the real input layer, then assert on a *relationship*
between two runtime quantities. `example/feeltest.mjs` is the worked example.

### F1. The movement basis is rotated the wrong way
**Symptom:** WASD "seems to move in absolute compass directions and ignore where
you are looking". At some headings it feels right, at others inverted.
**Cause (measured in this kit's own `example/`):** the intent vector was rotated by
`R_y(-yaw)` instead of `R_y(+yaw)` — a hand-rolled 2x2 with two sign errors:

```js
// WRONG — this is R_y(-yaw)
const wx = tx * cos - tz * sin;
const wz = tx * sin + tz * cos;
```

The signature is unmistakable once you measure it: `dot(displacement, cameraForward)`
was 1.000 at yaw 0 and yaw pi, -1.000 at +-pi/2, and `cos(2 * yaw)` everywhere else.
A mirrored basis is *correct at two headings*, which is exactly why it survives
manual spot-checks.

**Why every other gate passed:** the build was clean; all shots captured (a
still frame has no controls); and the smoke test reported "movement 4.40 m holding
KeyW" because it checked the DISTANCE travelled, never the DIRECTION.

**Fix:** state the convention once, then derive from it and never hand-roll:

```js
// A camera looks down its local -Z; yaw rotates about +Y. So in world space
//   forward = (-sin yaw, 0, -cos yaw)     right = (cos yaw, 0, -sin yaw)
// and to face a point:  yaw = atan2(x - px, z - pz)
target.set(ax.x, 0, -ax.y).applyAxisAngle(UP, this.yaw);   // cannot get the sign wrong
```

Verify against the **live camera matrix**, not against a recomputation of the same
formula — otherwise the test agrees with the bug. Columns of `camera.matrixWorld`
give you right (`m[0..2]`) and forward (`-m[8..10]`).

### F2. A same-frame release + press is swallowed
**Symptom:** a bot/bench that releases the previous case's keys and presses the
next case's in one frame measures zero movement; by hand the game is fine.
**Cause:** input queued as two SETS (pendingDown, pendingUp) forces you to pick an
order. Downs-first is required for a fast TAP (down+up in one frame must give a
press *and* a release, not a stuck key), but it makes a RE-PRESS resolve as
released.
**Fix:** queue `{ code, down }` events **in order** and replay them in
`beginFrame()`. `lib/input.js`. Both cases then resolve correctly.

### F3. Measuring a value the simulation has not synced yet
**Symptom:** displacements measured from the wrong origin; a bench that reports
garbage for the first case and plausible-but-wrong numbers afterwards.
**Cause:** writing `player.pos`/`player.yaw` does not move the camera — the mover
syncs it inside `fixedUpdate`. Reading `camera.position` straight after the write
gives the *previous* pose.
**Fix:** pump one frame after placing, before reading the start state; and treat the
simulation's own state as the authority, with the camera as downstream of it.

### F4. A bench run that hits geometry looks like a logic bug
**Symptom:** one direction reports a low speed and a deflected heading — reads
exactly like a broken controller.
**Cause:** the test ran into a wall.
**Fix:** start each run where it fits, and assert the expected *speed* alongside the
direction so a blocked run reports as unmeasured rather than as wrong.
