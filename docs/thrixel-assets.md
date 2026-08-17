# Thrixel asset evidence

Checked August 15, 2026. Cube balance after the complete generation and polish pass: 3,640 of 5,250 (1,610 Cubes consumed). No billing, top-up, upgrade, or Robux purchase was used. The Studio plan reported 0 of 10 concurrent jobs running at the final check.

## Orrery Lock

- Project: `Orrery Lock` (`9a1ca801-9b74-433d-9b91-4052b9170e7a`)
- Rough source: `211c3838-a84e-4891-ab1a-b125c1b82c0b`
- Accepted grouped source: `87ca13f3-e89b-4fda-9168-ca49b2a7a802`
- Rejected detail candidate: `4b8c15de-a57c-4fae-aba8-896779f8646d`
- Accepted geometry: 24,874 triangles across six mesh objects; no individual source mesh exceeded 20,000 triangles.
- Moving groups: `crank`, `orbit_ring_inner`, `orbit_ring_middle`, `orbit_ring_outer`, and `pointer_arm`.
- Static merged body: `OrreryBody`.
- Visual decision: retain the grouped source. Its brass/navy/teal separation, crisp silhouette, and glowing focal sphere were stronger than the duller detailed derivative.

Recorded pivot origins:

- crank `(0.0, -0.9022, 0.3363)`
- orbit rings approximately `(0.0, 0.0, 1.2308)`
- pointer arm `(0.2916, 0.1951, 0.5577)`
- body `(0.0, 0.0, 0.0)`

Supporting accepted assets:

- Mechanical vault door `99682552-f9bf-41a8-ac49-b046724ac393`: 38,608 triangles across five closed mesh objects, including a distinct `door_panel` and `lock_wheel`. The layered navy panel, brass frame, wheel, rails, and restrained teal glass insets restore a readable door silhouette while preserving the opening mechanism.
- Star Cell `4a504651-3973-49a7-bf90-520e96836c2b`: 11,758 triangles across five closed mesh objects. A faceted energy core is visibly enclosed by a brass cage, end caps, and carry handle; only the core receives a low-intensity Roblox light.
- Observatory lamp `e2a165cc-93b2-4f25-8fb3-f5745ab8442b`: body 10,698 triangles and glass 400.
- Prize Star Prism `cdba5087-8ba3-4647-b85f-b25aff9fb0ec`: reduced to one 18,000-triangle mesh.
- Floor telescope `55e1e592-8aa9-44c9-a36a-71639e35ca8c`: 21,592 triangles across five closed mesh objects.
- Celestial chart lectern `f12e6cfd-c103-45f9-a8ed-966c7763aed8`: 14,524 triangles across five closed mesh objects.
- Astrolabe pillar `208887fc-f0a9-4c17-a6b9-b89f3668db7b`: 14,272 triangles across four closed mesh objects.
- Observatory equipment workbench `f008f65f-3e85-4c8a-ab66-60ec213f14e2`: 27,352 triangles across five closed mesh objects.

The Orrery, vault, cell, lamp, prism, telescope, lectern, astrolabe, and workbench were visually accepted from Thrixel thumbnails. The detailed Orrery derivative was rejected because its pass reduced contrast and material readability. The larger prop set makes the observatory read as an inhabited puzzle space rather than an empty test chamber.

## Moonmarket Mix-Up

- Project: `Moonmarket Mix-Up` (`da221d29-018f-456b-8ad4-4cba138064f8`)
- Rough source: `abee20b1-4c3b-48fe-9206-368bf48a6349`
- Accepted grouped source: `996777ec-1341-4de2-9687-d3b547ac0eb0`
- Accepted geometry: 25,848 triangles across five mesh objects; no individual source mesh exceeded 20,000 triangles.
- Moving groups: `lid`, `stirring_paddle`, `left_handle`, and `right_handle`.
- Static merged body: `CauldronBody` (15,784 source triangles before grouping).
- Visual decision: retain the grouped source. The plum/brass/teal palette and broad silhouette are readable from the fixed isometric camera.

