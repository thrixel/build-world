Field manual for driving Unreal Engine 5.8 through MCP. Engine-level
gotchas, silent-fail edges, crash patterns, and the call sequences that
actually work — applicable regardless of which MCP server you're using
(Epic's official ModelContextProtocol plugin, custom servers, or anything
else). Auto-trigger when Unreal Engine MCP tools are detected in a session,
or when the user mentions Unreal Engine, UE5, Blueprints, Niagara,
MetaSound, materials, or any UE editor automation workflow. This skill
contains hard-won knowledge from real debugging sessions — most entries
trace back to an actual editor crash or hours-long faceplant. Ignoring it
when UE5 MCP tools are present will lead to wasted time hitting known dead
ends.

# ue5-mcp — Field manual for driving Unreal Engine 5 via MCP

Engine-level wisdom an LLM needs to drive UE5 through an MCP server without
faceplanting on UE's silent-fail edges. This skill is **server-agnostic**:
the gotchas, patterns, and identifiers documented here apply whether you're
connected to Epic's official `ModelContextProtocol` plugin (UE 5.8+) or any
other MCP server that exposes UE5 functionality.

What this skill *isn't*: a list of commands for any particular MCP server.
Each server publishes its own tool catalogue — ask the server with
`tools/list` for what it actually exposes. This skill covers what bites you
*after* you know the tool names.

---

## 1. Session checklist — read before you write

UE5 is a structured-asset editor. The agent that wins is the one that reads
state before mutating it.

1. **Always dump the asset before editing it.** Blueprint, material, Niagara
   system, widget, level — every MCP server worth its salt exposes a
   `dump_*` / `inspect_*` / `read_*` family. Use it. Editing a graph
   without first knowing what's there creates broken connections, duplicate
   nodes, and unrecoverable corruption faster than anything else.
2. **Discover before assuming.** Call `tools/list` once on connect, cache it,
   and use it to figure out which tools your server actually exposes.
   Different servers wrap UE5 differently; recipes from this manual that
   reference a generic capability (e.g., "dump the Blueprint graph") will
   map to different concrete tool names on different servers.
3. **Verify after mutating.** UE5 has too many silent-fail edges to trust a
   successful response. Read the property back. Compare to what you asked
   for. If they differ, re-examine.
4. **Save explicitly.** Most introspection tools serialize from disk. If
   your last mutation is in-memory only, the dump returns the pre-mutation
   state. Save the asset (or `SaveDirtyAssets`) before re-reading.

---

## 2. UE5 reflection gotchas

These bite agents regardless of which MCP server sits in front of them. Every
one has cost real debugging time.

### 2.1 PascalCase, not snake_case, for UPROPERTY writes

Setting a UPROPERTY via the Python binding's `set_editor_property("auto_possess_ai", ...)`
silently no-ops on many builds. UPROPERTY names are PascalCase at the
reflection layer: `AutoPossessAI`. Python's `unreal` module accepts
snake_case at the call site, but the underlying lookup is case-sensitive
against the PascalCase name. There is no error returned — the property
simply doesn't change.

**Detection pattern: round-trip verify.** After any UPROPERTY write, read the
property back and compare. Naive string compare misses normalization
(`EFoo::Bar` vs `Foo::Bar`, `(X=1,Y=2)` vs `(X=1.000000,Y=2.000000)`). The
robust pattern in native C++:

1. Allocate a scratch buffer aligned to `Property->GetMinAlignment()` and
   call `Property->InitializeValue(Scratch)`.
2. `Property->ImportText_Direct(RequestedValue, Scratch, Owner, PPF_None)`
   to canonicalize what was requested.
3. `Property->ExportTextItem_Direct(ExpectedText, Scratch, ...)` for the
   canonical form of "what we asked for."
4. Apply the write, then `Property->ExportTextItem_Direct(ActualText, ...)`
   for "what we got."
5. Compare `ExpectedText` to `ActualText`.

If they differ, the write didn't take — usually due to snake_case mismatch,
an enum-class qualifier issue, or a struct-text format the property doesn't
recognize.

### 2.2 Blueprint class path needs the `_C` suffix

`LoadObject<UClass>(nullptr, "/Game/Path/BP_Foo")` returns `nullptr`. The
Blueprint's generated class lives under a different name:
`/Game/Path/BP_Foo.BP_Foo_C`. `StaticLoadClass` expands this internally;
`LoadObject<UClass>` does not.

If an MCP tool returns "Class not found: /Game/Path/BP_Foo," that's almost
always the missing suffix. Retry with `<path>.<asset>_C`.

### 2.3 Async asset operations don't block

MetaHuman texture downloads, asset compilation, shader compilation,
derived-data builds, Niagara compile, package save — all async. An agent
that requests "download MetaHuman textures" and immediately reads the
character sees the *previous* texture state, not the new one.

**Patterns:**
- Poll the relevant `Is*Complete` predicate before continuing.
- Subscribe to the completion delegate if the subsystem exposes one
  (`FAssetCompilingManager::Get().GetPostCompilationDelegate()`, etc.).
- For MetaHuman: poll `IsTextureSourceRequestComplete(Character)` after
  `RequestTextureSources`.
- For asset save: don't immediately re-read the package file; let
  `UPackage::SavePackage` complete first.

### 2.4 Save before reading from disk

Many "dump" / "serialize" operations read the asset from its `.uasset`
package on disk. If the most recent edits are in-memory only, the dump
returns the pre-edit state. Save explicitly between mutate and read, or use
an in-memory-aware introspection path if the server provides one.

### 2.5 `PostEditChangeProperty` is required after direct property writes

`Property->CopyCompleteValue(Dest, Src)` writes the value but doesn't fire
`PostEditChangeProperty`. Any derived state set up by the object's
`PostEditChangeProperty` handler — preview meshes, generated thumbnails,
recompiles, dependent properties — won't update. Notify it manually:

```cpp
FPropertyChangedEvent ChangeEvent(Property, EPropertyChangeType::ValueSet);
Object->PostEditChangeProperty(ChangeEvent);
```

The Details panel will show the new value either way, but the object's
behaviour won't reflect it until the event fires.

### 2.6 Blueprint graph mutations need three steps, not one

To safely add a node to a `UEdGraph`:

1. Construct the node (`NewObject<UEdGraphNode>(Graph)`).
2. `Graph->Nodes.Add(NewNode)`.
3. `Graph->NotifyGraphChanged()`.

Single-call helpers in some bindings do step 1 only and leave the graph in
an inconsistent state — the node exists but the editor's pin-resolution +
compile pipeline doesn't see it. Symptoms: phantom "missing node" errors at
compile, broken connect operations, or nodes that vanish after editor
reload.

