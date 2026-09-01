# Roblox

Engine-specific rules for the Roblox path. The shared Thrixel asset pipeline is in
[../../SKILL.md](../../SKILL.md); this file covers only what differs for Roblox.

# Installation and setup
Toolchain install steps are in [setup.md](setup.md). You MUST read this file, and you MUST explain
the steps the user must do on their end, in a plain and simple way, as described in setup.md.

# Rules for Game dev

When developing in Roblox, you MUST set up the following checklist, and verifiably and
rigorously check each off your list:

1) You MUST have Rojo, the Roblox Studio MCP server, AND an Open Cloud API key working. If
   any is missing, stop and set it up per [setup.md](setup.md) before writing game code.
   The API key is the one you cannot work around — it is the only scriptable way to get a
   mesh into Roblox.
2) All scripts and instance trees MUST be authored as files on disk and synced through
   Rojo. Meshes are the exception and cannot be: they live in the place file, in a folder
   deliberately OUTSIDE the Rojo-managed tree (see "The Rojo boundary").
3) You must FREQUENTLY verify the scene through `screen_capture`, from at least 10 angles,
   passing explicit `camera_position` / `look_at_position` and disabling other cam logic.
4) You must follow EVERY step in the Thrixel asset import inspect loop (below).
5) You MUST run the play mode verification loop multiple times (below).
6) Mostly avoid organic animation. Animate through code. Avoid humanoids and animals
   beyond the default player character.
7) Write Luau, not Lua. Respect the client/server split: `ServerScriptService`,
   `StarterPlayer.StarterPlayerScripts`, `ReplicatedStorage`.
8) **Measure before you correct.** Roblox has several APIs that silently do nothing or do
   something else, so a wrong-looking scene is usually not the bug you think. Query the actual numbers with
   `execute_luau` before changing code.

# Perf optimization
Spend only moderate effort on performance optimization. Ensure that the scene has a good balance of Architect and Detailer/Sculptor assets.
Do not measure FPS performance directly. FPS measurements depend on focus status - an unfocused window throttles to 15fps so FPS measurements are unreliable.

# Thrixel assets
Everything to do with importing and processing Thrixel assets for Roblox specifically

# The asset pipeline

Rojo syncs scripts and instance trees. It does **not** sync meshes, textures or audio.
The bridge is Roblox's Open Cloud Assets API:

```
Thrixel  ->  .glb / .fbx  ->  POST apis.roblox.com/assets/v1/assets  ->  assetId
         ->  InsertService:LoadAsset(assetId)  ->  ReplicatedStorage.Assets.<Name>
```

Roblox runs its own server-side 3D importer and returns a `Model` of `MeshPart`s with
textures attached. Round trip is about 15 seconds per asset.

- Endpoint: `POST https://apis.roblox.com/assets/v1/assets`, multipart with a `request`
  JSON field (`assetType: "Model"`, `displayName`, `creationContext.creator.userId`) and a
  `fileContent` file field. Poll `GET /assets/v1/operations/{operationId}` until `done`.
- Auth is `x-api-key`. The key needs the **Assets** API system with **Read and Write**,
  created by the USER at create.roblox.com/dashboard/credentials. You cannot make it for
  them — ask, and ask early, because everything else is blocked on it.
- **Hard 20 MB per file.** A 4096-texture Sculptor asset lands around 5-11 MB, so this is
  reachable. If you exceed it, cut `texture_size` to 2048 or reduce triangles.

**Only the asset IDs cross into the file tree.** Rojo cannot carry a mesh, but it carries
a table of numbers perfectly well. The helper below does exactly this.

## Helper scripts — do not hand-write this pipeline

Two files ship with this skill in [tools/](tools/). Copy `roblox_helpers.py` into the
project's `tools/` and `place.luau` to `src/shared/Place.luau`, then use them as-is.

**`roblox_helpers.py sync`** is the whole upload-and-import pipeline in one command:

```sh
python3 tools/roblox_helpers.py sync > swap.luau   # logs on stderr, Luau on stdout
```

It uploads every new or changed mesh in `thrixel_assets/<Name>/` (content-hash cached —
re-runs never re-upload, and an edited asset uploads as a genuinely new version), rewrites
`src/shared/AssetIds.luau`, and prints one Luau chunk. Run that chunk through a single
`execute_luau` call (`datamodel_type` "Edit"): it inserts missing models into
`ReplicatedStorage.Assets`, replaces stale ones (matched by an `AssetId` attribute), and
sets the plugin-only MeshPart properties (Box collision, anchored, no collide/touch) so
clones inherit them. Both steps are idempotent — re-running is always safe, and the chunk's
per-asset bbox log line is your first look at each import's arrival size.

**`place.luau`** exports `place(template, x, z, rotationDeg, targetStuds, opts?)`: clones
the template, scales its longest bounding-box axis to `targetStuds`, rotates, and sets the
bounding-box bottom-centre down at `(x, opts.groundY, z)`. Pass `bottomCenter = false` to
place by the model's own pivot instead (vehicles with rigs, mount-point props).

## FBX or GLB — this decides whether your assets work

Both upload fine. They lose different things, and neither loss is announced.

| | **FBX** | **GLB** |
|---|---|---|
| Semantic part names | **Preserved** (`Propeller`, `Front_Door`) | **Lost** — renamed after the glTF *mesh* (`Cylinder.013`, `Sphere`) |
| Architect flat colours | **Preserved**, baked to per-material textures | **Lost** — model arrives uniformly grey |
| PBR maps | Albedo only | **Full** `SurfaceAppearance` (Color/Normal/Roughness/Metalness) |

So:

- **Multi-part or Architect-flat assets -> FBX.** This is the only way to keep part names,
  and the only way to use an Architect blockout without paying for a texture pass.
- **Single-mesh Sculptor/Detailer assets -> GLB.** There are no part names to lose and the
  extra maps are the whole reason you generated it that way.

The grey-Architect case is the expensive one to discover: Roblox's glTF importer reads
texture *images* and ignores flat material colour factors, which is all an Architect
blockout has. Uploading Architect GLBs gives you a scene of grey props with no error
anywhere. Either switch that asset to FBX, or run `thrixel_detail_model` /
`thrixel_retexture_model` first so it has real texture images.

**If the MCP download gives you trouble, call the Thrixel API directly.** FBX export runs
as an async conversion job, and the flow is three calls:

```
POST /api/v1/convert            {submission_id, format}  -> job_id
GET  /api/v1/convert/{job_id}                            -> status
GET  /api/v1/convert/{job_id}/download                   -> bytes
```

Auth is `Authorization: Bearer <thrixel key>`. Wait for the job to report done before
downloading, and sanity-check the result: if the first byte is `{`, you got a status body
(e.g. `{"status": "queued", ...}`), not a mesh — the job just isn't finished yet.

## Scale

**Thrixel normalises every export to roughly a unit bounding box.** A 30 m building and a
0.1 m creature both arrive about 1 stud long. Roblox treats 1 glTF unit as 1 stud, so
nothing lands usable and nothing is even consistently wrong.

Do not look for a global multiplier. Declare each asset's true size in metres, and rescale
so its longest axis matches that many studs. A stud is about **0.28 m**, so
`studs = metres / 0.28`. A 7 m vehicle becomes 25 studs; the default character is ~5.
`place()` in [tools/place.luau](tools/place.luau) implements this — declare the target
studs per asset and let it measure and rescale. (FBX arrives ~100× larger than GLB — FBX
declares centimetres, GLB is read as 1 unit = 1 stud — which measure-and-rescale absorbs.)

Scale small creatures and props UP past life size — a true-scale small animal is a fraction
of a stud, invisible from a vehicle and impossible to aim at. Readability beats accuracy.

