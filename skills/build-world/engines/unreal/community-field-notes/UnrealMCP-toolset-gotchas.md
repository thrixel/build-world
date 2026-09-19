Every entry: symptom in the heading, condition that triggers it, workaround if there is one.

The current editor version you are using may be newer than the versions associated with these
symptoms. Use the tools as you would normally, and only consult this document and apply workarounds
if you see suspicious results and suspect that these gotchas may be involved.

---

## Contents

- [Arguments, names and paths](#arguments-names-and-paths)
- [EditorAppToolset](#editorapptoolset)
- [ObjectTools](#objecttools)
- [ProgrammaticToolset](#programmatictoolset)
- [SequencerTools](#sequencertools)
- [PCGToolset](#pcgtoolset)
- [MaterialTools](#materialtools)
- [Animation and meshes](#animation-and-meshes)
- [PhysicsAssetToolset](#physicsassettoolset)
- [Plugins, search and odds](#plugins-search-and-odds)
- [BlueprintTools and the graph DSL](#blueprinttools-and-the-graph-dsl)
- [StaticMeshTools, UMG, saving](#staticmeshtools-umg-saving)
- [Additional EditorAppToolset / ObjectTools / ProgrammaticToolset notes (Sept 2026 build)](#additional-editorapptoolset--objecttools--programmatictoolset-notes-sept-2026-build)

---

## Arguments, names and paths

Naming across this API is not consistent, and the inconsistencies are not documented. This
section is about the tools' own surface - argument names, return shapes, truncation - rather than
about UE's object-path conventions in general, which
[the field guide (§4)](./UE-field-guide.md) already covers well.

### Argument names diverge between toolsets, and inside one toolset

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Caught in practice, all of them by having the call fail:

- `AssetTools.delete` wants `path`. Not `asset_path`.
- `SkeletalMeshTools.set_socket_transform` wants `transform`, while `ActorTools` uses `xform`
  for the same idea.
- Inside `MaterialInstanceTools`: `list_parameters` takes `material`, and
  `get_texture_parameter` takes `instance` plus `name`. Same toolset, same kind of object, two
  different words for it.
- `AssetTools.list_folders` takes `root_path` - and its own docstring says otherwise.
- `save_assets` takes plain path strings without the `.Asset` suffix, not `{refPath}` objects,
  and there is no `assets` argument at all.

**Workaround.** Let the validation error tell you the schema - that is the intended way to
discover it. But do that outside a batch script: in a script a wrong argument name rolls back
everything the script has already done, so the cheap self-correction becomes an expensive one.

### `find_actors` truncates at 20 without saying so

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Ask broadly and you get twenty results and no indication that there were more. `find_assets`
appears to do the same on wide queries.

**Workaround.** Treat exactly twenty results the way you would treat zero: as a number that means
"ask again, differently".

### Actor tools only see loaded World Partition cells

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

Everything that enumerates actors sees the streamed-in part of the world only. On a partitioned
map this is a moving target - the same query gives different answers depending on where the
editor camera was.

**Workaround.** Load the region you intend to query first, and never conclude "the actor does not
exist" from an actor query alone.

### Verify an asset path before a script uses it

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

A wrong `refPath` is not the harmless "object not found" it looks like. It is the first step of
the chain that kills the editor - see
[the ProgrammaticToolset entry](#a-script-error-kills-the-editor-outright-when-the-edited-asset-is-open-in-its-own-window).

The log names it clearly once you know what to look for: `Failed to find object` → `is not valid
Object for property` → `Undo Execute tool script` → `appError`.

**Workaround.** `find_assets` first. Every time, including the paths you are sure about - the one
that got me was a typo in a path I had typed twenty times.

Subfolders are their own trap: plugin content does not always live where its category suggests,
and the file you want may sit one level up from the folder named after its feature.

---

## EditorAppToolset

### `CaptureViewport` with `captureTransform` requires explicit arguments

**Kind:** note · **Hit on:** 5.8.2 · **Workaround:** yes. Also see `CaptureEditorImage` for another method.

The original entry (hit on 5.8.0) said `CaptureViewport` ignored `captureTransform` entirely, but it turns out
the tool call might just need explicit arguments.

**In 5.8.2**, explicit `captureTransform`, `annotations:null`, `bShowUI:false` returns
the requested camera and a matching image. (This may also work on 5.8.0 and the agent who wrote the note for
5.8.0 might have just not realized it should have tried these explicit arguments, though this is unverified; check this
if you're on 5.8.0.)

A workaround that doesn't rely on the toolset (which works for headless setups): enable the
PixelStreaming plugin in the project, open the PixelStreaming client page in a browser
(can be a headless browser such as Playwright; the page is on port 8080 on Linux and port 80 elsewhere.)
Use scripting to send events to navigate in the viewport if needed, and take browser screenshots.

Should only ask a human for a screenshot as last resort.

### Optional arguments that are not optional

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

`CaptureViewport` marks `captureTransform` and `annotations` as `TOptional`. Omit either and
the call fails with `input param X needs a default value`. Both are mandatory in practice.

`StartPIE` is the same shape: it wants the full `options` block - `bSimulate`, `playMode`,
`warmupSeconds` - and `playMode` is required even when `bSimulate` already says what you mean.

On 5.8.2, explicit `annotations:null` successfully disables annotations. The older 5.8.0
workaround was a block of zeros plus `classFilter: {"refPath": ""}`.

**Workaround.** Treat `TOptional` in this API as documentation of intent, not of behaviour.
Pass explicit values or a tested null.

### `CaptureViewport` returns ~2.8 MB and the payload lands in a file

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

The base64 image does not come back inline - it spills into a `tool-results` file, and the
client has to go read it. Worth knowing before you plan a loop around it.

The structure is `returnValue.image.data`, not `returnValue.data`. Sibling tools differ here:
the Slate inspector's screenshot puts its payload directly at `returnValue.data`. Same idea,
different shape, no warning.

**Workaround.** Parse the file, decode `returnValue.image.data`, write a `.png`, read that.

### `GetCameraTransform` only tells the truth while the camera is locked

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

Without `set_camera_lock(true)` it reports the free viewport, not the sequence camera - and
because the viewport eases into position, two reads a second apart give different numbers.
The symptom reads as "my keys are in the wrong place", which sends you to fix the keys.

`close_sequence` and `open_sequence` both drop the lock.

**Workaround.** To verify keys by pose: lock → `set_playhead_frame` → `force_evaluate` →
`GetCameraTransform`.

### There is no console-command tool

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

`EditorAppToolset` can search console variables. It cannot set one, and there is no
`ExecuteConsoleCommand` anywhere in the surface. For a system built to automate the editor,
the absence is louder than most bugs on this page.

**Workaround.** Type into the editor's status-bar command box through the Slate inspector:
`Type {ref, text, submit: true}`. Find the ref with `Observe("")` then `Snapshot` on the status
bar menu - it is the textbox next to "Cmd". It works while PIE is running, too.

Console variables set this way outside PIE persist into the next PIE session, which makes
A/B tests of renderer settings possible (`r.AntiAliasingMethod`, `r.EarlyZPass`); read the value
back with `SearchCVars` and restore it afterwards. `WorldSettings.timeDilation` cannot be
written through `set_properties`.

### Every `ProfileGPU` leaves a GPU Visualizer window open, and the next profile pays for it

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

The window is never closed. They stack up, they redraw every frame, and the editor starts
crawling - which reads as "profiling made my editor slow" rather than "I have six windows
open". Worse, an unclosed visualizer adds roughly 2000 draw calls to the frame you profile
next, so the numbers you are collecting are wrong in a way that looks plausible.

**Workaround.** Close it through the Slate inspector - `Windows {action: "close", index}` -
before every subsequent measurement.

### `stat unit` typed from the status bar does not draw over PIE

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

The command goes through, the overlay never appears, and the screenshot comes back empty.

**Workaround.** Use `ProfileGPU` instead: it writes a full pass breakdown into the Output Log,
which you can read with the log toolset and a pattern filter. Slower to read, but it is text,
and text is what an agent can actually use.

---

## ObjectTools

### A failed `set_properties` still wipes the properties it touched

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

I asked for `{skeleton, sampleData}` on a BlendSpace. `skeleton` is not editable, so the call
failed - and took `sampleData` with it. The asset came back with `skeleton: None` and
`sampleData: []`. Both fields I had asked about were now empty.

So the call is not atomic and it does not roll back. A rejected write is not a no-op; it is a
partial write you did not ask for.

**Workaround.** Probe unknown properties on a duplicate, never on the asset you care about.
If the duplicate comes back gutted, you have lost nothing.

### `set_properties` does not dirty the package - the edit is lost on the next reload

**Kind:** defect · **Hit on:** 5.8.2 · **Workaround:** yes

An `InstancedStaticMeshComponent` whose `perInstanceSMData` was rewritten through
`set_properties` read back correctly, the status bar never counted its actor as unsaved, "save
all" had nothing to save, and after an editor crash the level came back with the OLD instance
list. Actors changed through `set_actor_transform` (which goes through a transaction) and newly
spawned actors were fine. So a `set_properties`-only edit lives in memory until something else
dirties the package.

**Workaround.** After property edits on an actor or its components, write its transform back
unchanged with `ActorTools.set_actor_transform` - that marks the package dirty - then save. For
assets (materials, meshes, blueprints) `AssetTools.save_assets` saves regardless of the dirty
flag, so only level actors are affected. Verify with the status-bar counter going up before the
save and files under `Content/__ExternalActors__` getting newer after it.

### Setting `staticMesh` on a component clears its `overrideMaterials`

**Kind:** note · **Hit on:** 5.8.2 · **Workaround:** yes

Swapping the mesh of a `StaticMeshComponent` through `set_properties` resets `overrideMaterials`
to empty, so the actor shows the mesh's own slot materials (for an OBJ import that is the grey
default). Set `staticMesh` and `overrideMaterials` together, or reapply the override after the swap
- and look at it: a terrain that turns grey after a mesh reimport is this.

### On a Blueprint actor's component, only the FIRST member of a vector or rotator is written

**Kind:** defect · **Hit on:** 5.8.2 · **Workaround:** yes

`set_properties` on a component of a placed Blueprint actor with
`{"relativeScale3D": {"x": 0.9, "y": 0.9, "z": 0.9}}` reads back `(0.9, <old>, <old>)`.
`relativeLocation` keeps only `x`, `relativeRotation` keeps only `pitch`. No error, and the
returned value looks plausible unless you compare all three members. One member per call does
not help either. The visible results were uniform scales that stretched meshes along one axis,
and facing yaws that silently stayed at the class default. `StaticMeshActor` components, and
actor-level transforms, were not affected.

**Workaround.** Put the transform on the actor (`ActorTools.set_actor_transform`) whenever the
design allows. For a component offset that has to exist, use editor Python:
`comp.set_relative_location(...)`, `set_relative_rotation(...)`, `set_relative_scale3d(...)`
(see headless-autonomy.md §7b). **Read every struct back after writing it** and compare all members.

### A collision profile name does not change collision; nested `bodyInstance` fields are ignored

**Kind:** defect · **Hit on:** 5.8.2 · **Workaround:** yes

`{"bodyInstance": {"collisionProfileName": "NoCollision"}}` stores the name and nothing else:
`collisionEnabled` still reads `QueryAndPhysics`, traces still hit the mesh and pawns still
collide with it. Other nested fields (`collisionEnabled`, `bSimulatePhysics`, damping) are not
applied at all. A surface meant to be walked through stays solid, and "physics" props never move.

**Workaround.** Editor Python on the placed component:
`comp.set_collision_profile_name("NoCollision")` and
`comp.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)`. For Blueprint classes set it
at runtime in BeginPlay (`Collision|SetActorEnableCollision`, `Collision|SetCollisionProfileName`,
`Physics|SetSimulatePhysics`). For imported meshes that must never block,
`StaticMeshTools.remove_collisions` on the asset removes the auto-generated shape. Verify with
`SceneTools.trace_world` through the object.

### `set_properties` never fires `PostEditChangeProperty`

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes (manual)

The value changes and the asset goes dirty, so every check you can make through MCP says the
edit landed. What does not happen is the notification: systems that rebuild on
`PostEditChangeProperty` - preview meshes, generated thumbnails, anything listening on a
change delegate - never hear about it and keep serving stale state.

This is the known UE rule that a direct property write must be followed by an explicit
notify. The difference here is that you cannot do the explicit part: the toolset gives you no
way to construct the event.

**Workaround.** Touch the field once in the Details panel, or trigger the owning system's
rebuild by hand. If a commandlet consumes the asset afterwards, save it to disk first - a
separate process does not see in-memory edits and does not inherit console variables.

### An empty result is indistinguishable from "wrong context"

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

`[]` and `""` mean both "there is nothing here" and "the object is not loaded, or you are
asking in the wrong context". The API does not separate them, so an agent reads a clean empty
answer and concludes the collection is empty.

**Workaround.** Verify emptiness a second way before believing it. This is the single
cheapest habit on this page and the one that saves the most time.

### Delta serialization swallows a child CDO override equal to the parent value

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

Write a value onto a child Blueprint's CDO that happens to equal the parent's, and the call
reports success - but no delta is stored, because there is no difference to store. Change the
parent later, or update the plugin the parent lives in, and the child silently follows the new
parent value. The override you thought you set was never there.

The mirror image bites too: per-instance overrides on placed actors shadow CDO edits entirely.
Instances that were placed months ago keep their captured values and never see the new default.

**Workaround.** Assign the override while the parent holds a different value, and re-read after
any parent change. For stale placed actors, `reset_properties` on the single property returns
that instance to inheritance without touching the rest.

### Not every UPROPERTY is reachable through reflection

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes (manual)

`bEnableStreaming` on World Partition, for one: visible in the UI, not readable through
reflection. Absence from the reflection surface does not mean absence from the object.

**Workaround.** Change it in the editor UI and move on. Not everything is worth automating.

---

## ProgrammaticToolset

### A script error kills the editor outright when the edited asset is open in its own window

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

A script fails mid-run. The registry rolls the transaction back. The rollback tries to
rename a preview object on top of an existing one, and the editor dies:

```
Fatal error: Renaming an object (MaterialEditorOnlyData /Engine/Transient.PreviewMaterial_88:...)
on top of an existing object (...M_<YourMaterial>EditorOnlyData) is not allowed
```

No dialog, no prompt to save. Everything unsaved is gone.

What made it fire in my case was a typo in an asset path - nothing more dramatic than that.
The chain reads clearly in the log once you know it:

```
LogUObjectGlobals: Warning: Failed to find object '...'
→ is not valid Object for property
→ LogEditorTransaction: Undo Execute tool script
→ appError
```

**Workaround.** Close the asset's own editor window before running a script that mutates it.
And resolve every asset path with `find_assets` *before* the script uses it - a bad refPath
is not a harmless "object not found", it is the entrance to this crash.

**Why it matters.** The cost of a script error is not the error. It is everything the editor
was holding.

### An error inside a script rolls back every mutation the script already made

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

The script is one transaction. A call that succeeded three steps ago is undone when a later
call fails on a wrong argument name. I watched `add_socket` complete and then physically
disappear because the next call used an argument that does not exist.

**Workaround.** Validate argument names before batching. A single wrong name costs the whole
run, not just its own step - and if the asset is open in its editor, see the entry above.

### Subobject paths containing a space work in direct calls and break inside scripts

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

A component named with a space in it - `My Component` - resolves fine through a direct
`call_tool`. Put the same path inside a batch script and `get_properties` returns `None` or
throws.

**Workaround.** Handle those objects with direct calls and keep them out of batches. Or rename
the component, if it is yours.

### The dictionaries are `_StrictDict`: `.get(key, default)` raises

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Script-side dictionaries look like Python dicts until you call `.get()` with a fallback, which
raises `TypeError: does not support a default value`. The defensive pattern everyone writes by
reflex is the one that breaks - and it breaks the whole script, undoing everything before it.

**Workaround.** `if key in d: d[key]`. Never `.get`.

### `open()` inside a script is read-only, and the mode argument is mandatory

**Kind:** limitation · **Hit on:** 5.8.2 · **Workaround:** yes

`open(path)` raises `missing 1 required positional argument: 'mode'`, and `open(path, "w")`
raises `Mode 'w' is not permitted. Allowed modes: ['r', 'rb', 'rt']`. `exec` is not defined.
Reading large inputs (instance lists, placement tables) with `open(path, "r")` works and keeps
the script small.

**Workaround.** Return data in the result dict and write files from the shell that called the
tool.

### `get_properties` with a property the node's class does not have kills the entire script

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Ask for `MaterialFunction` on a node that is not a `MaterialFunctionCall` and the whole
`execute_tool_script` dies. `try/except` does not save you - the error comes out of
`execute_tool`, not out of Python.

**Workaround.** Request properties strictly by node type: `MaterialFunction` only on
`MaterialFunctionCall`, `ParameterName` only on `*Parameter` nodes, `Name` only on
`NamedRerouteDeclaration`, `R` only on `Constant`.

---

## SequencerTools

### `create_level_sequence` silently destroys an existing asset at the same path

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Point it at a package path that already holds a Level Sequence and it does not fail, warn,
or ask. It replaces. The old sequence - tracks, keys, bindings - is gone.

**Workaround.** `find_assets` on the target path before every create. Treat the call as
destructive, because it is.

### A new property-track section is created with a `0..0` range, so the keys never evaluate

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

`add_section` gives you a section whose range is zero-length. Keys written into it are accepted,
`get_keys` lists them all back, and the property holds its original value on every frame except
frame 0.

The symptom is "the animation on this property does nothing", which sends you looking at the
keys - and the keys are fine.

**Workaround.** `set_section_range(0, end)` immediately after every `add_section`. This is the
narrow, creation-time case of the wider rule that section ranges are independent of the
sequence playback range - see
[UE-field-guide.md §5.15](UE-field-guide.md) for the general version.

### Property tracks silently ignore nested struct fields

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

`set_property_name_and_path` with a path into a struct - `Filmback.SensorWidth` - creates the
track, accepts the keys, and never applies the value. No error anywhere in the chain.

Flat properties work (`CurrentFocalLength`, `bConstrainAspectRatio`), and so do paths the engine
itself registers (`FocusSettings.ManualFocusDistance`). Arbitrary struct paths do not.

**Workaround.** Set whole structs through `set_properties` on the spawnable instance instead of
animating them. If you need the struct field to change over time, find the engine-registered
path for it or animate something else.

### `create_camera` already made the property tracks, and a second one averages the values

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

`create_camera` quietly creates the standard property tracks on the child CameraComponent
binding - Current Focal Length, Manual Focus Distance, Current Aperture - with empty sections.
Add your own track for the same property and the engine blends two sources: the value you get
is the arithmetic mean of your keys and the original.

I asked for a focus distance of 131 cm and got 50065. That number makes no sense until you know
there are two tracks.

**Workaround.** `get_tracks_on_binding` plus `get_track_display_name` to find what is already
there, write into the existing track, and `remove_track` on any duplicate you created.

### Unbounded sections are normal, and asking about their range throws

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

The transform section from `create_camera` and every spawn section are created without bounds.
That is correct - you can write keys outside a range that does not exist. But
`get_section_range` and `get_section_properties` on such a section raise "Section does not have
a start frame", and inside a batch script that single raise rolls back everything the script has
done.

**Workaround.** Do not call range queries on sections you did not explicitly bound. `try` does
not help here - the error comes from the tool layer, not from your script.

### Changing display rate renumbers every existing key

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

Switch a sequence from 30 to 120 fps and frame 60 becomes frame 240. Absolute time is preserved,
which is the point - but every frame number you wrote down is now wrong, and code that reasons
about "the key at frame 60" quietly targets a quarter of the way through.

Related: the Camera Cuts section is half-open. Its end has to sit at `last_key + 1`, or the final
frame is never shown through the camera.

**Workaround.** After a rate change, stop trusting your notes: read the channel with `get_keys`,
clear it, and write again from the new numbers.

---

## PCGToolset

### ☠️ `GetNodeDataView` hangs the editor, and graph size is what decides it

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** none

The tool turns on graph-level data inspection. From then on every generation retains the data
of every node - hundreds of thousands of points across dozens of nodes, gigabytes of it - and
the editor runs out of memory. Two calls in parallel freeze it outright.

I first wrote this down as "only use it on a small test volume". That was wrong. On a graph of
about seventy nodes, a second call right after a generation froze the editor hard enough to
need a kill - **on a 40 × 40 m volume**. The volume is not what costs you. The graph is.

Inspection does not turn back off. Only a restart clears it.

**Workaround.** Do not use it on a production graph at all. Debug through the PCG log with a
pattern filter, and with your eyes.

### The toolset is not called what the catalogue says

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Its full name is `PCGToolset.PCGToolset`, and the spatial one is `PCGToolset.PCGSpatialToolset`.
Call either by the short name and you get "Toolset not found", which reads like the plugin is
missing rather than like a naming quirk.

### `ListNativeNodes` hides plugin nodes, `bCommonOnly: false` or not

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

The flag defaults to true, so the first listing is short. Setting it false makes the list longer -
and still without any node a plugin contributed. Those nodes exist, they are just not
discoverable through the tool that exists to discover nodes.

**Workaround.** Find their classes by reflection (`search_subclasses` on the PCG settings base),
and build with the plugin's own primitive subgraphs through `AddSubgraphNode` rather than with
native nodes.

### Adding a native node is `AddNode`, and all six arguments are required

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

There is no `AddNativeNode` - that name returns "Unknown tool". The real one is `AddNode`, and it
wants `graph`, `nativeNodeType`, `nodeName`, `jsonParams`, `nodeTitle`, `nodeComment`, every one
of them, every time. `nativeNodeType` is the display string from `ListNativeNodes`, spaces
included: `"Spatial Noise"`, `"Density Filter"`, `"Get Spline Data"`.

### `UpdateNode` demands `nodeTitle` even when you are only changing parameters

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Leave it out and the call fails; pass `""` and the existing title is kept. So the argument is
required in order to be ignored.

Inside a batch script this is not a small annoyance - the failure rolls back every mutation the
script has already made.

### `subGraphForNode` needs the object path with the name twice

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

`/Plugin/Primitives/Filter/Filter_Foo` is what `find_assets` gives you, and
`AddSubgraphNode` rejects it: "is not a valid object path for property 'SubGraphForNode'". It
wants `/Plugin/Primitives/Filter/Filter_Foo.Filter_Foo`.

This is the standard UE object-path convention rather than a bug, but it catches everyone,
because the tool that hands you the path hands you the form the next tool refuses.

### `ConnectNodePins` silently inserts conversion nodes

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

Connect two nodes whose data types do not line up and the tool inserts converters between them -
`FilterDataByType` and friends - without telling you. Your graph now has nodes you did not add,
and there is no direct edge between the two nodes you "connected", so a later
`DisconnectNodePins` fails.

The return value is the list of inserted nodes; an empty array means nothing was inserted. That
is the only notice you get.

**Workaround.** Before rewiring anything, read the actual edges from `GetGraphStructure` instead
of assuming your own connection exists.

### `paramOverrides` only holds non-default values, and that is success, not loss

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

Set a parameter to a value equal to its default and its key disappears from `paramOverrides`.
Nothing was lost - there is simply no override to record.

The trap is on the read side: a node with `mode: Perlin2D` shows no `mode` key at all, because
Perlin2D is the default. "The parameter is not set" and "the parameter is set to its default" look
identical in a dump.

**Workaround.** Read the schema with `GetNativeNodeSchema` when you need to know what a missing
key means. And guard every lookup - the dictionaries here raise on a missing key rather than
returning a default, and inside a script that raise costs you the whole run.

### "Failed to call Execute" means busy, not broken

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

`ExecuteGraphInstance` refuses while the previous generation is still running, and the message
does not say so. Same message when the editor is still warming up after launch.

I originally wrote this down as an idle timeout in the client and concluded that generation had
to be triggered by hand. That was wrong too: twenty-five consecutive runs on a full-map graph
went through the tool without a single timeout. The condition is simply a pause of around fifty
seconds between runs. The fully autonomous loop - edit the graph, execute, look at the result -
does work.

**Workaround.** Wait and retry rather than debugging the graph.

---

## MaterialTools

### `get_expression_inputs` reports the wrong `output_name` on multi-output nodes

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

When the source node has several outputs - a break-attributes node, for instance - every
connection comes back naming the same output. In my case all of them claimed to come from
"Specular". The `input_name` side is correct; it is only the output that lies.

Which means you cannot reconstruct a graph's topology from this call alone, and if you do, the
result looks coherent and is wrong.

**Workaround.** Cross-check with the node's real output names before believing any edge that
starts at a multi-output node.

### `layout_expressions` re-lays out the entire graph, not the part you touched

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

There is no "layout selection". Call it on a graph somebody else authored and every node
moves - the grouping, the comment boxes, the deliberate spacing that made the graph readable
are all gone, and there is no undo that brings the arrangement back.

**Workaround.** Never call it on a graph you did not author. Place new nodes with explicit
`x` / `y` in `add_expression`; find the free area first by taking the maximum
`MaterialExpressionEditorY` across existing nodes.

The neighbouring `delete_unused_expressions` deserves the same caution. It removes everything
not connected to a material output - which includes the author's legacy nodes, parked
deliberately and still wanted. It reads like tidying. It is data loss.

### A named reroute cannot be traced back to its declaration

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

`NamedRerouteUsage` exposes neither `Declaration` nor `DeclarationGuid` to reflection - listing
its properties gives you editor coordinates and a description, nothing else. So when you walk
somebody else's material graph and hit a named reroute, the chain simply ends there.

**Workaround.** Infer the name from context. There is no programmatic route, so plan graph
traversal knowing it has holes.

---

## Animation and meshes

### An AnimBlueprint or BlendSpace cannot be pointed at a different skeleton

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes (manual)

`BlendSpace.skeleton` is read-only to reflection. On an AnimBlueprint it is worse: asking for the
asset's properties gives you the CDO of the AnimInstance, so `TargetSkeleton` is not merely
unwritable, it is not visible. And `BlueprintTools.create` goes through the plain Blueprint
factory, which has no notion of a skeleton at all.

`AssetTools.duplicate` copies everything correctly, including skeleton and samples - but a
duplicate points at the same skeleton it came from, which is the one thing you were trying to
change.

**Workaround.** Create the asset by hand in the editor, on the right skeleton. That single act is
all that needs a human.

### What does work on those assets, once they exist

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** n/a

Worth stating, because the entry above reads more hopeless than it is:

- `set_parent` works on an AnimBlueprint. Reparenting a freshly created ABP onto a custom
  AnimInstance base went through normally - reparent, compile, verify with `get_parent`.
- `blendParameters` writes fine on a BlendSpace, including as a struct array, without losing
  `sampleData` or `skeleton`.

So the only things a human has to do are creating the asset on the right skeleton and authoring
the AnimGraph. Everything else can be driven.

### Renaming a blend space axis does not need a grid rebuild

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** n/a

As long as `min`, `max` and `gridNum` stay put, editing `blendParameters` is safe: the baked grid
samples store sample indices and weights, not positions. Renaming an axis or swapping which
animation a sample points at leaves the grid valid.

### `add_socket` creates a mesh socket, not a skeleton socket

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

The second argument of the underlying call is `bAddSocketToSkeleton`, and it is false. So the
socket exists on that one mesh, and sibling meshes sharing the skeleton never see it. Verified
the unhappy way: a socket added to one variant of a character was simply absent on the other.

This is convenient when you want a targeted change that does not touch a purchased pack - and
surprising if you expected sockets to live where the editor's own UI suggests they live.

---

## PhysicsAssetToolset

### Constraint reference frames are unreachable - for reading and for writing

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes (manual)

`PhysicsAssetToolset` exposes limits (`SetConstraintLimits`), masses, shapes and modes.
It exposes nothing about Parent or Child Rotation. Reflection is closed too:
`get_properties(PhysicsAsset, ["ConstraintSetup"])` answers "could not be read", and
`ObjectTools` has no way to walk into subobjects.

This is worse than it sounds. Porting constraint limits from a finished character to a new
one carries **how far** a joint bends, but not **which way**. On an asset with auto-generated
frames the cone is centred on the bone, so a knee with `Swing1 Limited 65` folds forward as
happily as backward. No amount of copied numbers fixes that - the numbers are not where the
problem is.

**Workaround.** Rotate the frame by hand in the Physics Asset Editor: select the constraint →
Details → Constraint Transforms → **Parent → Rotation**, third component (Z / Yaw). Leave
Child Rotation at zero, and do not touch Parent Position - that is an offset along the bone
and it is per-skeleton.

Rule of thumb that held up across two characters: **the rotation is roughly equal to the
limit itself**. With `Swing1 Limited 65`, a yaw around 60 puts the straight leg at the edge
of the bend window, and the joint folds one way only. If you have a tuned donor asset, copy
its Rotation values directly - unlike Position, they do not depend on the mesh proportions.

### Do not compare constraint motions by their first letter

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

`Locked` and `Limited` both start with `L`. Shorten them while diffing two assets and every joint
matches, including the ones that do not. I verified a port this way once and declared it clean
when it was not.

**Workaround.** Compare full strings. It is a stupid rule and it costs nothing.

---

## Plugins, search and odds

### `SetPluginEnabled` does not persist

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

It returns null, the plugin appears enabled, and after a restart it is disabled again. Nothing
was written to the `.uproject`.

**Workaround.** Edit the `.uproject` yourself and restart the editor.

### The semantic search toolset ships non-functional

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

`SemanticSearchToolset` is wired to OpenAI - captions and embeddings both. With no key it answers
401, and the search index on disk is empty, so the toolset that looks like the answer to "find me
the thing" is the one tool guaranteed not to work out of the box. Making it work costs money at a
third party.

**Workaround.** `find_assets`, gameplay tags, and plain text search over the project. They are
enough more often than you would expect.

### `AssetTools.delete` returns false for just-imported assets and for folders

**Kind:** limitation · **Hit on:** 5.8.2 · **Workaround:** yes

Deleting a folder path returns `false`, and so did deleting each freshly imported (never saved)
static mesh, texture and material inside it, with no reason given. The same assets deleted fine
via editor Python: `py unreal.EditorAssetLibrary.delete_directory("/Game/<Folder>")` through the
Cmd box (`tools/ue_console.sh`). Assets that had been saved once (the terrain mesh) deleted
through the tool without trouble, so treat the tool as "works on saved assets".

### `AssetTools.get_asset_class` returns short class names

**Kind:** note · **Hit on:** 5.8.2

The return value is `Material`, `Texture2D`, `StaticMesh`, `MaterialInstanceConstant` - not a
`/Script/Engine.Material` path. A filter written as `cls.endswith(".Material")` never matches
and skips its branch without any error; here it silently skipped a two-sided pass over several
hundred imported materials. Compare `cls.split(".")[-1]` so either form works.

### `StaticMeshTools` has no `get_mesh_info`

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

The obvious call does not exist. What exists: `get_lod_count`, `get_triangle_count(mesh, lod)`,
`get_lod_thresholds`, `get_material_slots`, `get_material`, `is_nanite_enabled`,
`set_nanite_enabled`. The mesh argument is `mesh`, not `static_mesh`, and `minLOD` is not readable
through reflection at all.

Instance count on an instanced static mesh is the length of its per-instance data array - there is
no counter to ask for.

### `GetQueryDescription` reports "Empty" for editable World Conditions

**Kind:** defect · **Hit on:** 5.8.0 · **Workaround:** yes

It only describes a compiled shared definition. Point it at conditions that are still editable and
it says the query is empty - which is indistinguishable from an actually empty query.

### Client-side: agent permission classifiers block Slate clicks and PIE

**Kind:** note · **Hit on:** 5.8.0 · **Workaround:** yes

Not an engine issue - this one is on the client. Automated approval refuses Slate clicks and
`StartPIE`, so a run that should be autonomous stops. With explicit human approval both work
exactly as documented: a click on a button reports true, and simulate mode brings a PIE world up
in about seven seconds.

**Workaround.** Ask for approval up front for the interactive parts, rather than discovering the
refusal in the middle of a sequence. And note that interactive tools take over the human's editor
while they run - always worth announcing before you do it.

---

## BlueprintTools and the graph DSL

All hit on 5.8.2 while authoring three Blueprints and one Widget Blueprint entirely through
`write_graph_dsl`. The DSL is the fastest way to author logic, but it has edges.

### `write_graph_dsl` APPENDS to the graph

**Kind:** limitation · **Workaround:** yes

Writing a second time does not replace the first write: you get two BeginPlay events, two
Tick events, duplicate key bindings. `read_graph_dsl` shows the accumulation. Clear first:
`find_nodes(graph, title="")` returns every node; `delete_node` each; then write. Function
graphs are the exception - rewriting a `(fn ...)` graph replaced its body cleanly in practice.

### `(fn ...)` only works inside a function graph; `(event ...)` cannot create custom or key events

**Kind:** limitation · **Workaround:** yes

- `(fn Name ...)` in the EventGraph fails with `AddEvent|Name does not exist`. Create the graph
  first (`add_function_graph`), add params (`add_function_param`), then write `(fn Name (Params) ...)`
  into THAT graph.
- `(event Frenzy ...)` for a custom event fails the same way. There is no custom-event path in the
  DSL; use functions.
- `(event Input|KeyboardEvents|E ...)` and `(event E (Key) ...)` both fail, even though
  `read_graph_dsl` prints an existing key node as `(event E (Key))`. Create the key node with
  `create_node(graph, "Input|KeyboardEvents|E", pos)`, the call with
  `create_node(graph, "CallFunction|<YourFunction>", pos)`, read the pin ids with
  `get_node_infos`, and `connect_pins(Pressed -> execute)`. Only param-less or all-defaulted
  functions are practical targets.
- Existing engine events work with the palette path: `(event EventBeginPlay ...)`,
  `(event EventTick (DeltaSeconds) ...)`, `(event AddEvent|Collision|EventActorBeginOverlap (OtherActor) ...)`.

### New variables and functions need a `compile_blueprint` before the DSL can see them

**Kind:** limitation · **Workaround:** yes

`add_variable` then `write_graph_dsl` referencing `Variables|Default|GetFrenzy` fails with
"does not exist". Compile between adding members and writing graphs that use them.

### Removing a function that a graph still calls breaks the next write

**Kind:** limitation · **Workaround:** yes

`remove_function_graph("FeedNow")` while the EventGraph still holds a `CallFunction|FeedNow`
node makes the following `write_graph_dsl` fail with `Could not find a function named "FeedNow"`
(the write compiles) and the whole script rolls back. Clear the event graph (delete its nodes)
and compile BEFORE removing functions, then rebuild.

### Replacing the body of an existing function graph

**Kind:** note · **Hit on:** 5.8.2

Because `write_graph_dsl` appends, and a removed function cannot be re-added under the same name
while something still calls it, rewrite in place: `find_nodes(graph, "")`, `delete_node` each
(wrap in `try` - the entry node refuses or is recreated), then `write_graph_dsl` with the same
`(fn Name (Params) ...)` header and compile. Check `find_nodes(..., entry_points_only=true)`
returns one node and `read_graph_dsl` shows a single `(fn`.

### A `bind` of a pure expression is re-evaluated at every use

**Kind:** note · **Hit on:** 5.8.2 · **Workaround:** yes

`(bind n (not (Variables|Default|GetIsOpen)))` followed by `(Variables|Default|SetIsOpen n)` and
then `(select n ...)` reads the flipped value the second time: pure Blueprint nodes have no
cached output, so each consumer re-runs the expression against the variable you just changed.
The symptom was a toggle that worked while its prompt text always showed the wrong state.

**Workaround.** Branch on the variable and set literals in each branch
(`(if (GetIsOpen) (SetIsOpen false) ... (else (SetIsOpen true) ...))`), or derive later values
from the variable after it has been written.

### Reading another instance's variable: not from inside the same class

**Kind:** limitation · **Hit on:** 5.8.2 · **Workaround:** yes

From another Blueprint, `Class|BPOther|GetScore :self other` exists. Inside `BP_Other`'s own
graph the only getter is `Variables|Default|GetScore`, which has no target pin, so an instance
cannot read a sibling instance's variable through the DSL.

**Workaround.** Add a one-line function with an output parameter
(`add_function_param(..., input_param=false)`, body `(return (Variables|Default|GetScore))`).
Inside the class it is `CallFunction|ReadScore :self other :Unused false`; from other classes
`Class|BPOther|ReadScore :self other :Unused false`. Keep a dummy input parameter, as for any
function you need to call by node.

### Latent nodes inside functions are rejected; use timers by name

**Kind:** limitation · **Workaround:** yes

`Utilities|FlowControl|Delay` cannot live in a function graph. Split the "wait" into
`Utilities|Time|SetTimerbyFunctionName :Object self :FunctionName "Later" :Time 12.0` and put the
continuation in a param-less function `Later`. In the EventGraph, `Delay` works as a plain
sequential statement (no continuation block needed).

### Functions created without parameters are invisible to `find_node_types` and cannot be called from other Blueprints

**Kind:** defect · **Workaround:** yes

A function graph created by `add_function_graph` with no `add_function_param` before its first
compile never appears as `Class|<BP>|<Fn>` in another Blueprint, and `write_graph_dsl` there
fails with `Class|WBPFeedPrompt|HideMsg does not exist`. Adding a parameter afterwards does not
help, nor does `remove_function_graph` + re-adding under the same name (the new graph is then
treated as an event: `AddEvent|HideMsg does not exist`).

**Workaround.** Give every function you will call from *another* Blueprint at least one
parameter *before* its first `write_graph_dsl`/compile (a dummy `bool Unused` is fine), or create
it again under a **new name**. Alternatively avoid cross-Blueprint function calls: component and
variable accessors (`Class|BPFish|GetOrbit`, `Class|BPFish|GetBaseRate`) ARE registered, so the
caller can drive the other actor's components directly after a cast.

### Argument names are given by the error; positional args are echoed back

**Kind:** note

A wrong keyword fails fast with the full pin list: `Unknown input pin "InText" on Class|Text|SetText.
Input pins: ['Text', 'self']`. Cheap to iterate on outside a batch script. `read_graph_dsl` prints
positional forms and auto-bound names (`_returnvalue`, `_asbp_fish`) - fine for verification, not
for copy-paste back in. It also prints ambiguous class names for same-named functions
(`Class|CharacterMovementComponent|SetRotationRate` for a RotatingMovementComponent call, `Class|Character|GetMesh`
for `Class|BPFish|GetMesh`); the compiled graph was still correct.

### Text-typed Blueprint variables are set as plain strings

**Kind:** note

`set_properties(actor, {"promptHungry": "Press E"})` works for an FText variable once the
variable exists on the compiled class. "The following properties could not be set" here meant
the variable had not survived a rolled-back script, not a type problem. `list_properties` on the
instance shows `{"type":"string"}` for FText.

### Component collision shapes edited with `set_properties` are not rebuilt

**Kind:** defect · **Workaround:** yes

`boxExtent` on a BoxComponent trigger reads back changed but the physics shape keeps the old
size, and overlap events never fire (no `PostEditChangeProperty`). Either set the extent on the
Blueprint's component template *before* placing instances, or avoid collision for proximity:
a Tick-based `GetDistanceTo(GetPlayerPawn) < Radius` check worked first time and needs no
physics.

### Widget variables live under the Blueprint's own category

**Kind:** note

After `UMGToolSet.ToggleWidgetAsVariable(..., true)` the getter is
`Variables|WBP_FeedPrompt|GetPromptText`, not `Variables|Default|GetPromptText`. Discover it with
`find_node_types(graph, "PromptText")`. Setting the text is `Class|Text|SetText :self <textblock> :Text <text>`
(the TextBlock class is shown as `Text`), and widget visibility is `Widget|SetVisibility :self <widget> :InVisibility "Hidden"`.

---

## StaticMeshTools, UMG, saving

### `import_file` accepts only FBX/OBJ

**Kind:** limitation · **Hit on:** 5.8.0 · **Workaround:** yes

`FbxFactory does not support ".glb" files`. Request FBX from the asset service. Imports into the
same folder overwrite each other's `Image_0` / `Material_0`; use one folder per asset.

### Saving a World Partition level does not save its actors

**Kind:** limitation · **Workaround:** yes

`AssetTools.save_assets(["/Game/Maps/Lvl"])` reports success and `is_dirty` turns false, yet the
status bar still shows hundreds of unsaved packages: every actor of a World Partition level is
its own external package, and `find_assets("/Game/__ExternalActors__")` does not list unsaved
ones. `SceneTools.save_actor` refuses non-external actors (WorldSettings, Brush - "Save the level
instead") and fails with `Asset does not exist` for actors never saved before; each failure
aborts a batch script. Clicking the toolbar "Save Current Level" button through Slate did not
flush them either.

**Workaround.** Run the editor's Python through the status-bar console:
`py unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)`. This saved 283 actor
packages and the status bar read "All Saved". Use `tools/ue_console.sh` (below) - typing into
the Cmd box has quirks of its own.

### Arrays: a resize leaves the LAST element at its default, and resize+edit in one call fails

**Kind:** defect · **Hit on:** 5.8.2 · **Workaround:** yes

Two separate problems with array properties (seen on `perInstanceSMData`):

1. Writing a shorter or longer array whose surviving elements also changed fails with
   `ArrayAdd: elements changed alongside the size change; insertion points are ambiguous`.
   Set the property to `[]` first, then write.
2. Any write that changes the length comes back with the correct count but the **last element
   left at its default** (an identity transform, i.e. an instance at the actor origin). This is
   how a 1 m tree, a fence panel and a grass tuft ended up standing inside the house, once per
   instanced component. A second write of the identical, same-length array fixes every element.

**Workaround.** `set([])` -> `set(list)` -> `set(list)` again, then read back and assert no
element is still default. Same-length rewrites alone are reliable.

### Large per-instance arrays: one write can block the editor for minutes

**Kind:** note · **Hit on:** 5.8.2 · **Workaround:** yes

Writing `perInstanceSMCustomData` for a few thousand instances took several minutes per
`set_properties` call with the editor at 100% CPU and unresponsive. The HTTP client timed out
while the script kept running and completed correctly. `perInstanceSMData` of the same size
was much faster.

**Workaround.** Do not retry on the timeout. Poll a cheap read-only call until the server
answers again, then read the result back. Write each array once per component (twice only for
the resize defect above), and prefer fewer, larger components.

### The status-bar Cmd box: first character duplicated, submit lands every other time

**Kind:** defect · **Hit on:** 5.8.2 · **Workaround:** yes

`SlateInspectorToolset.Type {ref: <Cmd textbox>, text, submit: true}` is the only console route
(see "There is no console-command tool"). Observed: the first character of `text` is typed twice
(`py ...` arrives as `ppy ...`), text APPENDS to whatever is already in the box, and roughly
every second submit does nothing (an autocomplete popup - an untitled extra window in
`Windows list` - eats the Enter). `Type` without submit followed by `PressKey Enter`, and
`FillForm`, never submitted at all.

**Workaround.** Prefix the command with a space (the duplicate becomes harmless), press
`Escape` before each attempt, and retry until the log shows `Cmd: <your command>` (allow extra whitespace after `Cmd:`):
`grep -a "Cmd: " <Project>/Saved/Logs/<Project>.log | tail -1`. Packaged as
`tools/ue_console.sh '<command>' '<editor log>'`. The current helper uses unique Python
completion/error markers and stops on exceptions, avoiding replay of partial mutations. Older
versions could submit a slow script twice. Missing acknowledgements or connection loss still
require log/state inspection before retrying; use idempotent scripts where possible. Find the
textbox ref with `Snapshot("sp1")` - it is the
`textbox` next to the `"Cmd"` combobox at the bottom of the main window.

When the editor runs **without `-Unattended`** (the recommended way for interactive sessions,
see [setup.md](../setup.md#interactive-editing-and-saving)), popups are no longer suppressed: every FBX/OBJ import opens a **Message Log** window that
takes keyboard focus, the helper reports `No completion acknowledgement`, and
`CaptureEditorImage` can fail with `Failed to capture any editor windows`. List windows with
`SlateInspectorToolset.Windows {}` and close it with `Windows {"action":"close","index":N}`
after each import batch.

---

## Additional EditorAppToolset / ObjectTools / ProgrammaticToolset notes (Sept 2026 build)

### `CaptureEditorImage` is the screenshot tool that works

**Kind:** note

It returns the whole editor window as the user sees it (also headless with `-RenderOffscreen`,
also during PIE, also with floating PIE windows on top). Pair with `SetCameraTransform`.
`CaptureViewport` also worked in the 5.8.2 follow-up above. Multiple windows can cause the full
editor capture to be resized; obtain actual PIE viewport dimensions before mapping input coordinates.

### `StartPIE` spawns the pawn at `startTransform`, and `(0,0,0)` is inside your floor

**Kind:** defect · **Workaround:** yes

Passing a zero transform spawns the player at the origin - usually colliding
(`SpawnActor failed because of collision`) - and the view is black/underground. Pass the
PlayerStart location. Useful side effect: `startTransform` is how you position the player for a
screenshot. Prefer `PlayMode_InEditorFloating`: the in-viewport mode's world freezes on a
headless editor when no input arrives (see headless-autonomy.md §4).

A start point that overlaps geometry by even a few centimetres has the same outcome (a capsule
of radius ~34 and half-height ~96 clipping the edge of a raised deck was enough). It reads as
"fell through the world": the view is from the origin under the terrain, and every
proximity-based prompt shows at once because `GetPlayerPawn` is null and distances evaluate
to 0. Check the capsule against nearby tops before suspecting collision.

### The floating PIE window can shrink on every run

**Kind:** defect · **Hit on:** 5.8.2 · **Workaround:** yes

Most likely a bug with the built-in windowing system that is used with -RenderOffscreen
visible through editor captures and Pixel Streaming.

With `PlayMode_InEditorFloating`, `NewWindowHeight` drifted down a few dozen pixels per session
(378 -> 252 over a test series), which also changes the vertical field of view of every
screenshot. `unreal.LevelEditorPlaySettings` is not exposed to Python.

**Workaround.** `ConfigSettingsToolset.SetSectionProperties` with container `Editor`, category
`LevelEditor`, section `PlayIn`: `{"NewWindowWidth":1280,"NewWindowHeight":720,"CenterNewWindow":true}`.
With the window centred the size held.

### `LogsToolset.GetLogEntries` returns the OLDEST matches

**Kind:** defect · **Workaround:** yes

With `maxEntries: 10` and a pattern that matched earlier in the session you never see new lines.
`grep -a <pattern> <Project>/Saved/Logs/<Project>.log | tail` on disk is instant and correct.

### A `PostProcessVolume` written through `set_properties` can black out the scene

**Kind:** defect · **Workaround:** yes

Setting `settings.autoExposureMinBrightness/MaxBrightness` (with their `bOverride_` flags)
turned every viewport black, and clearing the override flags afterwards did not recover it
(no PostEditChange). `remove_from_scene` on the volume restored the picture; re-adding a fresh
volume with only `autoExposureBias`, bloom, vignette and `whiteTemp` overrides worked. Property
names are camelCase (`bUnbound`, `settings.bOverride_BloomIntensity`, `settings.bloomIntensity`).

### Script rollback is partial; make every script idempotent

**Kind:** defect · **Workaround:** yes

After a failing `execute_tool_script`, assets created by the script still exist (`create_material`,
`BlueprintTools.create`) while some in-memory edits are undone. The next run then dies on
`already exists`. Guard creation with `AssetTools.exists`, `list_variables`, `list_graphs`, and
split independent work into separate scripts.

### `try/except` catches argument errors, not tool assertions

**Kind:** note

`RuntimeError` from a missing/invalid argument IS catchable inside the script. Assertions raised
by `write_graph_dsl` / `create_node` ("The node could not be created") and `Parameter error: ... is
not valid Object` are not - they end the script. Probe existence with calls that return normally.

### Toolbar checkboxes in `SlateInspector` snapshots are unlabeled and mirrored

**Kind:** limitation · **Workaround:** yes

Every level-viewport pane repeats the same global toggles (snapping, realtime, ...) as anonymous
24x24 checkboxes, and refs change when the user changes the layout. Clicking by size/position
flipped the user's snapping settings. Click only a ref you have just read and confirmed by
tooltip (`Hover` then `Snapshot`), then re-snapshot to verify the effect.



---
#### Attribution:

ue58-mcp-field-notes by PavelVyny, used under CC BY 4.0.
https://github.com/PavelVyny/ue58-mcp-field-notes

Changes made:
- New entries for 5.8.2 added.

