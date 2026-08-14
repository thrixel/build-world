# Roblox Studio

Engine-specific rules for the Roblox path. The shared Thrixel asset pipeline is in
[../../SKILL.md](../../SKILL.md); this file covers only what differs for Roblox Studio.

---

## Rules for Game Dev

When developing in Roblox Studio, you MUST set up the following checklist
and verifiably check each item off:

1. You MUST use the Rojo CLI for project sync. If Rojo is not available, you MUST stop and ask the user to install it.
2. You MUST use the Open Cloud CLI (`rbxcloud`) for asset uploads. If it is not available, you MUST stop and ask the user to install it.
3. You MUST use `thrixel_group_parts` on EVERY asset before downloading and importing.
4. You MUST follow EVERY step in the Thrixel asset import inspect loop (described below).
5. Download every Thrixel asset as `.fbx` for Roblox import.
6. NEVER use Roblox's own generative tooling (Cube 3D). Use Thrixel exclusively.
7. Mostly avoid organic animations. Animate everything through code (Tweens, BodyMovers, or RunService). Avoid humanoid rigs and characters.
8. All FBX imports must be done through the Open Cloud Assets API, not the Studio importer GUI, unless the headless path fails for a moderation reason (document when this happens).
9. NEVER expose API keys in published place scripts. Use `game:GetService("HttpService")` only from server-side `Script`, never `LocalScript`.

---

## Toolchain Requirements

### Required tools — verify before starting

```bash
# Rojo — project sync between files and Roblox Studio
rojo --version
# Expected: rojo 7.x or later

# Open Cloud CLI — headless asset upload
rbxcloud --version
# Expected: rbxcloud 0.x or later

# Python 3 — asset manifest helper script (included in engines/roblox/)
python3 --version
```

If any tool is missing, see [SetupAndInstallationFlow.md](../../SetupAndInstallationFlow.md) under "Install the engine toolchain — Roblox."

### Environment variables required

```bash
# Your Roblox Open Cloud API key (needs Asset:read, Asset:write scope)
export RBXCLOUD_API_KEY="<your_open_cloud_key>"

# Your Roblox Universe ID (from Creator Hub → Experience Settings)
export ROBLOX_UNIVERSE_ID="<your_universe_id>"

# Your Roblox Place ID (from Creator Hub → Experience Settings)
export ROBLOX_PLACE_ID="<your_place_id>"
```

If the user does not have an API key yet, say exactly this and stop:

> You need a Roblox Open Cloud API key to upload assets headlessly.
> 1. Go to https://create.roblox.com/credentials
> 2. Click **Create API Key**, name it "goal-to-game", enable the **Assets** API with **Asset:read** and **Asset:write** permissions.
> 3. Set it in your terminal: `export RBXCLOUD_API_KEY="<key>"`
>
> Come back here once that's done.

---

## Import Format

Download `.fbx` — Roblox Studio's Open Cloud importer requires FBX:

```python
thrixel_download(submission_id=..., format="fbx")
```

Group BEFORE downloading, using `thrixel_group_parts` (free, runs on Thrixel's servers,
no local Blender needed). The grouped FBX is what you upload to Roblox.

---

## Why Grouping Matters in Roblox

Roblox's MeshPart system gives every imported mesh node its own `MeshPart` instance with its
own draw call. Thrixel's Architect path produces 99–342 named mesh nodes per model. Without
grouping, a single car is ~200 MeshParts. Frame rate and triangle budget die immediately.

After `thrixel_group_parts`:
- Every static surface is merged into one `Body` mesh with multiple material slots
  (`Paint`, `Glass`, `Chrome`, `Rubber`, `Rim`, ...) addressable via `SurfaceAppearance`
- Moving parts kept via `keep_groups` arrive as their own meshes with origins at their
  geometric centre, so a wheel rotates in place with a `TweenService` tween or
  `BodyAngularVelocity`, not orbiting the model root

