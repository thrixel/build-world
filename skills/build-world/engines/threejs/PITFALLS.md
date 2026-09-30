# Pitfalls

Every entry here cost the reference project at least one full iteration round, and
most of them present as a *different* problem than their cause. Format: symptom →
cause → fix. Numbers are measured.

---

## B. Shader programs — the invisible frame-rate killer

### B1. Programs compile during play
**Symptom:** "the game freezes sometimes". 700 ms - 3.9 SECOND frames. Median fps
looks fine.
**Cause:** three compiles a program the first time a permutation is actually drawn.
Measured: 86-146 programs compiled during play, up to 30 on one frame.
**Fix:** `prewarmMaterials()` on every subsystem, run before the first frame
(`lib/prewarm.js`).

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

## D-mobile. Phones

### DM1. The game is keyboard-only
**Symptom:** it plays on a laptop; the published link is dead on a phone.
**Cause:** gameplay reads key codes, so nothing a thumb does reaches it.
**Fix:** read actions (`axis2()`, `held()`), never
key codes, in gameplay code and the touch layer feeds them for free.

### DM2. An uncapped `devicePixelRatio` on a phone
**Symptom:** 12-17 fps on a phone for a scene a laptop runs at 120.
**Cause:** a phone reports DPR 3. `setPixelRatio(devicePixelRatio)` then asks a
phone GPU for ~3.5x the pixels of a 1080p desktop. Resolution, not geometry — the
same lesson as the desktop profiler, one device further along.
**Fix:** `Math.min(devicePixelRatio, ctx.config.q.maxPixelRatio)`, a budget in
every preset. Keep the drawing buffer under about 2.6 MP on a phone.

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

## F. Gameplay correctness no screenshot can show

These are the failures a still frame cannot show. Check each by tracing the code:
follow a real input through to the *relationship* it should produce between two
runtime quantities (press forward, the player moves where the camera faces).

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

**Why it slips through:** checking that the player moved checks the DISTANCE
travelled, never the DIRECTION.

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