Supporting accepted assets:

- Market stall `dd4c4879-5c9d-4d3d-be66-66cd35687a17`: awning 704 triangles, brass trim 10,256, `StallBody` 4,888, and built-in lantern 2,072.
- Hanging lantern `3d48e107-832a-490c-9fca-5a2d5fbd04d4`: glass 1,840 triangles, glow 624, hook 4,316, and frame 18,220.
- Glowcap `d82a6603-2138-4b04-8798-9dc8b40ed805`: 8,940 triangles across five closed mesh objects. Its cap, rim, stem, brass collar, and small glow spots remain visually distinct; only the spots use emissive material.
- Moonfruit `f25753fb-4e49-4b51-a849-cbdf70ed2c26` (Architect parent `22e52474-3a14-4d4b-88fb-5731c9a58b19`): 19,340 triangles across three closed mesh objects; the largest object is 13,428 triangles.
- Star Crystal `b0ffc923-34fc-4cb8-a225-54fe8e39b3f8`: 9,564 triangles across four closed mesh objects. Faceted crystal points, a stone collar, brass bands, and a small inner glow preserve the object silhouette under the isometric camera.

All three pickup silhouettes were visually checked side by side and accepted as distinct at gameplay scale. The Glowcap and Star Crystal polish pass specifically corrects the overbright emissive treatment seen during gameplay review.

## Download verification

All 15 accepted sources were explicitly downloaded or regenerated as GLB. The first two optional FBX calls saved 755-byte JSON queue responses under `.fbx` filenames; retrying produced valid fallback FBX files, but those are not manifest-selected sources. GLB remains the primary Studio path because it retains hierarchy, carries one portable payload, and can be validated deterministically.

## Observed failure behavior

- Thrixel's active project behaves as global session state. Cross-project calls were therefore run sequentially after explicitly resuming the target project; parallel calls can otherwise be filed under the wrong project even when a project ID is supplied.
- Detail accepts 2,048 or 4,096 texture size, not 1,024. Sculpt decimation targets below 10,000 are rejected.
- A failed sculpt attempt may still consume Cubes, so the workflow records balance before and after generation waves and does not blindly retry.
- `thrixel_reduce_triangles` applied to a `filter_group` derivative can be a no-op even when a lower target is requested. Reducing the original sculpt parent created new topology, but the four tested parents still had real holes and visible surface damage. They were rejected and regenerated as closed-solid Architect assets.
- `thrixel_autofix_model` was run on the editable-source polish assets before final grouping. Some grouped outputs still contained open seams or mixed winding. The deterministic `repair_mesh_winding.py` compatibility pass welds coincident vertices, recalculates closed-component winding, and can seal or voxel-remesh only the affected semantic mesh while retaining the Thrixel-authored hierarchy and appearance. The strict validator passed every final asset; every individual Roblox MeshPart remains below 20,000 triangles.
- Studio's Import Queue can retain a completed row after Preview Import already inserted a model. Clicking the lower queue import again created duplicates; accepted imports are now verified in Explorer before any retry.
- `MeshPart.RenderFidelity` and related fidelity choices are configured during the Studio build, not by the runtime server script. A Play-mode attempt to assign `RenderFidelity` failed with `lacking capability Plugin` and halted world construction.
- The accepted grouped Orrery GLB and optional FBX fallback both preserved node hierarchy but previewed white in Studio. Per-group Roblox materials/colors are therefore assigned to the semantic MeshParts rather than pretending a joined source material can survive Roblox's one-appearance-per-MeshPart boundary.
- Roblox moderation can leave uploaded assets invisible while pending. The fallback is to keep the original GLB/FBX, preserve the Studio importer route, and show an explicit pending/failure state rather than substituting an unrelated asset ID.