---

## Asset Upload: The Headless Path

This is the critical open question solved here. The Roblox Open Cloud Assets API accepts an
FBX and returns an **Operation ID**, not a usable asset ID. The actual asset IDs for the
individual `MeshPart` instances only become available after the operation completes and you
poll for the result.

### Step 1 — Upload the FBX

```bash
rbxcloud asset create \
  --api-key "$RBXCLOUD_API_KEY" \
  --name "my-car-body" \
  --description "Grouped Thrixel car asset" \
  --type "Model" \
  ./path/to/grouped_car.fbx
```

This returns JSON with an `operationId`. Save it.

### Step 2 — Poll for completion

Use the included script `engines/roblox/tools/wait_for_asset.py`:

```bash
python3 engines/roblox/tools/wait_for_asset.py \
  --api-key "$RBXCLOUD_API_KEY" \
  --operation-id "<operation_id_from_step_1>"
```

The script polls every 3 seconds (max 120 seconds) and prints the final `assetId`
when the operation completes. If it times out, the asset is still being moderated — see
"Moderation Delays" below.

### Step 3 — Resolve MeshPart IDs from the Model

The `assetId` from Step 2 is a **Model** container, not the individual `MeshPart` IDs.
To get the child mesh IDs for use in Luau scripts, use `wait_for_asset.py --resolve`:

```bash
python3 engines/roblox/tools/wait_for_asset.py \
  --api-key "$RBXCLOUD_API_KEY" \
  --asset-id "<model_asset_id>" \
  --resolve
```

This outputs a JSON manifest:
```json
{
  "model_asset_id": "12345678",
  "meshes": {
    "Body":   "rbxassetid://12345679",
    "FL":     "rbxassetid://12345680",
    "FR":     "rbxassetid://12345681",
    "RL":     "rbxassetid://12345682",
    "RR":     "rbxassetid://12345683"
  },
  "textures": {
    "Paint":   "rbxassetid://12345684",
    "Glass":   "rbxassetid://12345685"
  }
}
```

Save this manifest alongside your Rojo project as `assets/<model_name>.manifest.json`.

> **Why this works:** when the Open Cloud API imports an FBX as a `Model`, it creates
> child `MeshPart` assets for every mesh in the file. The `--resolve` flag uses the
> Assets API list endpoint to enumerate children of the model asset, matching them by
> name to the parts produced by `thrixel_group_parts`. The names are deterministic and
> stable — they are the `keep_groups` names plus `Body` for the merged static mesh.

### Fallback — Studio importer (human step, document it)

If moderation permanently blocks an asset or the API returns an error not retried away,
use the Studio importer as a documented one-time human step:

1. Open Roblox Studio
2. In Explorer, right-click `Workspace` → **Insert from File**
3. Select the grouped FBX
4. Right-click the imported `Model` in Explorer → **Save to Roblox** → note the asset ID
5. Record the asset ID in the manifest manually

Document this step explicitly in your writeup. Do NOT silently proceed — make it visible
in the manifest with `"import_method": "studio_gui"`.

---

## Moderation Delays

**Uploaded assets pass through moderation before they render.** An asset that is referenced
correctly can still show as an invisible or grey MeshPart while pending review. This is
normal and is not a bug in your code.

- The `wait_for_asset.py` script handles the post-upload operation wait only. Moderation
  is a separate, parallel process that can take minutes to hours on first upload.
- If an asset renders as grey in Studio, check the Creator Hub → **Assets** page to see
  its moderation status.
- Do NOT regenerate the asset or change your import code assuming it is broken. Wait.
- Tell the user clearly: *"The asset is uploaded and the place will load it once Roblox's
  moderation clears it. This is Roblox-side, not a code issue."*

---

## Scale and Orientation

### Stud conversion

Roblox uses studs as its world unit. **1 stud ≈ 0.28 metres** (Roblox's own convention
for human-scale content; a default character is 5 studs tall ≈ 1.4 m).