### 2.7 Enum-string resolution has three accepted forms

UENUM-defined enums store their entries as fully-qualified FName forms
like `EAutoExposureMethod::AEM_Manual`. `UEnum::GetValueByNameString`
matches the fully-qualified form, but bare short names (`AEM_Manual`) and
the Python-binding casing the `unreal` module exposes (`AEM_MANUAL` from
`unreal.EAutoExposureMethod.AEM_MANUAL`) silently miss — those are the
forms agents most naturally reach for, especially when copying values
out of `dump_post_process_settings` output or Python docs.

A 3-step resolver covers the common cases:

```cpp
int64 ResolveEnumValue(UEnum* Enum, const FString& Name)
{
    if (!Enum) return INDEX_NONE;
    int64 Val = Enum->GetValueByNameString(Name);            // EEnumType::ShortName
    if (Val != INDEX_NONE) return Val;
    Val = Enum->GetValueByName(FName(*Name));                // FName lookup
    if (Val != INDEX_NONE) return Val;
    const int32 N = Enum->NumEnums();                        // case-insensitive
    for (int32 i = 0; i < N; ++i)                            // suffix-after-::
    {
        FString EntryName = Enum->GetNameStringByIndex(i);
        int32 ColonPos = INDEX_NONE;
        if (EntryName.FindLastChar(TEXT(':'), ColonPos))
            EntryName = EntryName.RightChop(ColonPos + 1);
        if (EntryName.Equals(Name, ESearchCase::IgnoreCase))
            return Enum->GetValueByIndex(i);
    }
    return INDEX_NONE;
}
```

Affects every reflection-driven property setter that accepts enum-typed
JSON strings (`FEnumProperty`, `FByteProperty` whose `Enum` field is
populated, properties resolved via `StaticEnum<...>()`). The 1-step form
`Enum->GetValueByNameString(Name, EGetByNameFlags::CaseSensitive)` is
the most fragile — it rejects everything except the fully-qualified
form. The fallback chain trades a tiny scan cost (enums rarely have more
than a few dozen entries) for actually accepting the strings callers
pass in.

The same pattern applies on the agent side: when calling an MCP tool
that takes an enum-named string, prefer the C++ short form
(`AEM_Manual`) — it's accepted by every resolver that follows even
minimal best practice; the Python-binding uppercase form may not be.

**When resolution misses, list the valid values in the error.** Returning
`"unsupported type or value coercion failed"` and nothing else forces the
caller to grep engine source for the enum's entries. The same
`NumEnums()` / `GetNameStringByIndex()` iteration that backs the
case-insensitive fallback also gives you the discovery surface — trim
each entry to its short name (after the last `::`), skip the
auto-generated `_MAX` terminator, and join the rest into the error
string:

```cpp
TArray<FString> ValidNames;
const int32 N = Enum->NumEnums();
for (int32 i = 0; i < N; ++i)
{
    FString EntryName = Enum->GetNameStringByIndex(i);
    int32 ColonPos = INDEX_NONE;
    if (EntryName.FindLastChar(TEXT(':'), ColonPos))
        EntryName = EntryName.RightChop(ColonPos + 1);
    if (EntryName.EndsWith(TEXT("_MAX")))
        continue;
    ValidNames.Add(EntryName);
}
// "Could not apply 'X' (enum EAutoExposureMethod). Valid values:
//  AEM_Histogram, AEM_Basic, AEM_Manual. (Case-insensitive; C++ short
//  name, not Python display name.)"
```

The error message becomes self-documenting: any agent that calls the
tool with an invalid string immediately sees the valid set in the
response. No round-trip through engine source. This pairs naturally
with the resolver above — same iteration, same `_MAX` filter, used for
discovery instead of resolution.

### 2.8 Actor "properties" may live on the RootComponent, not the AActor

A reflection-driven property setter that only walks `Actor->GetClass()`
silently misses the properties that look actor-level in the editor but
are actually stored on the RootComponent (a SceneComponent). The
member-of-component set includes `Mobility`, `bHidden`, `bVisible`,
`RelativeLocation`, `RelativeRotation`, `RelativeScale3D`, `AreaClass`,
and the other SceneComponent transform/visibility fields.

The failure mode is hostile: the setter returns success-shaped (the
property *name* is real, and the JSON value coerced cleanly), the call
log shows `"property_name": "Mobility", "applied": true`, but a
follow-up read returns the old value. There's no error, no
deprecation warning, no typo suggestion — just a write that went into
the void because the writer aimed at the wrong UObject.

**Fix:** when the property isn't found on `Actor->GetClass()` and the
caller didn't pin a specific component, fall back to the RootComponent's
class:

```cpp
UClass* TargetClass = Actor->GetClass();
void*   TargetPtr   = Actor;

FProperty* Prop = TargetClass->FindPropertyByName(*PropertyName);
if (!Prop && Actor->GetRootComponent())
{
    USceneComponent* Root = Actor->GetRootComponent();
    if (FProperty* RootProp = Root->GetClass()->FindPropertyByName(*PropertyName))
    {
        Prop        = RootProp;
        TargetClass = Root->GetClass();
        TargetPtr   = Root;
    }
}
```

**Surface which container actually received the write in the response**
(`target_object: "Actor" | "<ComponentName>"`). Without that hint, a
caller debugging "why didn't the mobility change?" has no clue whether
the fallback fired or whether the original Actor-level write succeeded
on a same-named property. The silent-magic failure mode is worse than
the original wart — the call now appears to work but you can't tell
where the change landed.

The same pattern applies to other SceneComponent-resident sets — light
intensity / color on light components, mesh on StaticMeshComponent, etc.
Those usually have explicit component-targeting parameters in MCP
surfaces, so the silent-miss mode there is rarer, but the fallback is
the right default for any property setter accepting an actor name
without an explicit component scope.

### 2.9 A mutation without `Modify()` isn't "undoable but with one field missing" — it's not in the undo history at all

