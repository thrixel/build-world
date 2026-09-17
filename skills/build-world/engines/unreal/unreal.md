# Unreal Engine

This directory covers Unreal Engine-specific knowledge for agents building games with Thrixel
assets through Epic's official Unreal MCP (UE 5.8+).

**Start with `setup.md`.** Then read, in this order, the parts you need:

| File | What it covers |
|---|---|
| `setup.md` | Requirements, project bootstrap, editor restart, connecting without a client restart |
| `thrixel-to-unreal.md` | Generating, downloading (FBX!), importing, scaling, orienting and shading Thrixel assets in UE |
| `community-field-notes/headless-autonomy.md` | Running the whole build with zero GUI steps: screenshots, PIE that actually ticks, scripting patterns, saving |
| `community-field-notes/UnrealMCP-toolset-gotchas.md` | Defects and quirks of the 5.8 toolset surface, by toolset - consult when a call misbehaves |
| `community-field-notes/UE-field-guide.md` | Server-agnostic engine gotchas (reflection, crashes, Niagara, Sequencer, materials) |
| `EpicGames-UnrealMCP-skills/` | Epic's own skill docs for the MCP: tool discovery contract, operations, proxy |
| `community-field-notes/performance-and-safe-iteration.md` | Preserve manual edits, profile controlled views, tune quality, validate procedural surfaces |
| `tools/README.md` | MCP client, acknowledged Python console calls, scene audits, FBX texture binding, CSV summaries |

## The main loop

1. **Configure and restart the editor yourself** (`setup.md`). Verify with a read-only call.
2. **Plan the asset list and start Thrixel jobs first**, `wait=false`, in waves. Generation is
   the long pole; build the level while it runs.
3. **Build in-engine/script the terrain, ground cover, water (and similar)**:
   scaled primitives, height-function mesh; procedural/textured surface materials; one
   `InstancedStaticMeshComponent` with a density function for ground scatter (`thrixel-to-unreal.md`).
   Thrixel is for objects: Architect for manufactured things (furniture, fences, buildings),
   Sculptor for organic ones. Give the ground appropriate procedural texture (e.g. grass, dirt, concrete, stone)
   so as to avoid a simple solid-color look, unless that is requested explicitly.
4. **Import each Thrixel asset as FBX into its own folder**, enable Nanite, place it, read its
   bounds, set real-world scale, check facing in a screenshot.
5. For Blueprint projects, **write gameplay in Blueprints via the DSL** (`BlueprintTools.write_graph_dsl`), functions for
   anything reusable, timers instead of Delay when a function needs to wait, keyboard events
   created with `create_node` + `connect_pins`. Details and limits in the gotchas file.
6. **Look constantly**: `EditorAppToolset.CaptureEditorImage` for the editor and for PIE. Start
   PIE in a floating window (`PlayMode_InEditorFloating`) with `startTransform` at the spot you
   want to inspect; the in-viewport mode freezes when nobody is moving the mouse.
7. **Save**: `AssetTools.save_assets` for content, then the level and its World Partition
   actors (see headless-autonomy §8).

## PIE verification loop

Additionally, you must run this PIE verification loop. Create at least 1 detailed playtest script to mimic playing the game.
Run the script and take at least 5 screenshots throughout. Harshly critique them (with a subagent, if you want); keep building
until the critique agrees the result looks absolutely AAA quality.

During critique, especially critically investigate for places where:
- Objects are floating, or glitching through the ground/phasing into things
- The camera faces the wrong way
- Visual connectivity issues
- Vehicles/characters move facing the wrong direction

## Environment design tips

Respect the user's requested game/style and make it to the highest possible AAA-level standards. For most games, some
things they might find pleasant even if not prompted explicitly (previous runs have had these requested as followups):

1. If a scene is open-air, add varied surrounding terrain and background dressing (e.g. buildings, natural features
   in the distance, fog to hide the terrain cutoff) to make the scene look less like it's on an amateurish flat plane
   that cuts off. Don't be too attached to the default blank level you get with the UE templates, be ambitious.
2. If a scene is meant to be small in scope, this does not mean you should make fewer assets; instead,
   pack set dressing and props densely. This shows off assets better and makes the world feel more lived-in.
3. If you can, generate some high-quality, AAA-level concept art for inspiration for what the important
   scenes might look like, and work to match that aesthetic with your scene layout, props, lighting, and background.
   If you can't generate an image, look up multiple images from multiple sources and synthesize them as appropriate
   for the requested style; don't just work off a single image from the internet.

## Thrixel asset import inspect loop

For EVERY Thrixel asset you download, inspect it at two points. You may delegate the inspection
to a subagent, but the checks below must all happen:

1. **When the asset is downloaded** (thumbnail from `thrixel_inspect_model`, bounds):
   - Note the long axis and the head/front. Thrixel forward is unpredictable; UE import maps
     glTF Y-up to Z-up and glTF Z to UE Y (see `thrixel-to-unreal.md`).
   - Look for floating fragments, missing parts, inverted patches, baked-in ground planes. If
     the account is not on the free plan, regenerate or `thrixel_edit_model` rather than carry a
     bad asset forward.
2. **When the asset is in the level**, in Play-In-Editor, from the player's distance:
   - Scale against a door or the player (everything imports at ~1 m).
   - Facing and motion direction.
   - Floating above or sunk into the ground; z-fighting; shader problems (over-bright emissive,
     black translucency, WPO tearing); backface culling on meshes intended to have a double-sided material
   - **Re-run the floating check after every terrain or scatter change**, not just once, and
     check it with the camera. Anything placed from a height *function* can drift from the actual
     mesh; the fix is to sample the mesh exactly (reimplement the same grid/triangle interpolation
     the exporter used) or to trace, and traces have a trap: `SceneTools.trace_world` returns the
     first hit from the top, so a building lifts itself onto its own roof and a fence rises to
     the tree canopy above it. Trace only where nothing can be overhead, or hide the object first,
     or prefer the exact sample. Sink bases a few cm so nothing hovers on slopes. Do it for
     instanced components too (read `perInstanceSMData`, rewrite Z, clear, set), then look from a
     low camera at three or four places before calling it done.

## Import procedure and format

For multipart models, reduce to the intended budget **before grouping** when the ungrouped
source job is available, then group static parts before importing. Inspect counts after each
step. Sculptor output is already one mesh and needs reduction only when its budget calls for it.

Download **FBX**, which the MCP importer reads natively (GLB is refused):

```
thrixel_download(submission_id=..., format="fbx", dest="props/lamp.fbx")
StaticMeshTools.import_file(folder_path="/Game/<Game>/Props/Lamp", asset_name="SM_Lamp", source_file=<abs path>, import_materials=true, import_textures=true, combine_meshes=true)
```

The first FBX request per asset returns a small JSON stub while the conversion runs - retry
until the contents are a real FBX, rather than relying on a megabyte threshold; small valid
models can be under 1 MB (`thrixel-to-unreal.md`, "Download the right format").

## Unreal MCP overview

You interface with the engine through Epic's official Unreal MCP (UE 5.8+). Older editor
versions are not supported by these docs, though `community-field-notes/UE-field-guide.md` is
server-agnostic and still useful with third-party servers.

Tool search is on: the server exposes `list_toolsets`, `describe_toolset`, `call_tool`. Toolset
names are long (`editor_toolset.toolsets.actor.ActorTools`, `EditorToolset.EditorAppToolset`,
`SlateInspectorToolset.SlateInspectorToolset`, ...). Read a toolset's signatures once
(`tools/uemcp.py sig <Toolset>`) and keep them in a file.

Only when you run into suspicious results, especially with the tool interface, apply the
workarounds in `community-field-notes/UnrealMCP-toolset-gotchas.md`.

## User at the editor

The user may be watching the editor either directly on their display, or through Pixel Streaming (headless boxes). 
That changes nothing about how you work: `CaptureEditorImage` shows you the same frame they see. Do not assume
Pixel Streaming exists, and do not require it.

If the user shares a Pixel Streaming player URL, a Playwright session against it is a possible second route
for keyboard/mouse input into the game; the toolset alone cannot inject game input.

### If the box is headless

For headless machines, launch the interactive editor with `-RenderOffscreen` so it can
render without a display. Omit `-Unattended`, including when an agent drives the editor
through MCP or a human uses Pixel Streaming. In UE 5.8.2, that flag can silently cancel
normal Save All requests, leaving edits unsaved. It is appropriate for automated
commandlets and tests whose saving and exit behavior are handled explicitly.

For an editor already running with `-Unattended`, preserve its dirty packages before
restarting; see [Interactive editing and saving](setup.md#interactive-editing-and-saving).

On a headless box, if the user needs to do a GUI action, watch you work, or play the game in the editor,
enable PixelStreaming in the project and launch with the relevant flags:
```
UnrealEditor YOUR_PROJECT_FILE.uproject -RenderOffscreen -EditorPixelStreamingRes=1920x1080 -EditorPixelStreamingStartOnLaunch=true -PixelStreamingURL=ws://127.0.0.1:8888
```
replacing the IP address with an address the user can reach if the viewing is to happen over the internet/a VPN.
The Pixel Streaming player page will be at the same address on port 8080 on Linux and 80 elsewhere.