Thrixel generates assets in metres. The conversion factor to apply to a Thrixel asset's
`Size` or `CFrame` position:

```
studs = metres × (1 / 0.28)  ≈  metres × 3.571
```

Apply this in Luau when you set `MeshPart.Size` programmatically:

```lua
local METRES_TO_STUDS = 1 / 0.28
local part = Instance.new("MeshPart")
part.Size = Vector3.new(
    asset_width_m  * METRES_TO_STUDS,
    asset_height_m * METRES_TO_STUDS,
    asset_depth_m  * METRES_TO_STUDS
)
```

### Forward axis

Thrixel's forward axis is inconsistent between assets — this is documented in SKILL.md.
In Roblox, the convention is **+Z forward, +Y up**. After importing, always check the
asset's orientation in Studio's Viewport before writing movement code. Fix in-engine by
rotating the `Model`'s primary part CFrame:

```lua
-- If asset arrives facing -X instead of +Z:
model:SetPrimaryPartCFrame(
    model.PrimaryPart.CFrame * CFrame.Angles(0, math.pi / 2, 0)
)
```

Establish the correct axis during the import inspect loop (below) and document it in
the manifest.

---

## Textures and SurfaceAppearance

Roblox uses `SurfaceAppearance` for PBR textures. For each material slot in the grouped
FBX:

1. Upload the texture maps (albedo, roughness, metalness, normal) using `rbxcloud asset create --type Image`
2. Create a `SurfaceAppearance` instance, child of the `MeshPart`
3. Set its properties:

```lua
local sa = Instance.new("SurfaceAppearance")
sa.ColorMap    = "rbxassetid://<albedo_id>"
sa.RoughnessMap = "rbxassetid://<roughness_id>"
sa.MetalnessMap = "rbxassetid://<metalness_id>"
sa.NormalMap   = "rbxassetid://<normal_id>"
sa.Parent = meshPart
```

**Image size limits:** Roblox accepts textures up to 1024×1024 on free accounts,
up to 4096×4096 on paid plans. If Thrixel outputs a 4096 texture and you are on a
free plan, resize to 1024 before uploading:

```bash
ffmpeg -i texture.png -vf scale=1024:1024 texture_1024.png
```

**If a texture is not displaying:** check the `SurfaceAppearance.ColorMap` property in
Studio's Properties panel. A red warning icon means the asset ID is invalid or still
in moderation. Do not assume a scripting bug until you confirm the asset ID resolves.

---

## Collision and Performance

### CollisionFidelity

Set `CollisionFidelity` based on the asset's role:

| Asset type | CollisionFidelity | Reason |
|---|---|---|
| Ground / terrain | `Box` | Flat, cheap |
| Walls / buildings | `Box` or `Hull` | Irregular but walkable surface is forgiving |
| Vehicles (body) | `Hull` | Good enough for collisions; precise = expensive |
| Props (small, decorative) | `Box` | Player rarely hits them |
| Moving parts (wheels) | `Box` | Rotating precise meshes causes tunnelling |

Never use `Precise` on any moving part. It recalculates per-frame and causes physics jitter.

### RenderFidelity

```lua
part.RenderFidelity = Enum.RenderFidelity.Performance  -- for background props
part.RenderFidelity = Enum.RenderFidelity.Automatic    -- for hero assets
```

### Frame rate targets

- **Desktop target:** ≥60 FPS at 1080p, max draw calls < 500 per frame
- **Mobile target:** ≥30 FPS at 720p, max MeshPart count < 200 visible at once
- Use `workspace:GetRenderingEngine()` to confirm Vulkan/Metal path is active
- Measure with Roblox Studio's **Microprofiler** (Ctrl+F6 in Studio), not just the FPS counter

---

## Agent Self-Checking

Roblox Studio does not have a CLI capture path equivalent to Unity's `ScreenCapture` or
three.js's harness. The solution here is a **two-layer verification** approach:

### Layer 1 — Studio Plugin Screenshot (primary)

Include the plugin at `engines/roblox/tools/VerifyPlugin/` in your Rojo project.
The plugin adds a **Verify** button to the Studio toolbar that:

1. Positions the camera at each angle in the shot list (`engines/roblox/tools/shots.lua`)
2. Calls `game:GetService("RunService").Stepped:Wait()` to ensure the frame has rendered
3. Saves a screenshot via `plugin:PromptSaveSelection()` to a local folder

Run verification after every significant change:
1. Start Studio with the Rojo project synced
2. Click **Verify** in the plugin toolbar
3. Screenshots appear in `verification_shots/` in your project root
4. Inspect each shot for the issues listed in the import inspect loop below

### Layer 2 — Luau Self-Test Script

Include `engines/roblox/tools/selftest.server.lua` in your ServerScriptService.
On game start it:

1. Checks all required `MeshPart` instances are present and non-zero in size
2. Verifies `SurfaceAppearance` is attached and `ColorMap` is not empty
3. Checks `CollisionFidelity` is not `Precise` on any moving part
4. Prints a pass/fail report to the Output window

Run the selftest by pressing **Play** in Studio and reading the Output panel before
doing any gameplay testing.

```lua
-- Expected selftest output on a clean build:
-- [SELFTEST] Body: PASS (size=Vector3(12.5,2.8,5.2), textures=OK)
-- [SELFTEST] FL: PASS (CollisionFidelity=Box, size=Vector3(0.7,0.7,0.28))
-- [SELFTEST] All checks passed.
```

---

## Thrixel Asset Import Inspect Loop

For EVERY Thrixel asset you download and import into Roblox, you MUST run this
inspect loop. Inspect it at two points:

### Point 1 — After upload and manifest resolution

- Open Studio, load the asset from its `rbxassetid://` using the selftest script
- Position a `Camera` via script at 10 angles around the asset (front, back, left,
  right, top, three-quarter front/back/top) — use the VerifyPlugin shot list
- Screenshot each angle and inspect for:
  - Patches of inverted triangles (surfaces look dark/black from outside)
  - Missing mesh parts (gaps where geometry should be)
  - Floating geometry disconnected from the main mesh
  - Forward axis: does the asset face +Z? If not, correct and document the CFrame rotation
  - Scale: does it look right next to a default Roblox character (5 studs tall)?
- If on a paid Thrixel plan and issues are found, use `thrixel_edit_model` to fix them.
  Do NOT re-run `thrixel_create_model` from scratch — it costs more and loses what was right.
- If on a free plan, document the issue and work around it in-engine where possible.

### Point 2 — During Studio Play mode

- Press **Play** in Studio. Gameplay-mode rendering differs from edit mode (lighting,
  physics, streaming). Issues only appear here:
  - Assets flickering or large parts disappearing (streaming / LOD interaction)
  - Assets floating above the ground (collision vs. visual mesh offset)
  - Assets in wrong orientation under gameplay physics
  - Textures showing as grey/invisible (moderation still pending, or wrong asset ID)
  - SurfaceAppearance maps creating bright flashes under Roblox's lighting engine
    (usually an inverted normal map — flip the Y channel)
- Run the Luau selftest and read the Output before gameplay testing
- Take at least 5 screenshots from different gameplay positions using the VerifyPlugin

---

## Project Structure (Rojo)

Your Rojo project should follow this structure:

```
my-roblox-game/
├── default.project.json          # Rojo project file
├── assets/
│   ├── car.manifest.json         # MeshPart + texture ID manifest
│   └── barrel.manifest.json
├── src/
│   ├── ServerScriptService/
│   │   ├── GameServer.server.lua
│   │   └── selftest.server.lua   # from engines/roblox/tools/
│   ├── StarterPlayer/
│   │   └── StarterPlayerScripts/
│   │       └── GameClient.client.lua
│   └── ReplicatedStorage/
│       └── AssetManifest.lua     # auto-generated from manifest JSON
├── VerifyPlugin/                 # Studio plugin for screenshots
└── verification_shots/           # plugin writes screenshots here
```