`FScopedTransaction` wraps a block of editor code as one undo step, but the
transaction only actually *contains* an object if that object's `Modify()`
was called before it changed. An empty transaction — every object in scope
mutated via a raw setter or direct `FProperty` write that skipped `Modify()`
— is discarded as transient rather than pushed onto the undo stack
(verified against UE 5.8's `EditorTransaction.cpp`). The failure mode isn't
"Ctrl+Z reverts everything except this one field" — it's "Ctrl+Z does
nothing at all for this entire edit," with no error and no indication
anything was skipped. A human editing the same property through the
Details panel gets a working undo step for free (the panel's property
handle calls `Modify()` for you); a tool that reaches past the UI and
writes the property directly does not, unless it calls `Modify()` itself.

**The rule: call `Modify()` on the object *before* the mutation, not
after** — it snapshots pre-mutation state, so calling it post-hoc records
nothing useful.

```cpp
// Wrong: SetMobility doesn't call Modify() itself, so this mutation
// never enters the transaction — Ctrl+Z after this silently does nothing.
RootComponent->SetMobility(EComponentMobility::Movable);

// Right:
RootComponent->Modify();
RootComponent->SetMobility(EComponentMobility::Movable);
```

For a transform-style write that touches both the actor and its root
component, `Modify()` both — matching whichever object's state the engine
actually reads back on undo:

```cpp
Actor->Modify();
Actor->GetRootComponent()->Modify();
Actor->SetActorTransform(NewTransform);
```

**Not every mutator needs this.** High-level engine entry points that are
themselves undo-aware self-record when a transaction is active — `UWorld::
SpawnActor` and `AActor::Destroy()` both record into `GUndo` automatically
(verified in engine source), so wrapping a spawn/destroy in an outer
`FScopedTransaction` needs no extra `Modify()` call. The gap is specifically
low-level setters (`SetMobility`, `SetIntensity`, a generic reflected
`FProperty` write via `ImportText_Direct` / `CopyCompleteValue`) that
mutate state directly without going through an undo-aware wrapper.

**If you're auditing an existing surface for this bug, look for "it built,
it ran, the response said success" as the tell** — this is not a crash or
an error-returning bug, so it never shows up in normal QA. The only way to
catch it is to explicitly test Ctrl+Z (or the transaction system's
equivalent) after every mutating call and confirm the *specific* property
you changed actually reverts — not just that undo doesn't crash.

---

## 3. UE5 stability — actions that crash the editor

These are crashes that hit any agent driving the editor, regardless of MCP
server. Worth knowing before you do them.

### 3.1 Don't delete or modify assets that other actors reference

Deleting (or transforming) a mesh asset while level actors reference it
triggers a `RegisteredElementType` assertion crash. The editor goes down
and any unsaved work in other windows is lost.

**Safe pattern:** before deleting, walk the asset dependency graph. Most
MCP servers expose this (`get_asset_references` or similar). If anything
depends on the asset, create a new replacement asset, swap actor references
to it, then delete the original.

### 3.2 Don't spawn-then-immediately-delete actors in quick succession

Same `RegisteredElementType` assertion. Spawn → delete → focus in rapid
succession (sub-frame timing) corrupts the actor registry. Add a small
delay or interleave with other operations.

### 3.3 Niagara assertions and MetaSound crashes wipe unsaved changes

When Niagara or MetaSound asserts during PIE, the editor reverts to the
last on-disk save. Custom nodes, in-memory tweaks, and uncompiled edits are
gone. **Save before every PIE test** for these subsystems. Pattern after a
crash: restart editor, dump the asset, recreate the lost nodes from the
dump.

### 3.4 MetaSound: scalar literal on an Audio-type pin

Setting a float (or other scalar) literal directly on a pin typed as
`Audio` crashes the editor at **runtime**, not at edit time. The edit
succeeds silently; the crash fires when PIE starts and the graph
evaluates. The stack signature is:

```
bExpectsNone [MetasoundDataFactory.h:395]
```

**Rule:** Audio-type pins expect audio buffer connections, not scalar
values. Don't pipe a Multiply (Audio) directly from a Constant; route it
through an Oscillator or noise source that produces an audio-rate buffer.

After this crash, all custom MetaSound nodes are wiped on next editor
launch — only `OnPlay`, `OnFinished`, and `Output` survive.

### 3.5 Editor sprite icons are not particles

Editor viewport screenshots include sprite icons for each component
(NiagaraComponent, AudioComponent, etc.). They look like particles but are
the editor's UI overlay, not the actual VFX. **Editor screenshots are not
reliable verification for live Niagara behavior.** Verify by:

1. Reading `is_active: true` off the Niagara actor after spawn.
2. Entering PIE and screenshotting the running game viewport.
3. Or using pixel streaming for real-time visual confirmation.

---

## 4. Identifier and path conventions

### 4.1 Actor labels are not stable identifiers

`a.get_actor_label()` returns the display string shown in the Outliner. Two
actors can share a label. The label is user-editable.

Use the actor's **full path** as the stable identifier:

```
/Game/Maps/Level.Level:PersistentLevel.BP_Character_C_0
```

Most MCP servers accept either, but the path is the only form that
survives renames and disambiguates duplicates.

### 4.2 Asset path forms

UE5 accepts three forms for an asset, and they mean different things:

| Form | Example | What it loads |
|---|---|---|
| Package name | `/Game/Foo/Bar` | The package (used by the asset registry) |
| Package.Asset | `/Game/Foo/Bar.Bar` | The primary asset within the package (`LoadObject<UObject>`) |
| Package.Asset_C | `/Game/Foo/Bar.Bar_C` | The generated class of a Blueprint (`LoadObject<UClass>`) |

If a tool returns a path-not-found error, check that the form matches what
the tool expects.

### 4.4 OBJ import mirrors Y (and applies no up-axis conversion)

The FBX/OBJ factory reads an `.obj` as Z-up but converts handedness by **negating Y**: a vertex
written `v x y z` lands at UE `(x, -y, z)`. X and Z are untouched, so a mesh that is symmetric in
Y looks perfectly correct and a mesh that is not comes in mirrored across the X axis - a terrain
whose hills should be north ends up with them south, while every flat area still sits where you
expect. Write `v x -y z` and flip the triangle winding when generating OBJ for Unreal, and probe a
few asymmetric points after import (trace down where nothing is overhead, compare with the
source). This bites any generated OBJ - terrain, water planes, collision proxies - not only
Thrixel assets, which normally arrive as FBX and are converted there instead (glTF Y-up -> UE
Z-up, glTF Z -> UE Y).

The same importer also **flips the V texture coordinate** (`vt u v` arrives as `(u, 1 - v)`).
That is invisible with an ordinary texture and wrong for any generated mesh that stores data in
UVs: a root-to-tip ramp used as a wind mask comes in upside down, so roots sway while tips stay
pinned, and a base-to-tip colour gradient inverts. Write `1 - v` in the exporter or put a
`OneMinus` after the V mask in the material, and confirm with a close-up.

### 4.3 Widget paths vs widget Blueprint paths

UMG-related tools usually take one of two parameters with similar names:

- `widget_blueprint_path` — path to the WidgetBlueprint asset on disk
  (`/Game/UI/WBP_HUD`)
- `widget_path` — the identifier of a widget *within* a tree, addressing a
  node inside the WidgetBlueprint's hierarchy

A "compile this widget" tool wants the Blueprint path. A "remove this
widget from its parent" tool wants the tree-internal path. Servers vary on
which they expose where — check input schemas before assuming.

---

## 5. UE5 subsystem gotchas

Engine-level facts about specific subsystems. These apply regardless of MCP
server — the underlying UE5 behavior is the same.

### 5.1 Lumen lighting — Movable mobility is mandatory

Lumen Global Illumination only considers lights with **Movable** mobility.
Static and Stationary lights contribute nothing to Lumen GI. Agents that
spawn a DirectionalLight default to Stationary and then complain that GI
isn't working — the fix is to set `Mobility` to `Movable` explicitly.

### 5.2 Blueprint instance override staleness

Level-placed Blueprint instances retain editor-modified component property
overrides even after the parent Blueprint changes. If you edit
`BP_Character` to change `Speed` from 600 to 800, instances of
`BP_Character` placed in the level keep their old override (whatever the
designer or a prior agent set on that specific instance).

**Pattern after any parent BP property change:** walk affected level
instances and either revert overrides to defaults or re-apply the new
value explicitly per instance. The "Reset to Defaults" right-click in the
Details panel does this for humans; for agents, set the property directly
on each instance.

### 5.3 Niagara: created-from-empty systems don't emit

Programmatically constructing a `UNiagaraSystem` from scratch produces a
system that compiles clean but never emits. The empty-system default state
isn't valid for emission (missing system spawn script wiring, missing
emitter mode, etc.).

