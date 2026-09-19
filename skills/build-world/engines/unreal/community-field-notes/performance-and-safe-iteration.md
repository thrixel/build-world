# Performance and safe iteration in Unreal 5.8.2

Use these notes when improving an existing project, especially after someone has edited the
level manually. These are tested workflow patterns and version-specific observations, not
mandatory rendering settings or a level-design recipe.

## Preserve authored work

Save and back up the current map, content, config and source before a bulk pass. Check dirty
map **and** content packages. An old generation script may be repeatable while still erasing
new manual edits: review what it destroys/recreates before running it. Scope additive scripts
to explicitly owned actors/assets; rerunning them still overwrites manual edits to that scope.

`tools/ue_scene_audit.py` records the loaded editor world without changing it. It includes actor
and mesh-component transforms, material overrides, mesh bounds, instance counts, light shadows
and dirty packages. Optional instance hashes detect placement changes inside an ISM component.
Run outside PIE and keep separate before/after files:

```python
import sys
sys.path.insert(0, '/absolute/path/to/tools')
from ue_scene_audit import audit
audit('/absolute/path/before.json', instance_hashes=True)
```

After the change, save/reopen and capture `after.json`, then outside Unreal:

```sh
python3 tools/ue_compare_audits.py before.json after.json
```

The comparator reports additions and mesh swaps separately; removal or movement of existing
actors, component placement/count changes, and changed material overrides fail the preservation
check. It does not prove gameplay properties are unchanged. Instance hashes are exact; actor
and component transforms use a configurable absolute tolerance.

For mesh-only optimization, keep the original asset and import a replacement into a new folder.
Preserve component overrides when swapping meshes. Compare bounds and pivot origins: equal
actor transforms do not guarantee equal visible placement if the replacement pivot changed.
Check shape, material slots, collision and resting height from the normal player distance.

## Profile a controlled view

Record engine/build, hardware, viewport dimensions, camera, quality settings and warmup interval.
Use the actual game viewport size, not a screenshot's outer dimensions. Background builds,
shader compilation, CPU throttling, VSync and frame caps can confound a short capture.

CSV Profiler commands are case-sensitive on the tested build:

```text
csvprofile STARTFILE=Before
csvprofile FRAMES=1200
```

`STARTFILE` selects a filename; it does **not** start recording by itself. `FRAMES=N` starts a
bounded capture. `csvprofile START` / `csvprofile STOP` provide manual control. Files are under
the project's `Saved/Profiling/CSV`. Keep immutable baseline copies; an inspection callback
that replays a stale request after restart can overwrite a capture with the same name.

```sh
python3 tools/ue_csv_summary.py Before.csv After.csv --start 300 --stop 1100 --output timing.json
```

The helper ignores metadata/footer rows and reports mean, median, nearest-rank p95, min and max.
Default columns are `FrameTime`, `GPUTime`, `GameThreadTime`; inspect the CSV header and supply
`--columns` when names differ. Frame slice indices are zero-based and stop-exclusive.

Report CPU and GPU separately. A capped frame time may remain unchanged while GPU work falls.
Pixel Streaming's decoded FPS measures the video pipeline, not uncapped game performance.
One view on one GPU is not a minimum-hardware benchmark. Restore intentional frame caps after
testing. A successful cook also does not establish a successful standalone playthrough.

## Quality presets that remain usable

Use `UGameUserSettings` to apply scene resolution and scalability groups, with a clear low
preset and an in-game way back. Keep HUD/layout independent of 3D resolution. Save the preset
choice separately from gameplay saves and verify it after a fresh launch. Apply changes only
when the selected value changes; avoid writing settings every frame while dragging a slider.

Test a sequence such as high → low → middle, then an interior and an exterior. Check both
visual output and the effective CVars. Loading a preset from disk alone does not verify a UI.

**Version-specific observation:** stock Effects scalability in UE 5.8.2 changes
`r.SceneColorFormat` and material quality permutations, among other settings. On the tested
Linux/Vulkan setup, switching the full groups produced transient over-bright artifacts.
Keeping the Effects group stable while varying resolution, shadows, GI/reflections and other
measured settings avoided them in the tested sequence. This is a workaround, not a diagnosed
engine defect or a universal requirement to use High effects. Consult the installed
`Engine/Config/BaseScalability.ini` and reproduce on the target renderer before broad changes.

Lumen disabled by a lower GI group changes ambient/interior lighting; inspect that explicitly.
Do not lower texture quality so far that readable props or UI art become illegible merely to
make every group share one numeric level. Test the packaged build as well as PIE when feasible.

## Choose optimizations by repetition and screen size

- Prioritize repeated small props and distant vegetation before recognizable hero silhouettes.
  Inspect source counts, reduce in Thrixel, inspect again, then import into a separate folder.
  For multipart sources, **reduce before grouping** when the ungrouped job is available.
  If reduction fails or returns unchanged counts, check the original job instead of assuming
  success; keep submitted jobs recorded and do not resubmit merely because processing is slow.
- Instancing reduces repeated component/draw overhead, but many material slots still cost
  work. Grouping parts preserves slots. Measure the result rather than equating one mesh with
  one draw call.
- Nanite LOD0/render-data counts exposed by `get_num_triangles(0)` can describe fallback data.
  They are useful for an asset audit, not the triangles actually drawn in a frame. Keep source
  geometry counts and profiler measurements distinct.
- Cull small, low-importance props by distance. Limit unnecessary tiny-light and grass shadows
  while retaining the lights/shadows that make rooms readable. Use two-sided materials where
  back faces are visible, rather than enabling them on every closed opaque surface.