`default.project.json` example:

```json
{
  "name": "my-roblox-game",
  "tree": {
    "$className": "DataModel",
    "ServerScriptService": {
      "$className": "ServerScriptService",
      "$path": "src/ServerScriptService"
    },
    "StarterPlayer": {
      "$className": "StarterPlayer",
      "$path": "src/StarterPlayer"
    },
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "$path": "src/ReplicatedStorage"
    }
  }
}
```

Start Rojo sync:

```bash
rojo serve default.project.json
```

Then in Studio: **Plugins** → **Rojo** → **Connect**.

---

## Moving Parts — Animation Pattern

Moving parts kept via `keep_groups` (wheels, doors, turrets) arrive with their pivot at
their own geometric centre. Animate them in Luau via `TweenService` or `RunService`:

```lua
-- Wheel rotation example (continuous spin)
local RunService = game:GetService("RunService")
local wheel = model:FindFirstChild("FL")  -- grouped part name

RunService.Heartbeat:Connect(function(dt)
    wheel.CFrame = wheel.CFrame * CFrame.Angles(
        speed_rads_per_sec * dt, 0, 0
    )
end)
```

For parts that need to pivot around a point OTHER than their geometric centre (turret
on a mount, door on a hinge), wrap them in a `Model` with a positioned `PrimaryPart`:

```lua
-- Door hinge example
local hinge = Instance.new("Model")
hinge.Name = "DoorHinge"
local hingePart = Instance.new("Part")  -- invisible, at hinge position
hingePart.Anchored = true
hingePart.Size = Vector3.new(0.1, 0.1, 0.1)
hingePart.CFrame = CFrame.new(hingeWorldPosition)
hinge.PrimaryPart = hingePart
model.Door.Parent = hinge  -- reparent the door under the hinge model
hinge.Parent = workspace
```

---

## Multiple Concurrent Builds — ignore in 95% of cases

**Skip this unless the user explicitly said they are running multiple Studio instances.**

If they are:
- Each Studio instance must have a **separate Roblox Place ID**. Two agents syncing to
  one place will overwrite each other's published content.
- The Thrixel concurrency cap is account-wide — stagger asset generation across agents.
- The VerifyPlugin screenshots to a folder named after the Place ID, not a fixed path.
- The Luau selftest must prefix all `print()` output with the Place ID so Output from
  multiple editors is distinguishable when logged to a shared file.

---

## Pitfalls

See [PITFALLS.md](PITFALLS.md) for the full list. Summary of the highest-cost ones:

| Symptom | Cause | Fix |
|---|---|---|
| Asset renders grey in play | Moderation pending | Wait; check Creator Hub |
| Wheel orbits model root instead of spinning | Missing `keep_groups` in `thrixel_group_parts` | Re-group with `keep_groups` set |
| `MeshId` is a Model asset ID, not a mesh | Skipped the `--resolve` step | Run `wait_for_asset.py --resolve` |
| Assets disappear at distance | Level of detail / streaming culling | Set `StreamingMesh` or increase `StreamingMinRadius` |
| Normal map looks inverted (bright halos) | Roblox expects DirectX-convention normal maps | Flip the G channel: `ffmpeg -i normal.png -vf hue=s=0 -channel_layout G -vf negate normal_dx.png` |
| Physics jitter on moving part | `CollisionFidelity = Precise` on animated mesh | Set to `Box` for all moving parts |
| Asset floats above terrain | Visual mesh origin ≠ collision origin | Pin with `BasePart.Position` explicitly; don't rely on auto-drop |
| FBX upload returns 403 | Missing `Asset:write` scope on API key | Re-create the API key with the correct scope |
