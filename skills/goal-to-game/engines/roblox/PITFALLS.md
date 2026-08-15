# Roblox pitfalls

Read this with `../roblox.md`. Each item states the observable failure and the required response.

## Import and ownership

- **Model ID is not a child MeshId map.** Open Cloud can create a Model container, but the result
  is not a stable answer for every imported MeshPart. Use the Studio 3D Import gate; never scrape
  Creator Dashboard or use a `.ROBLOSECURITY` cookie.
- **Rojo deletes what it owns.** If `Workspace` is mapped wholesale, live sync can remove models
  imported in Studio. Leave `Workspace/ThrixelAssets` outside the Rojo tree.
- **Moderation looks like a code bug.** A valid MeshId or texture may render blank. Check Creator
  Dashboard and Output once, mark it pending, and wait. Do not rotate through reuploads.
- **Creator mismatch looks like moderation.** Assets owned by a personal account may not load in a
  group-owned experience. Import while signed in to the final creator context or explicitly grant
  the experience permission.

## Geometry and materials

- **20,000 triangles is per MeshPart.** A 45k Model is acceptable only if no final MeshPart crosses
  the boundary. Preflight the normalized GLB rather than trusting the whole-model count.
- **A material slot is not a Roblox submesh material.** A MeshPart has one appearance. Split each
  material to its own object before import; keep Merge Meshes disabled.
- **Decimating unwelded UV seams opens cracks.** Weld coincident vertices before decimation. If the
  watertight gate fails afterwards, reduce on Thrixel or regenerate; do not hide holes with
  double-sided rendering.
- **Automatic hole filling can ruin a prop.** Never voxel-remesh or Solidify a textured hero asset
  silently. Those are art-direction changes and require a new visual review.
- **Normal maps can look inverted.** If surfaces look embossed inward, verify the importer's tangent
  basis and the map type. Do not compensate by flipping unrelated lighting.

## Transform and animation

- **Do not hardcode metres-to-studs.** Importer behavior and authored units vary. Measure the
  imported bounding box, scale once to a declared target, and store the applied scale attribute.
- **Forward is not guaranteed.** Correct authored forward to Roblox `-Z` once at import. Never carry
  per-frame `+90°` fixes into vehicle or projectile code.
- **A centred origin is not a hinge.** `keep_groups` gives a geometric centre. Wheels and propellers
  usually want it; doors and turrets usually need an explicit mount pivot.
- **Nested moving geometry can be welded accidentally.** The audit must fail when a declared moving
  group resolves to zero objects. A visually correct static prop is still a failed animated asset.

## Runtime and verification

- **Studio desktop FPS is not mobile FPS.** Use the MicroProfiler and a real low-target device. Report
  p95 and worst hitch over gameplay, not an idle average.
- **Collision meshes can dominate cost.** Use precise decomposition only where a player walks on a
  complex anchored surface; use primitive hitboxes for repeated and moving props.
- **Capture after streaming settles.** A camera teleport can screenshot an unloaded scene. The tour
  waits at each shot and the evidence must show the asset-ready indicator.
- **Local success is not publish success.** Reopen a clean Rojo build, then test the public experience
  as a fresh player. Owner permissions and moderated assets can differ after publishing.
