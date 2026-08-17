# Thrixel source downloads

These are the exact accepted source files used for the two issue #3 demonstrations. They are kept
in the repository so the Studio import boundary described in
[`skills/goal-to-game/engines/roblox.md`](../skills/goal-to-game/engines/roblox.md) is reproducible
without access to the original workstation.

- `roblox/orrery-lock/` contains the accepted grouped Orrery GLB and eight supporting GLBs.
- `roblox/moonmarket-mix-up/` contains the accepted grouped cauldron GLB and five supporting GLBs.
- The two `*.conversion-queued.json` files are deliberately retained as failure evidence. They are
  the 755-byte queue responses returned by the first FBX download attempts and must never be
  imported as geometry. The adjacent FBX files are optional fallback evidence; the manifests and
  checksums deliberately select the validated GLBs.

Provenance, submission IDs, triangle counts, moving groups, and Cube use are recorded in
[`docs/thrixel-assets.md`](../docs/thrixel-assets.md). The game manifests point to these files by
relative path. From the repository root, the cross-platform verifier checks all 15 hashes,
manifest paths, and recorded per-asset geometry reports:

```sh
uv run --with trimesh --with numpy --with networkx python scripts/verify_roblox_submission.py
```

From this directory, macOS/Linux reviewers can also run `shasum -a 256 -c checksums.sha256` for
the hash-only check.
