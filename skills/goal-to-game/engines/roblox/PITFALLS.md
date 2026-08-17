# Roblox pitfalls

Read this before the first import. Each entry includes the symptom, the likely cause, and the
recovery action. Never turn an import warning into a gameplay workaround.

## Import and identity

### A. The upload succeeded, but the `MeshId` is unknown

**Symptom:** Open Cloud returns an asset ID, but assigning it to `MeshPart.MeshId` shows nothing.

**Cause:** the returned ID identifies a Model container, not each child mesh.

**Fix:** insert/import the Model in Studio, enumerate the resulting `MeshPart` descendants, and
record their actual IDs. Do not add offsets to the Model ID or scrape authenticated web pages.

### B. A valid asset renders blank

Check in this order: upload operation status, moderation state, experience permission, then the
actual child content IDs. A pending asset is not a lighting bug. Keep the source file and explicit
pending state; retry later without generating or uploading duplicates.

### C. Import created duplicates

The queue can retain a completed row after the object was inserted. Verify Explorer/Workspace and
use Find in Workspace before pressing Import again.

### D. Rojo deletes imported assets

A full project sync owns the mapped tree. Use a narrow `studio-sync.project.json` while importing,
or export accepted models into the Rojo-owned `src/assets` folder. Never accept a destructive sync
preview without reading the Instance list.

### E. A `.glb` is actually JSON

Some asynchronous conversions can initially return a queued response saved under the requested
extension. Verify the `glTF` magic bytes and file type. Retry `thrixel_download` after conversion;
do not rename the response or import it.

## Geometry, groups, and pivots

### F. Model total is below budget but import still fails

Roblox's 20,000-triangle limit is per mesh object. Inspect the grouped result object by object.
Kept groups are independent of the merged-body target, so validate all of them.

### G. Materials became one white surface

A Roblox `MeshPart` has one appearance. A merged object with several semantic material slots does
not behave like Unity submeshes. Keep appearance regions as separate objects during grouping, then
assign one `SurfaceAppearance` or deliberate Roblox material per object.

### H. A wheel/ring/door orbits the whole model

The wrong object was animated or its pivot is at the model root. Keep the real node in
`keep_groups`, enable Use Imported Pivot, and compare its pivot with its bounding-box center. For a
hinge, rotate a parent pivot at the mount point rather than the mesh itself.

### I. The model falls apart or falls through the map

Imported rigid props default to unanchored in many importer configurations. Anchor visual parts;
use separate primitive collision and intentional constraints only where physics is gameplay.

### J. The model is invisible from one side

Backfaces or open geometry failed validation. Do not paper over this with Make Double Sided; it
costs rendering time and does not create valid volume. Validate the ungrouped parent and grouped
download separately. If the parent passes and the grouped file is still watertight but has only
mixed-winding errors, run `repair_mesh_winding.py` through Blender and validate the result again.
That deterministic pass welds coincident seam vertices and normalizes closed components; it does
not fill holes. If watertightness still fails, reduce the original parent or regenerate the asset.

### K. The model is tiny, huge, sideways, or floating

Source units and forward axes vary. Use importer World Up/World Forward, scale uniformly against a
5-stud reference, ground from the bounding-box bottom, and record the transform in the manifest.

## Appearance

### L. PBR maps exist but gameplay changes do nothing

Most `SurfaceAppearance` content properties are build-time. Wire them in Studio/edit mode. Runtime
code may tint or toggle objects only where the API supports it; it cannot be the import pipeline.

### M. The scene is overexposed or nearly black

Test the asset under neutral lighting before editing textures. Tune Ambient, Brightness,
ExposureCompensation, local-light ranges, and ColorCorrection as one system. Inspect both the
darkest and brightest named shots after every lighting change.

### N. Small props exhaust mobile texture memory

Texture memory follows pixel count, not compressed file size. Reserve 2048 for close hero assets,
use 1024/512 for ordinary props, reuse IDs, and avoid layered transparency.

## Collision and performance

### O. The player snags on decorative geometry

Do not collide every MeshPart. Set decoration and moving visuals non-collidable and use simple
invisible Parts for walkable surfaces, walls, boundaries, and proximity interactions.

### P. Runtime code cannot set fidelity

`RenderFidelity` and some import/build properties require edit/plugin capability. Configure them
in Studio or a trusted build plugin, then persist the place/model. A runtime permissions error is
not a reason to remove the self-test.

### Q. Repeated props still cost many draw calls

The same-looking mesh imported repeatedly receives different IDs and cannot instance. Import once,
then clone the accepted instance/package so MeshId and appearance content remain identical.

### R. Desktop is smooth but mobile is not

Measure in Device Emulator. Reduce shadow-casting lights, transparency, visible object density,
texture size, and render fidelity before sacrificing the hero silhouette. Keep at least 30 FPS on
the selected mobile preset and record the exact preset.

## Testing and publishing

### S. The game starts in empty space or the player dies on join

World construction raced CharacterAdded. Create a real SpawnLocation early, hold or cover the
player until the build-ready flag is set, then place the character on a collidable floor. Test a
cold start and respawn, not only an already-loaded Studio session.

### T. A screenshot looks good but the objective is impossible

Visual captures do not prove reachability. Exercise every pickup, interaction, round transition,
win state, respawn, edge boundary, keyboard input, and touch input. Record the exact progression
tested in the writeup.

### U. Captures leak the desktop

Use `CaptureService` or window/viewport-scoped capture. If the available tool only records the
whole desktop, stop and ask the user to capture. Never include terminals, notifications, other
apps, credentials, or personal files in evidence.

### V. Published content differs from Studio

Moderation, ownership, permissions, StreamingEnabled, and cold asset loading differ in a fresh
client. After publishing, join a new public server and repeat the asset-visibility and completion
checks. Do not rely on the Studio cache.

### W. Linux instructions pretend Studio is native

Roblox Studio has no supported native Linux build. Linux can prepare and validate; WSL can serve
Rojo to Studio on its Windows host. Otherwise stop and require a Windows/macOS Studio host rather
than recommending Wine as a supported production path.