**Working pattern:** start from a working template. UE ships
`/Niagara/DefaultAssets/DefaultSystem` which has a valid sprite emitter.
Most MCP servers expose an "asset duplicate" tool; use it to duplicate a
working system and then mutate the copy. Don't try to build emitters from
nothing.

### 5.4 Niagara: `script_usage` is part of the module identity

The same module name can appear in multiple script-usage stages:

- `system_spawn`, `system_update` — once per system frame
- `emitter_spawn`, `emitter_update` — once per emitter per frame
- `particle_spawn`, `particle_update` — once per particle

A module named `SpawnRate` typically lives in `emitter_update`. A module
named `Initialize Particle` lives in `particle_spawn`. When setting module
inputs, **always specify `script_usage`** — the same module name in
different stages is a different module instance, and the wrong stage
silently no-ops.

### 5.5 Niagara: user-facing inputs vs script pins

The Niagara stack panel shows "user-facing inputs" — the named tweakable
parameters per module. These are NOT the same as the underlying script's
function-call pins. An agent that reads script pins and assumes they're the
inputs will fail to set values.

**Discovery pattern:** ask for the module's input list before setting
anything. Servers usually expose this as `list_module_inputs` or
equivalent. The returned names are what `set_*_module_input` expects.

### 5.6 Niagara: dynamic input setting is broken in many versions

`set_niagara_dynamic_input` (or equivalent) typically fails with:

```
Failed to load random range script
```

This is a UE5 Niagara API gap, not an MCP-server bug. **Workarounds:** bake
the dynamic value to a constant before assignment, or compute the value in
Python and set the static input.

### 5.7 MetaSound: exact pin names matter

MetaSound pin names are case-sensitive and exact. `SuperOscillator` uses
`Frequency`, `Voices`, `Detune` — not `Base Frequency` or `Freq`. Always
dump the MetaSound's nodes (`dump_metasound_graph` or equivalent) before
setting pins to learn the exact names.

### 5.8 Materials: emissive bloom threshold

Emissive intensity must **exceed 1.0** to trigger bloom in the Post Process
pipeline. Values of 3–10 produce visibly bloomed emissive surfaces. An
emissive material with intensity 0.8 looks dim and self-lit but won't
bloom.

Additional requirement: Post Process Volume must have **Bloom enabled** in
its Effects settings. Default volumes have it on, but an agent that
explicitly disabled bloom for performance won't get emissive bloom either.

### 5.9 Materials: translucent particle materials need Unlit shading

Lit translucent materials require normal vectors. Niagara sprite particles
don't reliably provide normals (the orientation comes from the renderer,
not the geometry). Pattern for particle materials:

- `blend_mode = Translucent`
- `shading_model = Unlit`
- Emissive output, no base color routing

A lit translucent particle material renders as a black/featureless sprite
because the lighting calc has nothing to work with.

### 5.10 Materials: compilation lag

Creating or modifying a material kicks off shader compilation. Depending on
how many permutations the material has (number of materials in the project
using it, light counts, etc.), compilation takes seconds to minutes.
Visual output doesn't update until compilation completes.

**Pattern:** after a material edit, poll for compile completion before
judging visuals. Most servers expose a "get material errors" or "is asset
compiled" predicate; if not, screenshot after a fixed delay (10–30s for
moderately complex materials).

### 5.11 UMG widgets: `CreateWidget` needs an owning player context

A widget created without specifying an owning player context renders blank
at runtime. The widget Blueprint compiles, the instance spawns, and
`AddToViewport` accepts it — but nothing draws because the widget has no
World context to anchor in.

**Fix:** pass `GetPlayerController(0)` as the `Owner` argument to
`CreateWidget` (the Owner pin in the Blueprint node, or the `OwningPlayer`
parameter in the Python `unreal.CreateWidget` call).

### 5.12 In-world widget components need a `WidgetClass`

Adding a `WidgetComponent` to a Blueprint doesn't automatically associate
it with a Widget Blueprint. Set the `WidgetClass` property explicitly —
it's a `TSubclassOf<UUserWidget>` (an FClassProperty), so the value is the
generated class path (`/Game/UI/WBP_HUD.WBP_HUD_C`) or the asset path
(`/Game/UI/WBP_HUD`, which auto-expands).

Default draw mode is screen-space; for a 3D billboard, set the component's
`Space` to `World`.

### 5.13 AudioComponent type name

When adding an audio component to a Blueprint via reflection, the type name
is `Audio`, not `AudioComponent`. Some servers' helpers handle either; raw
reflection lookups don't. Sound asset assignment goes through the `Sound`
UPROPERTY (a `FObjectProperty`); pass the sound asset's path as the value
and the property handler resolves the load.

### 5.14 UltraDynamicSky: override booleans first

The UltraDynamicSky / UltraDynamicWeather plugin uses a "manual override"
pattern. Each weather parameter (rain, snow, wind, etc.) has a companion
`bool` flag named `<Param> - Manual Override`. **The manual override bool
must be set to `true` before setting the parameter value** — otherwise the
plugin's auto-weather logic overrides whatever you set on the next tick.

Other UltraDynamicSky notes:

- Spawn `Ultra_Dynamic_Sky` and `Ultra_Dynamic_Weather` at origin together.
- First spawn triggers 150+ shader compiles; visual output isn't reliable
  until they finish.
