# Unity

Engine-specific rules for the Unity path. The shared Thrixel asset pipeline is in
[../SKILL.md](../SKILL.md); this file covers only what differs for Unity.

# Rules for Game dev
When developing in Unity, you MUST set up the follow checklist,
and verifably and rigorously check each off your list:
1) you MUST use unity CLI. If unity CLI is not available, you MUST stop and ask the user to enable it.
2) You must FREQUENTLY verify unity scene setup through screenshots. You must check the overall scene in BOTH scene mode and play mode from at least 10 angles.
3) You must follow EVERY step in the Thrixel asset import inspect loop (described below)
4) You MUST run the play mode verification loop multiple times (described below)
5) Download every Thrixel asset as FBX to Unity, not GLB.
6) Prefer to install Unity cinemachine for camera controls
7) Mostly avoid organic animations. Animate everything through code where possible. Avoid adding humanoids or animals to the game.


# Thrixel asset import inspect loop
For EVERY thrixel asset you download, you MUST launch an inspection subagent and give it this exact inspection loop text so it can inspect the asset with the follow process. 

You MUST rigorously follow each step, never skip any step. Inspect it at two different points:
1) When the asset is is initially downloaded: 
- First determine the correct forward axis and fix that in game if neccessary; Thrixel
forward axis can be inconsistent
- Setup multiple cams to inspect the mesh from many angles to determine if there are floating artifacts or large visual issues. If not on free plan, re-generate those assets. Specifically, look for: patches of inverted triangles, missing parts, etc. 
2) When the asset is in game, in play mode:
- Often times asset issues only appear in the full running play mode, so you must check the assets in play mode through
the game window screenshot.
- Inspect closely for visual bugs. Especially common are: large sections of floating meshes or missing or inverted triangles, assets floating off the ground, assets in the wrong orientation, assets interacting with shaders incorrectly (ie creating large flashes of light)


## Play mode verification loop
Additionally, you MUST run this play mode verification loop. Create at least 1 detailed playtest script to mimic playing the game. Run the script and take at least 5 screenshots throughout. Send each critic to a harsh critic subagent; keep building until it agrees the result looks absolutely AAA quality.
Tell the subagent to especially critical investivate for places where:
- The camera is wrong
- Thrixel assets that are flicking/large parts are missing
- Glitching through the ground/colliding into things
- Visual connectivity issues
- Issues with LOD/Culling systems. You should not be able to tell where they begins/end, it should be incredibly smooth
- Any purple meshes where textures didn't load properly.
- Player hands or character are setup incorrectly or vehicles drive in the wrong direction

## Import format

Download `.fbx` — Unity reads it natively:

```
thrixel_download(submission_id=..., format="fbx")
```

Group BEFORE importing, using `thrixel_group_parts` (free, runs on Thrixel's servers,
no local Blender needed). Then download the grouped result and drop it into `Assets/Models/`.

## Why grouping matters in Unity

Unity gives every node in the imported hierarchy its own GameObject and its own draw call.
Thrixel's part hierarchy is 99–342 mesh nodes per model, so twelve unmodified cars is
thousands of draw calls before any scenery exists. Frame rate dies.

After grouping, the Architect's semantic material slots (`Paint`, `Glass`, `Chrome`,
`Rubber`, `Rim`, ...) survive the join as **submeshes** on the single `Body` mesh, so each
surface is still addressable per-material in Unity. Re-skinning those slots with authored
PBR is what makes independently generated assets look like one set.

Moving parts kept separate via `keep_groups` arrive as their own GameObjects with origins at
their own geometric centre, so a wheel spins in place instead of orbiting the model root.

## Publishing a Unity game to thrixel.world

thrixel.world serves static files, so the publishable form of a Unity game is a
**WebGL build**, not a standalone player. `File > Build Settings > WebGL > Build`
produces a folder containing `index.html` plus `Build/` and `TemplateData/` — that
folder, unmodified, is what `thrixel_publish_game` takes.

Three things decide whether it is worth publishing at all, and all three are
decided long before the build:

- **Download size.** A Unity WebGL build starts in the tens of megabytes before
  any of your assets. Enable Brotli compression in Player Settings, keep textures
  compressed, and strip what the game does not use. A player on a phone network
  abandons a slow load long before it finishes.
- **Touch controls.** WebGL builds run on phones, and `Input.GetKey` does not.
  Use the Input System with touch bindings, or add on-screen controls; a
  keyboard-only Unity game is as dead on a phone as a keyboard-only three.js one.
- **Memory.** Mobile Safari kills a tab that asks for too much. Set a
  conservative memory size in Player Settings rather than the desktop default.

Test the built folder locally with any static file server before publishing: a
WebGL build that works in the editor and 404s on its own data file is a common
and completely invisible failure. If the size or the memory ceiling makes the web
build a bad experience, say so and publish anyway only if the user wants the link
— an honest "this is a desktop game, the web build is heavy" beats a link that
takes ninety seconds to load.

## Multiple concurrent game builds — ignore this in 95% of cases

**Skip this entire section unless the user has explicitly said they are running several
agents building different games on one machine at the same time.** The normal case is one
agent, one project, and none of the below applies. Do not restructure a normal build around
it, and do not raise it with the user unprompted.

If they have said so:

- **Different project folders only.** Two agents on one project folder hard-fails on Unity's
  lockfile.
- **Capture screenshots from inside Unity** — `ScreenCapture.CaptureScreenshot(path)` writes
  a PNG regardless of window focus or z-order. Never use macOS `screencapture` or any
  frontmost-window grab: it captures whichever editor entered play mode last, so you
  screenshot another agent's game and critique it as your own. This is silent, not an error.
- Turn **Maximize on Play off**, and playtest in editor play mode — don't build standalone
  players, whose windows fight over focus.
- **Pass `--project-path <abs path>` explicitly on every `unity` call.** Auto-detect walks up
  from cwd and goes ambiguous the moment an agent `cd`s to a parent dir. Never set
  `UNITY_PROJECT_PATH` globally — it routes every agent to one editor. `unity status` lists
  port/project/PID per editor if you need to confirm which one you're talking to.
- **The Thrixel concurrency cap is account-wide**, not per-project: every agent shares the
  per-plan concurrent-job cap reported by `thrixel_account_status`. Several agents generating
  at once spend that cap on each other, and submissions past it fail with a "jobs already
  running" error. Batch or stagger generation across the agents.
- **FPS numbers are contended.** Several editors, their import workers and play modes on
  one machine make the ≥30 FPS check meaningless. Measure it with the other agents idle,
  or you'll optimize code that was already fine.