- When ticking distant actors less frequently, integrate movement and timers with elapsed
  time. Check transitions near the distance threshold and interactions with nearby actors.

### "[VSM] Non-Nanite Marking Job Queue overflow"

The on-screen warning (also `LogRenderer: Warning: [VSM] Non-Nanite Marking Job Queue overflow`
in the log) means non-Nanite shadow casters are touching too many Virtual Shadow Map pages.
Audit instead of guessing. In editor Python, walk every `StaticMeshComponent` and record
`static_mesh.nanite_settings.enabled`, `cast_shadow`, instance count and actor bounds; list the
entries that are non-Nanite **and** casting. In the tested level that left three kinds of mesh,
and the offender was the template's `SM_SkySphere`: shadow casting on, with bounds that cover
every page of every clipmap level. Set `castShadow` and `bCastDynamicShadow` false on sky domes,
water planes and glass. Non-Nanite grass that already has shadow casting off does not
contribute. The warning is intermittent (it tends to fire on frames that invalidate the shadow
cache), so compare log counts across a long PIE run before and after the change.

## Static procedural surfaces

For a mostly static ground pattern, baking tileable noise to a small texture and sampling it at
multiple world-space scales can be cheaper than evaluating shader Noise nodes. Keep the color
range restrained and inspect close ground, distant repetition, seams and shadowed areas.
World-space mapping is useful for differently scaled meshes; it does not require dense UVs.

Still provide explicit UV records/indices in generated OBJ files. The UE 5.8.2 Interchange OBJ
translator emitted `UVs.IsValidIndex(VertexData.UVIndex)` ensures for a UV-less reimport on the
tested path. Validate triangle winding independently for strips and grids; a downward path can
be correctly placed yet invisible. Reimport changed source geometry: an asset-exists check
must not silently keep an old terrain mesh.

Height-function values and a triangulated surface differ between vertices. Follow the mesh's
actual triangle interpolation, or trace only the intended surface, then check visually. Nanite
simplification can introduce further small differences; thin overlays need enough separation
to avoid clipping/flicker without looking suspended. Wider props on slopes may need grading
or foundations, not just a correct center height.

## Reliable inspection and scripting

`tools/ue_console.sh` targets the editor Cmd box and presses Escape: **do not use it to send
commands during PIE**. For PIE profiling, use a temporary editor-only callback that targets the
game world and calls `SystemLibrary.execute_console_command`, or another verified game-console
route. Give requests unique IDs, initialize without replaying stale commands, and unregister
the callback after testing. Keep inspection hooks out of packaged gameplay and user saves.

The console wrapper confirms Python completion/error with unique log markers. A Python error
returns failure without replaying partial mutations. A lost connection or missing acknowledgement
still requires inspecting the log/state before a manual retry. For ordinary console commands,
a logged dispatch confirms submission, not semantic success. Prefer a short `py exec(open(...).read())`
call over a long command, and pass the running editor's log explicitly.

Editor Python often exposes editable fields only through `set_editor_property`, even when a
similarly named direct attribute is absent. Examples include ComponentMask `r/g/b/a`, Multiply
`const_b`, and LinearInterpolate `const_alpha`. TextureSample's input pin is `UVs`, not
`Coordinates`; single unnamed inputs usually take `''`. Assert connection results before
building the rest of a material. `__file__` is not defined by `exec(open(...).read())`; pass a
tools/source directory explicitly or use the project directory instead.

For clean screenshots, a warmed-up PIE `HighResShot` captures the game viewport/HUD. For editor
inspection, UE 5.8.2 `CaptureViewport` worked with an explicit transform and `annotations:null`;
verify the image and returned camera because older builds had a stale-view defect. A full
`CaptureEditorImage` may include several windows and be resized, so it is not a trustworthy
source of game viewport dimensions.

When driving Pixel Streaming input, account for the video element's displayed rectangle,
source video resolution, letterboxing, window chrome and actual game viewport. Wait for and
assert the resulting game state; tool submission and one immediately sampled response can
precede delivery of the input event. A connected stream with zero video frames is inconclusive.


## Grounded characters and world maps that track authored geometry

For multipart procedural characters, the actor origin or torso bounds may not coincide with
the soles. Ground the complete visible body, including animated legs, at spawn and after
movement/pose updates. Restrict support queries to intended floor/path surfaces; unrestricted
traces can place people on furniture, roofs or each other. Check idle and walking poses,
interiors and surface transitions, and verify contact visually as well as numerically.

In-game world maps built from independent pixel coordinates can drift from the level. Mark the
actual footprint actors with runtime tags or explicit references, then project their geometry
and the player through one world-to-map transform. Preserve aspect ratio, rotation and north
orientation; use a numbered key when labels do not fit. Editor actor labels alone are unsuitable
as runtime identifiers in Shipping builds. A floor footprint only tracks edits to that floor:
keep a building's floor and shell together when moving the whole building.

Concurrent editor and commandlet launches can assign the editor a suffixed log such as
`Project_2.log`. Verify the active editor's actual log before console scripting. An inactive
log can hide a successful dispatch and provoke retries. A dedicated editor stdout/log file
also avoids this ambiguity. Finish acknowledgement-dependent calls before starting PIE: an
unfinished console helper may press Escape and stop the new play session.


In native Canvas drawing, `FCanvasTriangleItem` requires a valid texture for its textured draw
path even when vertices use solid colors. UE 5.8.2 asserts on a null texture. The higher-level
`UCanvas::K2_DrawTriangle(nullptr, Triangles)` supplies the engine's default white texture;
set each vertex color explicitly. Verify the panel by opening it in play, since compilation
cannot catch this render-time requirement.