- Conflicts with existing DirectionalLights — remove or hide them.
- Rain/snow particles render most visibly in PIE; editor viewport often
  shows the sky but not the particle layer.

### 5.15 Sequencer: extending the playback range doesn't extend track sections

`UMovieScene::SetPlaybackRange(...)` updates the scene's logical playback
range, but per-track sections (created by `AddNewCameraCut`, `AddSection`
on a TransformTrack, FloatTrack, etc.) keep their original lengths. The
camera cut track section in particular bounds what Movie Render Queue
actually renders — **MRQ stops at the end of the active camera cut
section regardless of the playback range**. Symptom: a sequence whose
`GetPlaybackRange()` reports 12 s renders only the first 5 s; the
returned image count matches the section length, not the playback range.

After extending the playback range, iterate every track on every binding
and call `SetRange` on every section:

```cpp
const TRange<FFrameNumber> NewRange = MovieScene->GetPlaybackRange();
for (UMovieSceneTrack* Track : MovieScene->GetTracks())                       // master tracks
    for (UMovieSceneSection* Sec : Track->GetAllSections()) Sec->SetRange(NewRange);

if (UMovieSceneTrack* CutTrack = MovieScene->GetCameraCutTrack())             // camera cut
    for (UMovieSceneSection* Sec : CutTrack->GetAllSections()) Sec->SetRange(NewRange);

for (const FMovieSceneBinding& B : MovieScene->GetBindings())                 // per-binding tracks
    for (UMovieSceneTrack* T : B.GetTracks())
        for (UMovieSceneSection* Sec : T->GetAllSections()) Sec->SetRange(NewRange);
```

Symmetrically: shrinking the playback range while leaving sections long
is also a no-op for MRQ (sections still play to their end). If you want
"playback range and sections always match," apply the same loop on every
range mutation. Real-world failure mode: a sequence's playback range and
its camera cut section's range drift over a series of edits and the next
render silently uses whichever happens to be shorter.

### 5.16 Sequencer: channel keys at the same time stack instead of replacing

`FMovieSceneDoubleChannel::AddLinearKey(FrameNumber, Value)` and the
equivalent on `FMovieSceneFloatChannel` append a key to the channel's
time-sorted array even if a key already exists at `FrameNumber`. The
MovieScene tracks both keys as separate entries; on interpolation, the
first-found one can shadow the just-added one — silently producing the
wrong animated value. Re-keying the same time looks like a successful
no-op.

Detect and update in place via the channel's `TMovieSceneChannelData`
wrapper:

```cpp
TMovieSceneChannelData<FMovieSceneDoubleValue> Data = Channel->GetData();
const int32 ExistingIdx = Data.FindKey(FrameNumber);     // exact-frame match
if (ExistingIdx != INDEX_NONE)
{
    TArrayView<FMovieSceneDoubleValue> Values = Data.GetValues();
    FMovieSceneDoubleValue Updated = Values[ExistingIdx];
    Updated.Value = NewValue;                            // preserves tangent / interp
    Values[ExistingIdx] = Updated;
}
else
{
    Channel->AddLinearKey(FrameNumber, NewValue);
}
```

`FindKey` has an optional `InTolerance` parameter (`FFrameNumber(0)` by
default) for inexact matches. The same pattern applies to
`FMovieSceneFloatChannel` / `FMovieSceneFloatValue`,
`FMovieSceneIntegerChannel`, and `FMovieSceneBoolChannel` — each
`Channel->GetData()` returns the matching `TMovieSceneChannelData<T>`
wrapper.

For 3D transform sections specifically, channel-proxy index order is
`[0-2] Translation X,Y,Z`, `[3-5] Rotation X,Y,Z` (where X=Roll, Y=Pitch,
Z=Yaw), `[6-8] Scale X,Y,Z`. All nine channels need the same
set-or-replace treatment when re-keying a transform — there's no
top-level helper that does all nine at once.

### 5.17 Sequencer: save the sequence package before MRQ re-reads it

Movie Render Queue's PIE executor re-loads the level sequence package
from disk when it spawns PIE. In-memory edits to the `MovieScene`
(playback range changes, transform keys, camera bindings, sub-sequences,
etc.) that haven't been flushed to disk via `UPackage::SavePackage` are
lost — the render uses the stale on-disk version even though
`LoadObject<ULevelSequence>(SeqPath)` returns the in-memory copy. The
result is a successful-looking render that doesn't reflect the most
recent edits.

This is a sequence-asset specialisation of the general "save before
reading from disk" rule (see §2.4) — MRQ counts as a from-disk reader
because the PIE world it spawns reloads the sequence asset fresh. Save
the sequence's outermost package before kicking the render:

```cpp
UPackage* SeqPkg = Seq->GetOutermost();
if (SeqPkg && SeqPkg->IsDirty())
{
    const FString Filename = FPackageName::LongPackageNameToFilename(
        SeqPkg->GetName(), FPackageName::GetAssetPackageExtension());
    FSavePackageArgs Args;
    Args.TopLevelFlags = RF_Public | RF_Standalone;
    Args.SaveFlags = SAVE_NoError;
    UPackage::SavePackage(SeqPkg, Seq, *Filename, Args);
}
```

Same hazard applies to any authoring → MRQ chain where the on-disk state
diverges from the in-memory state — camera cuts, sub-sequence bindings,
shot tracks, etc. Saving the level alone (`FEditorFileUtils::SaveCurrentLevel`)
does not cover this; `/Game/...` sequence assets live in their own
packages.


### 5.18 Character push launches light physics props

`CharacterMovementComponent` defaults are tuned for crates: `PushForceFactor = 750000` with
`bPushForceScaledToMass = false`. A 0.1-0.4 kg prop touched by the player receives that full
force, leaves the room in one frame and can tunnel through the floor - it reads as "the toy
disappeared when I touched it". On the character class defaults (`<CDO>.CharMoveComp`, flat
properties that `set_properties` does write):

| Property | Default | Light-prop value that worked |
|---|---|---|
| `bPushForceScaledToMass` | false | true |
| `pushForceFactor` | 750000 | ~1800 |
| `initialPushForceFactor` | 500 | ~160 |
| `maxTouchForce` | 250 | ~60 |
| `repulsionForce` | 2.5 | ~0.6 |

On the prop: simple convex collision (`StaticMeshTools.generate_convex_collisions`), and in
BeginPlay `SetCollisionProfileName "PhysicsActor"`, `SetMassOverrideInKg`, some linear and angular
damping, `SetUseCCD true`, then `SetSimulatePhysics true` (nested body settings cannot be set
through MCP properties). Set `canCharacterStepUpOn = ECB_No` on the prop's mesh component,
otherwise the pawn climbs onto small props and logs
`LogCharacterMovement: ... is stuck and failed to move`.

