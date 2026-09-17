# tools/

## uemcp.py

Dependency-free command-line client for Epic's Unreal MCP server (Streamable HTTP on
`http://127.0.0.1:8000/mcp` by default). Use it when the `unreal-mcp` server is not in your
agent's tool list yet (it was configured after the agent started), or whenever you want to run
many editor calls from one shell command.

```sh
python3 tools/uemcp.py toolsets                      # what is registered
python3 tools/uemcp.py sig <Toolset>                 # compact signatures: name(arg?:type) -> return + first doc line
python3 tools/uemcp.py describe <Toolset>            # full JSON schemas (long)
python3 tools/uemcp.py call <Toolset> <tool> '<json args>'
python3 tools/uemcp.py call <Toolset> <tool> @args.json
```

- Text results are pretty-printed. Any `{data, mimeType}` image inside a result (CaptureEditorImage,
  CaptureViewport, Slate Screenshot) is written to `/tmp/uemcp_<n>.png` and replaced by the path.
- Exit code 1 on `isError` so shell `&&`/`||` work.
- `UEMCP_URL`, `UEMCP_SESSION` (session-id cache file), `UEMCP_TIMEOUT` override defaults.
- Toolset names are the long form from `list_toolsets`
  (`editor_toolset.toolsets.actor.ActorTools`, `EditorToolset.EditorAppToolset`, ...).

Batching pattern used in practice: keep a `lib_ue.py` with helpers (`T`, `setp`, `getp`,
`by_label`, `spawn_asset`, `clear_graph`, `wire_key_to_function`), concatenate it with a task
script that defines `run()`, JSON-encode as `{"script": ...}` and pass it to
`ProgrammaticToolset.execute_tool_script` with `@file`. See
`community-field-notes/headless-autonomy.md` §6.

## ue_console.sh

```sh
bash tools/ue_console.sh 'py print("connected")' '/absolute/project/Saved/Logs/Project.log'
```

Types a console command into the editor's status-bar Cmd box through the Slate inspector and
uses unique completion/error markers for Python calls. Exceptions return failure without
replaying partial changes. Ordinary console commands are acknowledged by their new `Cmd:` log
line; that establishes submission, not semantic success. Missing acknowledgement, log rotation
or connection loss requires inspecting state before a manual retry. Pass the running editor's
log explicitly when multiple projects/processes exist.

This helper targets the **editor** Cmd box and presses Escape, which stops PIE. Do not use it
for in-game console commands during a play test. Prefer short file-execution calls for larger
scripts. `UEMCP_CMDBOX_REF` overrides automatic textbox discovery. The transport is provided by
`uemcp.py`; see the gotchas file for the Slate input quirks.

## Scene audits and placement comparison

`ue_scene_audit.py` runs inside editor Python, outside PIE. It audits the currently loaded world
without loading, saving or changing assets. Supply an explicit output path:

```python
import sys
sys.path.insert(0, '/absolute/path/to/tools')
from ue_scene_audit import audit
audit('/absolute/path/before.json', instance_hashes=True)
# After the intended edits and a save/reopen, write a separate after.json.
```

Outside Unreal:

```sh
python3 tools/ue_compare_audits.py before.json after.json
```

Exit 0 means existing placements, component transforms/counts and material overrides are
preserved within the comparison's scope. Additions and mesh swaps are reported separately.
Exit 1 reports preservation differences. Use `--tolerance` for absolute transform tolerance;
instance hashes remain exact. The audit is not a gameplay-state comparison, and its LOD0 mesh
triangle counts may be Nanite fallback data rather than actual rendered triangles.

## FBX texture connections and fresh-import binding

```sh
python3 tools/fbx_texture_map.py /absolute/path/model.fbx
```

Reads binary FBX Material→Texture diffuse connections without importing Unreal or requiring a
3D editor. Supports the 32-bit and 64-bit node-header formats. Rejects conversion-status stubs;
ASCII FBX is outside this helper's scope. Outputs normalized material names and image basenames.
It does not generate, decimate, edit or validate the appearance of a model.

When a fresh Unreal FBX import leaves TextureSample inputs empty, editor Python can use:

```python
from ue_bind_fbx_textures import bind
plan = bind('/absolute/path/model.fbx', '/Game/Imported/Prop')
print(plan)  # dry run: resolves all material connections and checks image files
# On the reviewed fresh-import folder only:
result = bind('/absolute/path/model.fbx', '/Game/Imported/Prop',
              apply=True, roughness=.8, nanite=True, instanced=False)
```

**Apply replaces the imported base-material graphs** with diffuse texture plus constant
roughness and saves them. It preserves two-sided settings, skips shared materials outside the
folder, and refuses material instances. Do not use it on authored graphs. Images default to
the adjacent `model.fbm/` directory; `texture_dir=` overrides that directory. Existing target
textures are reused, so use a fresh dedicated import folder or inspect/reimport stale textures
before applying a changed FBX.

The helper validates mappings before changing any graphs and rejects textures Unreal classifies
as normal maps. Some bad source exports assign normal-map images to diffuse connections;
metadata alone cannot establish correctness. Inspect the image and in-level result. Missing
files/import failures may leave new texture assets, but material mutation starts only after
all target textures pass validation.

## CSV Profiler summaries

```sh
python3 tools/ue_csv_summary.py Before.csv After.csv --start 300 --stop 1100 --output timing.json
```

Reports mean, median, nearest-rank p95, minimum and maximum for numeric frame rows, ignoring UE's
metadata footer. Defaults to `FrameTime`, `GPUTime`, `GameThreadTime`; `--columns` selects other
header names. Start is inclusive and stop exclusive. It never edits the source CSVs. A JSON
output path that matches an input capture is rejected.

Read [performance and safe iteration](../community-field-notes/performance-and-safe-iteration.md)
for controlled capture conditions, interpretation limits, quality switching, surface validation
and preserving manual level edits.

## Validation scope

Checked on UE 5.8.2 Linux: live read-only audits including instanced transforms; temporary
multipart FBX import, dry-run binding, graph application, usage-flag saving and cleanup; and
ordinary-command and Python success/error acknowledgement (an intentional failing script executed
once). The FBX
reader was also checked against real exports and synthetic 32/64-bit node-header fixtures.
Offline checks cover audit additions/removals/movement and CSV metadata-footer handling.
Other engine versions and export conventions should be verified with a small import first.