## Grouping and MeshPart limitations

You MUST group assets. Thrixel returns dozens to hundreds of mesh nodes and Roblox gives each one a `MeshPart`, so a scattered prop instanced forty times ungrouped is hundreds of draw calls.
```
thrixel_group_parts(submission_id=..., keep_groups=[{"name": "Propeller"}], target_triangles=30000)
```
Don't group everything into one node; keep only parts where neccessary:
- Parts that need to be separate for animations
- Parts that need to be specifically addressed in roblox
- Parts that should should have their own texture. Roblox MeshParts have only one TextureID, so doing thrixel_group_parts merges everything into one node, which destroys textures. Instead, a mesh with six materials should have around 6 mesh parts. Do NOT run retexutre just to fix this.


# Roblox APIs that silently do nothing

None of these error. Each one surfaces as a wrong-looking scene instead.

**`PrimaryPart` hijacks the pivot.** Setting `model.PrimaryPart` makes `GetPivot()` return
that part's `CFrame` and makes `WorldPivot` a **no-op**. If the part carries its own
rotation (FBX parts do), the next `PivotTo(CFrame.new(pos))` forces it to identity and
rotates your entire model — a vehicle arriving nose-up looks exactly like a bad export.
**Do not set `PrimaryPart`.** Leave the pivot as `WorldPivot`, set it to the model's bottom
centre so "place on the ground" is one call, and use a helper for "largest part" when you
need somewhere to hang a light or a `ProximityPrompt`.

**`CollisionFidelity` and `RenderFidelity` are plugin-only.** A running game script cannot
write either: it throws `lacking capability Plugin`. Bake them into the templates at edit
time through the MCP server (the `sync` swap chunk does this), and let clones inherit. Box collision on scenery is the single
biggest performance decision in a mesh-heavy scene.

**Part size is capped at 2048 studs per axis.** Larger is silently clamped, not an error.

**Raycasts must exclude the player's character explicitly.** `CanQuery = false` is not
enough: R15 limbs stream in after `CharacterAdded` fires, so late arrivals stay queryable.
In a vehicle game where the character is parked inside the hull, the altitude ray hits its
own torso, concludes the floor is one stud below, and shoves the vehicle upward every frame
until it pins against the ceiling. Put the character in `FilterDescendantsInstances` and
rebuild the list on respawn.

**`CanQuery = false` also makes an object invisible to your own diagnostics.** A ray sweep
checking for occlusion reports empty space wherever the occluding geometry is
non-queryable by design. Flip it on, measure, flip it back.

## Common bugs
List of commonly encountered Studio MCP and roblox dev bug to avoid

**Common bug: stale proxy holding the registration port.** Each session spawns its own `StudioMCP`
proxy, but the Studio plugin finds the proxy through one fixed local port that only a
single process can own — if a previous session's proxy never exited, it keeps the port,
Studio registers with that orphan, and your `list_roblox_studios` truthfully returns
`[]` with no error anywhere. The signature is an empty studio list while Studio is open
plus two `StudioMCP` processes in the process list; the fix is to kill the older one,
after which your proxy binds the port and the plugin reconnects on its own within
~a minute.

**MCP has singificant latency, so batch testing actions into one call and be aware of latency**
The game runs in real time, but mcp tool calls for pressing buttons, moving players, etc, is a separate trip that takes several seconds. To get more acurate inputs, batch the whole maneuver into one call. `user_keyboard_input` takes an ordered action list (key down, wait 1500ms, key down, wait 700ms, key up...), so a complete scripted drive executes at game speed with zero between-step latency. Blind driving, but latency-free.

**Name every GUI container and button at creation time**, e.g. `btn.Name = "StartButton"`. This way you can use Studio MCP's `user_mouse_input` to click a UI element by instance path, and not run into each GUI element having a clashing default name


# Vehicles