### 5.19 Look-at interaction when several targets are in range

Per-actor "player is near, show a prompt, enable input" breaks down as soon as two interactables
overlap: prompts draw on top of each other, and because key events consume input only the actor
that enabled input last receives the key. A pattern that holds up without a central manager:

- Each interactable computes a **focus score** every tick: inside its radius, take the dot of the
  camera forward vector with the direction to the part's bounds centre
  (`GetComponentBounds`), compare against a **per-instance** threshold, and normalise
  (`(dot - threshold) / (1 - threshold)`, or -1 when it does not qualify). Thresholds that worked:
  ~0.985 for stacked drawers 20 cm apart, ~0.95 for doors, ~0.93 for tall cupboards. One fixed
  cone either catches three drawers at once or misses low furniture from standing height.
- It publishes the score through a small function and yields if any other interactable scores
  higher (`GetAllActorsOfClass`, a dozen actors is cheap). Only the winner shows its prompt and
  calls `EnableInput`; everyone else hides and calls `DisableInput`.
- Proximity-only prompts (no aiming) yield whenever any aimed interactable qualifies at all.
- Keep class references one-way (A reads B's score, B never reads A's) to avoid circular
  Blueprint dependencies; let the less specific target do the yielding.

---

## 6. MCP transport requirements

### 6.1 Accept header on Streamable HTTP

Servers implementing MCP 2025-03-26 Streamable HTTP generally require both
content types in the Accept header:

```
Accept: application/json, text/event-stream
```

Omit it and the server returns `406 Not Acceptable`. Most MCP clients
(Claude Desktop, Cursor, VS Code's MCP UI, Epic's EDA panel) set this
automatically. Raw `curl` does not — pass
`-H 'Accept: application/json, text/event-stream'` when testing manually.

### 6.2 Image content blocks

MCP supports an `image` content block alongside `text`:

```json
{
  "content": [{
    "type": "image",
    "data": "<base64-encoded PNG>",
    "mimeType": "image/png"
  }]
}
```

The decoded bytes start with `\x89PNG\r\n\x1a\n`. Most MCP clients render
images inline in the chat UI. UE5 servers commonly use this for editor
viewport / PIE / depth captures.

### 6.3 Cancellation

MCP 2025-03-26 defines `notifications/cancelled` with a `requestId`
parameter. Whether it actually aborts an in-flight tool call is
server-dependent — synchronous servers can't interrupt themselves
mid-execution. Don't depend on cancellation working unless the server
documents support.

### 6.4 Sessions

Servers that implement the `Mcp-Session-Id` header expect clients to echo
it back on subsequent requests in the same session. The server mints a
fresh ID if the request arrives without one. Sessions usually expire on
idle timeout — re-send `initialize` if the server returns "unknown
session."

---

## 7. Python ↔ MCP data channel

UE's Python interpreter is reachable from most MCP servers via a console
command (`py <code>`) or a dedicated `execute_script` tool. Python is the
right hammer for:

- Bulk asset operations where the MCP surface lacks a vectorised tool
- Niagara parameter manipulation when the dynamic-input path is broken
- Sequencer batch edits
- Anywhere the agent needs N+1 operations that depend on each other and a
  round-trip per dependency would be expensive

**Critical limitation:** Python's `print()` and stdout go to the UE log,
not back to the MCP client. The agent that ran the script can't see what
it produced.

**Workaround — Actor Tags as a data channel:**

```python
import unreal
result = "...whatever the script produced..."
note = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.Note, unreal.Vector(0, 0, 9999)
)
# Keep tags short — UE truncates very long tag strings on save.
note.tags = [result[:200]]
```

Read back via MCP: query the Note actor's properties and inspect `tags`.
Delete the Note actor after. Spawn a fresh actor for each result — stale
actors return stale tags.

For larger payloads, write to a known file under `Saved/Logs/` or
`Saved/AgentScratch/` and read it back via the MCP server's file-read tool
(if available).

**Server-side Python execution alternative:** some MCP servers expose
`execute_script` (or similar) that captures the return value of a `run()`
function directly into the response. If your server has this, prefer it —
the data-channel workaround becomes unnecessary.

---

## 8. Patterns for MCP server authors targeting UE5

If you're building an MCP server against the UE5 editor, the following
patterns have proven valuable in practice. None are required by the MCP
spec — they're hard-won pragmatic recommendations.

### 8.1 Schema-in-error self-correction

When a tool call fails input validation, return the tool's full input JSON
Schema inline in the error text. The LLM caller reads the schema, fixes
the argument, and retries. Saves 3–5 round-trips per error compared to a
bare "Invalid argument" message.

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Validation failed: 'body_type' must be one of [Skinny, Athletic, Heavyset]. Full schema:\n\n{...inputSchema JSON...}"
  }]
}
```

### 8.2 Output schema as authority

Ship an `outputSchema` for every introspection / read-only tool. Fields in
the schema are guaranteed to appear; additional metadata fields may also
appear but aren't promised. Clients can parse responses against the schema
instead of guessing field names.

### 8.3 Continuation tokens for large responses

UE5 asset dumps can run hundreds of KB. MCP clients vary on how they
handle large `text` content. Pattern: cap response text at N bytes (64KB
is a reasonable default), stash the remainder under an opaque token,
return token + first chunk + `_remaining_chars` so the client knows
there's more. Expose a `continue_response(token, max_bytes)` tool to fetch
the next chunk.

### 8.4 `FScopedTransaction` for mutating tools

Wrap every UPROPERTY write, asset edit, level mutation, or Blueprint graph
change in `FScopedTransaction`. Ctrl+Z in the editor then reverts the
agent's change — critical for user trust. Losing the undo path is the
fastest way to make agents feel scary to work with.

### 8.5 Lazy tool registration for large surfaces

If your server exposes 200+ tools, the default `tools/list` response can
overwhelm small-context-window clients. Pattern: split the surface into
categories, default `tools/list` to a small set of meta-tools
(`list_categories`, `describe_category`, `load_category`) plus a few
always-on essentials, and load full categories on demand. Use
`notifications/tools/list_changed` to signal subscribers when the visible
surface changes.

### 8.6 Game-thread discipline

Slate operations, viewport rendering, asset operations, and Python
execution must all run on the game thread. MCP requests typically arrive
on a worker thread; dispatch the actual work back to the game thread via
`AsyncTask(ENamedThreads::GameThread, ...)` and signal completion via a
`TPromise` or similar. `check(IsInGameThread())` defensively before any
Slate / viewport call.

### 8.7 Recursion-cap the dumpers

Asset structures can contain cycles (Blueprint references, Material
Functions, Sound Cues with self-referential branches). Always cap
recursion depth (1024 is a safe default for graph walks). Always cap
output size before returning. Always opportunistically GC any per-tool
caches.

### 8.8 `.uplugin`'s `"Optional": true` describes a build-time relationship, not a runtime one — and doesn't survive contact with a data symbol

If your MCP-server plugin wraps a big optional engine subsystem (Niagara,
GameplayAbilities, MetaHuman, Mutable/CustomizableObject, MovieRenderPipeline)
so it builds clean whether or not that subsystem is enabled, the standard
recipe is: reference it in `.uplugin` with `"Optional": true`, gate the
`Build.cs` dependency behind a plugin-presence check, and `#if`-guard the
code that uses it. That recipe closes the build-time gap. It does **not**
by itself close the runtime gap.

