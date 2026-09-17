# Driving Unreal 5.8 headlessly and autonomously through the official MCP

Field notes from building a complete small game (a first-person fishkeeping scene) with zero
GUI steps, on a headless Linux box where the human watched through Pixel Streaming.
Use `-RenderOffscreen` for this interactive editor and omit `-Unattended`. The original
session used both flags, but a later UE 5.8.2 check found that `-Unattended` silently cancels
normal Save All requests. Reserve it for automated commandlets/tests. See
[the save recovery procedure](../setup.md#interactive-editing-and-saving). Entries are ordered
by how early in a session you meet them.

The companion client used throughout is `tools/uemcp.py` (see the "MCP without a client
restart" section). Snippets below use it as `uemcp.py call <Toolset> <tool> '<json>'`.

---

## 1. Configuring the project without a human

1. Edit the `.uproject` `Plugins` array yourself (`ModelContextProtocol`, `AllToolsets`, plus
   whatever the game needs - e.g. `Water`). Also enable them with `"Enabled": true`; the
   `PluginToolset.SetPluginEnabled` tool does not persist.
2. Put the MCP section (`bAutoStartServer=True`, port, path) in the project's
   `Config/DefaultEditorPerProjectUserSettings.ini` - not the `Saved/Config/...` per-user file,
   which the editor rewrites on exit and which lost our appended sections - and write
   `.mcp.json` next to the `.uproject`.
3. Before restarting, inspect dirty map and content packages and preserve user edits.
   Missing `LogEditorTransaction` / `LogFileHelpers` lines do not establish that nothing is
   unsaved. Follow [the save recovery procedure](../setup.md#interactive-editing-and-saving)
   if the current editor has `-Unattended`, and verify persistence before stopping it.
   Read `/proc/<pid>/cmdline` to retain the user's relevant launch flags, but remove
   `-Unattended` from an interactive editor's replacement command line. Stop the old process
   only after saving, wait for exit, then relaunch.

   Pass `-ModelContextProtocolStartServer` on the relaunch as well as the `.ini` setting.
   The server is up when the log says `Starting MCP server on port 8000` and
   `ss -ltnp | grep :8000` shows the editor listening. Boot takes 1-2 minutes.

## 2. MCP without a client restart

Claude Code (and most hosts) read `.mcp.json` at startup. If you enabled the server mid-session
the `unreal-mcp` tools will not be in your tool list until the host restarts, and restarting
throws away your context. Do not wait for that: the server speaks plain Streamable HTTP, so a
40-line stdlib client is enough. `tools/uemcp.py` does exactly that:

```sh
uemcp.py toolsets                                  # list_toolsets
uemcp.py sig editor_toolset.toolsets.actor.ActorTools   # one line per tool: name(arg:type) + doc
uemcp.py call EditorToolset.EditorAppToolset CaptureEditorImage '{}'   # images land in /tmp/uemcp_1.png
uemcp.py call <Toolset> <tool> @args.json          # big/quoted payloads from a file
```

Two details that matter: send `Accept: application/json, text/event-stream`, and echo the
`Mcp-Session-Id` header. `sig` exists because `describe_toolset` returns full JSON schemas
that run to hundreds of lines per toolset; dump every toolset's signatures once into a file and
grep it instead of re-describing.

Even with a live client, running MCP calls from a shell has two advantages: you can chain
dozens of calls in one command (they still execute serially), and you can pipe results into
Python for filtering.

## 3. Seeing the editor and the game

- **`EditorAppToolset.CaptureEditorImage` works headlessly** and returns the editor exactly as the
  Pixel Streaming viewer sees it (all panels included). Use it as your eyes; move the level
  camera first with `SetCameraTransform`. Read the PNG the client wrote.
- Earlier 5.8.0 testing found a stale `CaptureViewport` view. On 5.8.2, an explicit
  `captureTransform` plus `annotations:null` and `bShowUI:false` worked. Verify the returned
  camera and image; use `CaptureEditorImage` if the installed version still misbehaves.
- During Play-In-Editor the same capture shows the game viewport, so PIE screenshots need no
  Pixel Streaming client at all.
- The user may rearrange panels at any time (they did: one viewport became four). Re-take a
  screenshot before assuming where anything is on screen.

## 4. The editor goes idle without input - and the PIE world stops

This one cost the most time. With nobody moving the mouse, a headless editor with no realtime
viewport stops redrawing **and stops ticking the Play-In-Editor world after a handful of
frames**. The engine frame counter keeps advancing, `IsPIERunning` says true, and two
`CaptureEditorImage` calls five seconds apart are byte-identical. Consequences:

- `Delay`, `SetTimerByFunctionName`, `EventTick` in your Blueprints never fire.
- Movement components appear to work only because the human moved the mouse while watching.
- `bThrottleCPUWhenNotForeground=False` alone does NOT fix it.

What fixes it:

1. **Preferred for automated tests: start PIE in a floating window** -
   `StartPIE` with `playMode: "PlayMode_InEditorFloating"`. That window always ticks, and
   `CaptureEditorImage` still captures it (it is drawn on top of the editor).
2. Turn the level viewport's **Realtime** toggle on (the checkbox at the right end of the
   viewport toolbar). Clicking it through `SlateInspectorToolset.Click` works, but see §7 -
   the toolbar checkboxes are unlabeled and mirrored across panes, so only do this from a
   snapshot you have just read, one control at a time.
3. Persist for the next launch: `[/Script/UnrealEd.EditorPerformanceSettings]`
   `bDisableRealtimeViewportsInRemoteSessions=False` in `EditorPerProjectUserSettings.ini`
   (Pixel Streaming counts as a remote session, which is why viewports start non-realtime).

Detect the frozen state cheaply: place a test actor whose Tick moves it, capture twice a few
seconds apart, `cmp` the two PNGs.

## 5. Starting PIE

- `StartPIE` needs the full `options` block. **`startTransform` is not optional and not ignored**:
  the pawn spawns exactly there, so `(0,0,0)` puts it inside your floor and the spawn fails
  (`LogSpawn: Warning: SpawnActor failed because of collision`) - you then look at the world from
  the origin, underground. Pass the PlayerStart location (or wherever you want to test from).
  This is also how you "walk" the player to a spot for a screenshot: restart PIE with a
  different `startTransform`.
- Keyboard input cannot be injected into the game from the toolset (`SlateInspector.PressKey`
  goes to the focused Slate widget, not the game). To exercise input-driven logic
  autonomously, add a temporary hook (`BeginPlay -> Delay -> the function the key calls`)
  with a `PrintString ... :bPrintToLog true` marker, run PIE, grep the log for the marker, then
  rebuild the graph without the hook. Leave the actual key binding to the human to enjoy.
- Verify game logic from the **log file on disk**, not `LogsToolset.GetLogEntries`: that tool
  returns the *oldest* matches up to `maxEntries`, so new lines are invisible once a pattern
  has matched before. `grep -a LogBlueprintUserMessages <Project>/Saved/Logs/<Project>.log | tail`
  is reliable and instant.

## 6. Building a whole level from scripts

`ProgrammaticToolset.execute_tool_script` is the workhorse: one call, dozens of tool
invocations, returns a dict. A small library pattern that paid off:

```python
def T(n,a): return execute_tool(n, json.dumps(a))
def setp(o,v): return T("editor_toolset.toolsets.object.ObjectTools.set_properties",{"instance":{"refPath":o},"values":json.dumps(v)})["returnValue"]
def by_label(lbl, cls="/Script/Engine.StaticMeshActor"):   # labels are the only stable handle you chose yourself
    for a in T("editor_toolset.toolsets.scene.SceneTools.find_actors",{"name":"","tag":"","collision_channels":[],"actor_type":{"refPath":cls}})["returnValue"]:
        if T("editor_toolset.toolsets.actor.ActorTools.get_label",{"actor":a})["returnValue"]==lbl: return a["refPath"]
def box(label,c,size_cm,mat,folder):        # architecture out of /Engine/BasicShapes/Cube
    a=T(ST+"add_to_scene_from_asset",{"asset_path":"/Engine/BasicShapes/Cube","name":label,"xform":xf(c,(0,0,0),(size_cm[0]/100,size_cm[1]/100,size_cm[2]/100))})["returnValue"]["refPath"]
    T(AT+"set_label",{"actor":{"refPath":a},"label":label}); T(ST+"set_actor_folder",{"actor":{"refPath":a},"folder_path":folder})
    setp(a+".StaticMeshComponent0",{"overrideMaterials":[{"refPath":mat}]})
    return a
```

Rules learned the hard way:

- **A failed call aborts the script, and only some of it rolls back.** Assets created before
  the failure persist (materials, blueprints) but the edits inside them may not. Never rerun
  a script blindly: make every script idempotent (`AssetTools.exists`, `list_variables`,
  `list_graphs` checks) and split independent work into separate scripts so one bad pin name
  does not cost the batch.
- `try/except` around `execute_tool` catches schema/argument errors (`input param X is
  required`) but NOT node-creation assertions from `write_graph_dsl` / `create_node`, and not
  `Parameter error: ... is not valid Object` - those kill the script. Existence checks must be
  made with calls that return normally (`find_assets`, `list_variables`, `list_graphs`).
- Property names in `set_properties` are **camelCase of the UPROPERTY** (`overrideMaterials`,
  `relativeLocation`, `bUnbound`, `fishTag` for a Blueprint variable `FishTag`). Enum values are
  the C++ short form (`BLEND_Translucent`, `TLM_SurfacePerPixelLighting`, `Hidden`). Object
  references are `{"refPath": ...}`. `list_properties` returns the JSON schema - use it when a
  struct shape is unclear (`layoutData` on a canvas slot, `settings` on a PostProcessVolume).
- Spawned actors get generated names; use the returned `refPath`, then `set_label`. Component
  paths are `<actor refPath>.<ComponentName>` (`.StaticMeshComponent0`, `.Mesh`, `.Orbit`).
  Light actors do not follow the pattern you expect: DirectionalLight's component is
  `LightComponent0`, fog is `HeightFogComponent0` - `get_components` first.
- `find_actors` and `find_assets` paginate at 20 silently on wide queries. Filter by class or
  folder, or loop.

## 7. Slate automation is a last resort

`SlateInspectorToolset` can click toolbar buttons and type into the status-bar `Cmd` box, and
`Snapshot` gives you refs. But toolbar checkboxes carry no labels, the same global setting is
mirrored into every viewport pane, and refs go stale when the user changes the layout. A
heuristic click on "all unchecked 24x24 checkboxes" flipped the user's snapping settings and
took several passes to undo. If you must click, click one ref you have just read, then
re-snapshot and confirm the effect. Prefer the non-UI route whenever one exists (floating PIE
instead of the realtime toggle; `ObjectTools.set_properties` on
`/Script/UnrealEd.Default__EditorPerformanceSettings` instead of Editor Preferences).

## 7b. Console commands and editor Python

The toolset has no console-command tool and its Python sandbox cannot `import unreal`. The way
in is the status-bar Cmd textbox via `SlateInspectorToolset.Type`, wrapped in
`tools/ue_console.sh` because the box duplicates the first character and only accepts every
other submit. Once it works you have all of `unreal.*`: `py unreal.EditorLoadingAndSavingUtils.
save_dirty_packages(True, True)` was how the World Partition actors finally got saved.

## 8. Level hygiene for an agent-made level

- Delete template geometry by class, keeping the sky sphere:
  `find_actors(actor_type=StaticMeshActor)` -> skip labels containing `SkySphere` -> `remove_from_scene`, loop until empty (20-result pages).
- Put everything in outliner folders (`set_actor_folder`) - your later `by_label` lookups and
  the human's Outliner both depend on it.
- `ObjectTools.set_properties` on a level actor does not mark it dirty, so its edits are not
  saved and vanish on the next reload. After property-only edits (instance arrays, materials on
  a component, variables on an instance) write the actor's transform back unchanged to dirty it.
- Save with `AssetTools.save_assets([...all /Game/<Yours> assets..., "/Game/Maps/Level"])`, then
  `tools/ue_console.sh 'py unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)'`
  - the level is World Partition and every actor is its own external package; saving the map
  alone leaves them unsaved, and `SceneTools.save_actor` cannot save never-saved actors. Confirm
  with the status bar reading "All Saved" (`Snapshot("sp1")`).
- Back up `Content/` to a tarball before the first mutating script. It is cheap and you will
  be glad of it the first time a script half-applies.

### Save All leaves an unsaved asset and edits revert on restart

Check the running editor's command line for `-Unattended`. In UE 5.8.2 this can cancel the
normal checkout-and-save path even when the files are writable. Use the direct Python save
and dirty-package checks in [setup.md](../setup.md#interactive-editing-and-saving) before
restarting without that flag. Treat this separately from property edits that never marked
an actor dirty, World Partition external packages, and changes made only in Play/Simulate.

## 8b. The editor can die under you

A Vulkan GPU crash (`FVulkanDynamicRHI.TerminateOnGPUCrash`, in a Nanite pass) took the editor
down once after ~6 hours, with no dialog. Everything had been saved minutes earlier, so nothing
was lost. Treat the "All Saved" check as a habit after every batch of edits, keep the relaunch
command line at hand (`/proc/<pid>/cmdline`), and expect the user to relaunch *without* your MCP
flag - which is why the auto-start setting must live in `Config/Default*.ini`. When the server
is not on :8000 after a relaunch, the only fix is another restart with the flag; there is no way
in through Slate without MCP.