Drive the vehicle **kinematically** — own a `CFrame` and write it every frame — rather than
pushing a physics assembly with constraints. Constraint vehicles fight network ownership,
jitter on ping spikes, and need per-part mass tuning that breaks the moment the model is
rescaled. A `CFrame` is exact, and the vehicle is the one object whose feel must be perfect.

Consequences worth knowing:

- Park the player's character at the hull each frame so respawn, the player list and
  `ProximityPrompt` all keep working — prompts fire off the character's position, so this
  is what makes "press E to collect" work from inside a vehicle.
- Hide that character (transparency, `PlatformStand`), and exclude it from raycasts.
- Roblox forward is `-Z`. Steering that aims a heading and lets the hull swing toward it
  reads as a vehicle; snapping the hull to the aim reads as a floating camera.

# Thrixel asset import inspect loop

For EVERY Thrixel asset you bring in, launch an inspection subagent with this exact loop.
Never skip a step. Inspect at two points:

1) When the asset is first imported:
- Check the scale against the player character, in studs.
- Check the facing. Do NOT guess from a screenshot — query it. Print each part's position
  in the model's own frame, and remember that measuring in a frame that rotates with the
  model tells you nothing about world orientation. Roblox forward is `-Z`.
- `screen_capture` from many angles looking for inverted triangles, missing parts, floating
  fragments.
- Confirm it is not grey. A grey model means flat colours were dropped — see FBX vs GLB.

2) When the asset is in game, in play mode:
- Issues appear in play mode that do not show at edit time. Screenshot there too.
- Look for: assets floating off the ground, wrong orientation, meshes flickering, parts
  missing, untextured grey surfaces, lighting blowouts.

# Play mode verification loop

Use `start_stop_play` to enter play mode and drive with `user_keyboard_input` /
`user_mouse_input`. Take at least 5 screenshots throughout. Send each to a harsh critic
subagent; keep building until it agrees the result looks absolutely AAA.

Tell the critic to look specifically for:
- The camera being wrong
- Thrixel assets flickering or missing parts
- Clipping through terrain or scenery
- Untextured or default-grey meshes
- Vehicles facing or driving the wrong way
- Visible world boundaries, horizon seams, or skybox showing through

**Read `get_console_output` after every play session.** Luau runtime errors do not surface
visually — a script can be completely dead while the scene still looks correct. The
plugin-only property errors above were only ever visible here.

**Verify features by querying state, not by looking.** "The feature is broken" and
"nothing is in range to trigger the feature" produce an identical screenshot. Print the
numbers (distances, angles, state), then fire the RemoteEvent directly to prove the
server path works before touching either.

**In play mode screen_capture will fight a custom camera system.** Studio MCP's `screen_capture` tool captures from the live game camera. Passing `camera_position` or `look_at_position` won't work if there is other camera logic in the scene (which there almost certainly is), because the two positions will fight and return garbage captures. To use `screen_capture` to capture specific angles, add re-usable flags to disable other camera driving logic. Not an issue in edit mode.


# The Rojo boundary

Map only the code directories in `default.project.json`:

```
ReplicatedStorage.Shared                  -> src/shared
ServerScriptService.Server                -> src/server
StarterPlayer.StarterPlayerScripts.Client -> src/client
```

Put imported meshes in `ReplicatedStorage.Assets`, a sibling of `Shared`. Rojo only manages
subtrees it has files for, so that folder survives every sync. Put it *inside* a managed
path and Rojo deletes it.

With `src/server/init.server.luau`, sibling `.luau` files become **children of that
Script**, so it is `require(script.WorldBuilder)` from the init script and
`require(script.Parent.WorldBuilder)` from a sibling module.

**Connecting Rojo is a GUI action you cannot perform.** The plugin has no scriptable API.
Ask the user to open the Plugins tab, click Rojo, and click Connect, then wait. Everything
else in this document is automatable; this is not.