**The trap:** if the optional plugin *was* present when you built, your
binary now hard-links against it — `"Optional": true` only told UBT "don't
fail the build if this is absent," it did not make the resulting `.dll`'s
imports soft. Drop that binary into a project where the optional plugin is
disabled and the OS loader fails to resolve those imports at mount time
(`GetLastError=126` on Windows), with no useful diagnostic pointing at
which optional dependency is the culprit.

The standard fix is `/DELAYLOAD` (MSVC) — defer resolving the DLL's
imports until first actual use, so a build that never calls into the
optional module never needs to load it. This works cleanly for **function
calls**. It does **not** work for direct references to an **exported data
symbol** — a global `UClass*`, a `static const FName`, an `extern` in the
optional module's headers — because `/DELAYLOAD` indirects function calls
through a thunk it generates, but a data-symbol reference compiles to a
direct memory address that has to be resolved at link time; there's no
thunk mechanism for it. If your `#if`-guarded code touches one of those
instead of exclusively calling functions, the linker fails outright
(MSVC LNK1194-class error) even with delay-loading correctly configured —
and the fix isn't "configure delay-loading harder," it's "don't reference
the data symbol at all outside the guard, or wrap access to it behind a
function the optional module itself exports."

**Practical rule:** before assuming `"Optional": true` + delay-load has
made a dependency fully soft, audit every symbol your `#if`-guarded code
touches from the optional module and confirm none of them are exported
globals/statics — function-only access is the only shape `/DELAYLOAD`
actually covers. And test runtime disable, not just build success —
"builds clean without the plugin present" and "loads clean in a project
where the plugin is present-but-disabled" are two different claims, and
only the second one is what an end user actually hits.

### 8.9 macOS: a too-minimal test project can hard-crash a `LoadingPhase: Default` editor plugin on `!AreShaderTypesInitialized()`

A freshly-built editor plugin, dropped into a deliberately minimal test
project (a handful of actors, few other plugins enabled) and launched, can
crash before the UI ever appears:

```
Assertion failed: !AreShaderTypesInitialized() [File:.../RenderCore/Private/Shader.cpp]
Shader type was loaded too late, use ELoadingPhase::PostConfigInit on your
module to cause it to load earlier. This shader will not be compiled or function.
```

Stack: a shader type's static registration, triggered by `dlopen()` inside
`FModuleManager::InternalLoadLibrary` as your plugin's module loads. **The
specific shader type that faults is not stable across runs** — different
launches of the identical binary can fault on different shader classes
from different engine modules. That instability is the tell: this is a
**load-order race**, not a bad dependency in your plugin.

**The mechanism:** `AreShaderTypesInitialized()` locks at some point during
normal engine startup — any *new* shader-type static registration after
that point is fatal. Renderer/RenderCore dylibs are core engine modules
that are supposed to already be loaded by then. But macOS dylib loading is
lazy — dyld resolves and initializes a library on its first real touch,
not eagerly at process start. In a minimal project with little else
forcing those dylibs open early, a plugin module loading at `Default`
phase can be the *first* thing that ever triggers `dlopen()` on one of
them — and whichever shader-owning dylib that happens to pull in registers
its shader types right then, after the lock, and asserts. Which dylib it
is (hence which shader type faults) depends on link order and symbol
resolution timing.

**What does NOT fix it** (both testable via `.uplugin`-only edits — no
rebuild needed, `LoadingPhase` is read from the manifest at mount time):
- `LoadingPhase: "PostConfigInit"` (the phase the assert message itself
  recommends) moves the crash **earlier** instead of fixing it if your
  module's `StartupModule()` touches the UObject/package system — at
  `PostConfigInit` that system isn't up yet, and you get a *different*
  fatal error (`Object is not packaged`) instead.
- `LoadingPhase: "PreDefault"` (one phase earlier than `Default`) lands
  back in the identical shader-type race. If a safe window exists between
  "UObject system ready" and "shader types locked," it isn't reachable
  through a simple `ELoadingPhase` value.

**What did fix it:** use a normal-structured test project instead of the
leanest possible one — real content, several other plugins already
enabled. That's enough to force the Renderer/RenderCore dylibs open
through the engine's own normal startup path before your plugin's
`Default`-phase module load ever gets a turn, so the race never triggers.
Counterintuitively, the "more realistic" project is the *safer* smoke test
here, not the minimal one — don't use a deliberately empty project to
smoke-test a macOS editor plugin; the minimalism itself is what exposes
this class of crash.

**Related gotcha hit while chasing this:** a command-line `-ini:` override
targeting a `UDeveloperSettings` class with `config=EditorPerProjectUserSettings`
can be silently ignored — the editor boots fine and the override simply
doesn't apply, with no error. If a runtime setting you overrode via `-ini:`
doesn't seem to have taken effect, verify the *actual* value from a log
line or a live read-back before concluding the editor failed to start —
it may have started completely normally on the un-overridden default.

---

## 9. Patterns for MCP clients (agents)

### 9.1 Cache `tools/list` once per session

Tool surfaces are stable within a session. Cache the response on connect.
Polling mid-session wastes round-trips and can confuse cancellation logic.

### 9.2 Parse against `outputSchema` when present

If the server publishes output schemas, validate against them instead of
guessing field names. Saves debugging cycles when an agent assumes a field
exists that doesn't, or doesn't notice a new field appearing in a later
version.

### 9.3 Always verify writes

UE5 has too many silent-fail edges to trust a successful response. The
full pattern:

1. Issue the write.
2. Issue a read of the same state.
3. Compare to what you asked for.
4. If they differ, re-examine (snake_case? wrong enum form? async-deferred?).

Verify-after-mutate is the difference between an agent that works 80% of
the time and one that works 99%.

### 9.4 Treat `isError: true` as load-bearing

