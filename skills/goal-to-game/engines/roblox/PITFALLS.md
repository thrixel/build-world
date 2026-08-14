# Roblox Pitfalls

Every entry here is a known problem in the Roblox + Thrixel pipeline.
Format: **Symptom → Cause → Fix**. Read before debugging.

---

## P1. Asset renders grey or invisible in Studio

**Symptom:** MeshPart appears grey/transparent even though the ID looks correct.
**Cause:** Roblox's asset moderation is still processing the upload. This is separate from
the operation polling — `wait_for_asset.py` only waits for the *upload* operation to finish,
not moderation.
**Fix:** Check https://create.roblox.com/dashboard/assets → find your asset → look at its
status. If it says "Under Review" or "Pending", wait. Do not change your script or re-upload.
Tell the user: *"The asset ID is correct. Roblox is still reviewing it — this usually takes
a few minutes but can take longer."*

---

## P2. `MeshId` from Operation is a Model container ID, not a mesh ID

**Symptom:** Setting `part.MeshId = "rbxassetid://<operation_result_id>"` makes the part
render as a blank white sphere (the default mesh).
**Cause:** The Open Cloud Assets API returns the ID of the **Model** container, not its child
`MeshPart` assets. These are different IDs.
**Fix:** Run `wait_for_asset.py --resolve` to enumerate the child IDs. If the API does not
return children (the endpoint may not expose them for all asset types), use the Studio
fallback: insert the Model via `game:GetService("InsertService"):LoadAsset(<id>)` in a
server Script, then print the `MeshId` of each child MeshPart to the Output window.

---

## P3. Wheel orbits the model root instead of spinning in place

**Symptom:** Calling `part.CFrame = part.CFrame * CFrame.Angles(...)` makes the wheel arc
around the car body instead of rotating around its own axis.
**Cause:** `thrixel_group_parts` was called without `keep_groups`, so the wheel was merged
into the `Body` mesh. It has no separate pivot.
**Fix:** Re-run `thrixel_group_parts` with the correct `keep_groups`:
```python
thrixel_group_parts(
    submission_id=...,
    keep_groups=[{"name": "FL"}, {"name": "FR"}, {"name": "RL"}, {"name": "RR"}]
)
```
Then re-upload and re-resolve.

---

## P4. `thrixel_group_parts` silently fails to keep a part

**Symptom:** A part you listed in `keep_groups` ends up merged into `Body` anyway.
**Cause:** The part name in `keep_groups` does not match the actual node name in the Thrixel
asset. Name matching is case-sensitive and path-sensitive.
**Fix:** Run `thrixel_inspect_model(submission_id=...)` first and get the exact node names.
A `keep_groups` entry that matches nothing **fails the job on purpose** — if it didn't fail,
your entry matched nothing and was ignored. Double-check the exact names from the inspection.

---

## P5. Normal map appears inverted (bright halos around edges)

**Symptom:** Assets lit with `SurfaceAppearance.NormalMap` show bright light halos or
inverted shading on edges and creases.
**Cause:** Roblox uses DirectX-convention normal maps (Y channel flipped relative to OpenGL).
Thrixel exports OpenGL-convention normal maps.
**Fix:** Flip the G channel before uploading:
```bash
# Using ffmpeg:
ffmpeg -i normal_opengl.png -vf "split[a][b];[a]lutrgb='r=val:g=negval:b=val'[out]" -map "[out]" normal_dx.png
# Or with ImageMagick:
convert normal_opengl.png -channel G -negate normal_dx.png
```

---

## P6. Asset floats above the terrain

**Symptom:** The model is visually correct but hovers above the ground plane.
**Cause:** Roblox auto-positions a dropped-in Model based on its bounding box bottom, which
may not match the visual ground contact point of the mesh — especially after scale conversion.
**Fix:** Explicitly set the `PrimaryPart.Position.Y` so the bottom of the visual mesh sits at
`workspace.Terrain:GetHeight(x, z)` (or `0` for a flat baseplate). Don't rely on drag-drop
positioning. Always set it in code.

---

## P7. `CollisionFidelity = Precise` causes physics jitter on moving parts

**Symptom:** Wheels or doors jitter, teleport, or cause the vehicle to shake.
**Cause:** Roblox recalculates precise collision geometry every physics frame for animated
parts. The recalculation conflicts with the part's CFrame change.
**Fix:** Set `CollisionFidelity = Enum.CollisionFidelity.Box` for ALL moving parts. For
vehicle bodies, use `Hull`. Reserve `Precise` only for static environmental geometry where
exact collision shape matters (e.g., a ramp or archway).

---

## P8. FBX upload returns 403 Forbidden

**Symptom:** `rbxcloud asset create` exits with HTTP 403.
**Cause:** The Open Cloud API key is missing the `Asset:write` permission, or is scoped to
the wrong experience.
**Fix:** Go to https://create.roblox.com/credentials → find your key → edit it → ensure
**Assets** API is enabled with both `Asset:read` AND `Asset:write`. The key must also be
associated with the correct creator (your account or the group that owns the experience).

---

## P9. Rojo sync loses changes after Studio publish

**Symptom:** Changes made directly in the Studio UI (not via Rojo-synced files) disappear
after the next `rojo serve` reconnect.
**Cause:** Rojo treats the local file system as the source of truth. Any edits made in the
Studio UI that are not reflected in your local `.lua` or `.luau` files will be overwritten
on the next sync.
**Fix:** Make all code edits in your local files, not in Studio directly. Studio UI is for
inspection and playtesting only.

---

## P10. Texture size limit causes upload rejection

**Symptom:** `rbxcloud asset create --type Image` fails with a payload too large error.
**Cause:** Thrixel can output 4096×4096 textures. Roblox free accounts have a 1024×1024 limit.
**Fix:** Downscale before uploading:
```bash
ffmpeg -i texture_4096.png -vf scale=1024:1024 texture_1024.png
```
On paid Roblox plans the limit is 4096×4096 — check your plan's asset limits at
https://create.roblox.com/docs/production/publishing/publishing-place-files before uploading.

---

## P11. StreamingEnabled causes assets to disappear mid-session

**Symptom:** Assets that loaded fine at game start disappear when the player moves away,
and re-appear when they return.
**Cause:** Roblox StreamingEnabled replicates only the content near the player. Large MeshPart
assets far from the player are streamed out.
**Fix:** For game-critical assets (e.g., the car the player drives), set
`part.Archivable = false` and use `workspace:SetAttribute("StreamingEnabled", false)` on
small maps, OR add the asset's Model to `ReplicatedStorage` and load it client-side with
`InsertService` so it is always present. For open-world games, streaming is expected behaviour
— tell the user to expect it and design around it.