The MCP spec specifies tool errors return `isError: true` with the error
text in `content[0].text`. Servers may also return JSON-RPC transport-level
errors with the `error` field at the top level. Both need handling; both
contain debugging info worth reading.

### 9.5 Don't chain a read after a write without saving

If a tool dumps an asset from disk, the dump reflects the on-disk state.
If you just mutated the asset in memory and haven't saved, the dump shows
the pre-mutation state. Save explicitly between mutate and dump if you
need the current state.

---

## 10. UE 5.7 vs 5.8 — engine-level differences

These affect any agent driving UE5 across engine versions, regardless of
MCP layer.

### 10.1 MovieRenderGraph is 5.8-only

`UMovieGraphConfig`, `UMovieGraphPipeline`, and graph-based rendering
composition land in 5.8. UE 5.7 has MovieRenderQueue
(`UMoviePipelineQueueEngineSubsystem`) but no graph composition layer.

### 10.2 `FJsonObject::Values` key type change

`FJsonObject::Values` is `TMap<FString, ...>` on 5.7 and
`TMap<UE::FSharedString, ...>` on 5.8. Affects native C++ iteration;
doesn't affect Python or JSON-over-the-wire usage.

### 10.3 PathTracer setting surface

Several PathTracer settings migrated from CVar-only to UPROPERTY on
`UPostProcessVolume` in 5.8. An agent that sets them via console commands
works on both engines; one that sets them via reflection on the
post-process volume needs 5.8.

### 10.4 Epic's official `ModelContextProtocol` plugin is 5.8-only

Epic's MCP plugin ships in UE 5.8 (experimental). UE 5.7 users running an
agent against the editor need a third-party MCP server.

### 10.5 Niagara editor module split

UE 5.8 reorganised some Niagara editor APIs into a `NiagaraStackEditor`
module. Tools that introspect Niagara stack issues need to depend on the
right module on each engine version.

---

## 11. Asset structure quick reference

What gets serialized when common UE5 assets are dumped to JSON. Useful for
parsing responses regardless of which server produced them. This isn't an
exhaustive schema — see Epic's UE docs for the authoritative structure.

### Blueprint

- `UbergraphPages` — event graphs plus auto-generated wrappers
- `FunctionGraphs` — user-defined functions
- `DelegateSignatureGraphs` — dispatcher signatures
- `MacroGraphs` — user macros (if any)
- `Variables` — name, type, default value, `CategoryName`, `RepNotifyFunc`
- `Components` — SimpleConstructionScript root + AddedComponents
- `ParentClass`, implemented interfaces, compile state

### Niagara System

- `SystemSpawnScript` / `SystemUpdateScript` — system-level VM scripts
- `EmitterHandles` — per-emitter wrapper (Enabled, LocalSpace, EmitterMode)
- `UserParameters` — parameters exposed to the component for runtime tuning
- Per-emitter: `SpawnScript` / `UpdateScript` / `RenderScript` stacks,
  modules per stack, renderer settings

### Material

- `Expressions` — `UMaterialExpression*` nodes (one per node in the graph)
- Connections — input pin → output pin pairs
- `ScalarParameterValues`, `VectorParameterValues`, `TextureParameterValues`
- `ShadingModel`, `BlendMode`, `MaterialDomain`

### Level

- `Actors` — array of actor entries with name, class, transform, components
- `WorldSettings` — game mode, level scripts, navmesh settings
- `Streaming` — sublevels and their state (loaded / visible / unloaded)

### Sequencer (`ULevelSequence`)

- `MovieScene` — root scene
- Tracks — per binding: TransformTrack, FloatTrack, EventTrack, etc.
- Sections per track — start/end frame, evaluation type, easing

### Widget Blueprint

- `WidgetTree` — hierarchy of widgets (root, panels, leaf widgets)
- Per-widget: `Slot` properties (depend on parent panel type),
  variable-or-not flag, accessibility text
- `BindingClass` — MVVM viewmodel class (if any)

---

## 12. Anti-patterns

### 12.1 Don't pass actor labels as identifiers

Two actors can share a label. The label is user-editable. Use the full
path.

### 12.2 Don't poll `tools/list` mid-session

Tool surfaces are stable per session. Cache once on connect.

### 12.3 Don't assume tool surface parity across servers

Two MCP servers against UE5 will have different tool catalogues, different
parameter names for similar concepts, and different output shapes. Always
read `tools/list` to discover what's actually exposed before assuming a
tool exists.

### 12.4 Don't ignore `isError: true`

The error message is usually load-bearing. Schema-in-error servers put the
input schema right in there.

### 12.5 Don't chain reads after writes without a save (or explicit in-memory mode)

Most introspection tools serialize from disk. Mutation without save is
invisible to those tools.

### 12.6 Don't assume async operations completed

Texture compile, Niagara compile, shader compile, asset save, package
compile — all async. Poll completion or wait on the relevant delegate
before continuing.

### 12.7 Don't delete a referenced asset

Check `get_asset_references` (or equivalent) first. Deleting referenced
meshes/materials crashes the editor with `RegisteredElementType`.

### 12.8 Don't connect scalar nodes to Audio-typed pins in MetaSound

Runtime crash. Use audio buffer sources (Oscillators, Noise) into Audio
pins. Scalar math (Multiply, Add) on the audio path goes through Audio
variants of those nodes, not the float variants.

### 12.9 Don't destructively rewrite committed config to toggle sim vs device

A script that flips `.ini` settings in place to switch a UE5 visionOS/AVP project between the
Simulator and a real device makes the repo stateful — easy to cook the wrong target, dirties
tracked files, and invalidates caches for a bigger recompile than necessary. Carry the delta in
the **build command** instead: build arch (`-clientarchitecture=iossimulator` for sim, arm64 for
device), code-signing team, install method (`simctl` vs `devicectl`), and a METAL_SIM shader cook
flag (`-ini:...:bEnableSimulatorSupport=True`, sim only) as `-ini:` overrides passed to
`BuildCookRun`. The committed render config never changes. Reference implementation
(`ue-avp-build.sh sim|device`) + full rationale: AgileLens internal KB,
`intelligence/techniques/ue-visionos-sim-device-build-flow.md` (ask the user for a copy if you
don't have KB access).

---

## 13. Reading list

- [MCP specification](https://modelcontextprotocol.io) — protocol-level reference
- [Unreal Engine Python API reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/) — for `unreal.*` module surface
- [Unreal Engine 5 Editor scripting](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python) — Epic's Python guide
- [Niagara documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-niagara-effects-for-unreal-engine) — for Niagara-specific module / parameter concepts
- [MetaSound documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/metasounds-in-unreal-engine) — for audio graph semantics

For server-specific tool catalogues, query the server with `tools/list`.

