# Unreal Engine Skills for Coding Agents

Control Unreal Editor directly from Claude Code or other coding agents via MCP. Hundreds of tools exposed via Unreal's ToolsetRegistry across 30+ toolsets: actors, blueprints, materials, Niagara, Control Rigs, Sequencer, State Trees, widgets, Gameplay Ability System, automation testing, and more.

## Contents

### Skills

- **`unreal-mcp`** (`skills/unreal-mcp`) - instructions and workflows for driving the Unreal Editor via MCP.
Accompanying documents for the unreal-mcp skill are `setup.md` and `operations.md`.

## Prerequisites

1. **Unreal Editor** with the **ModelContextProtocol** and **AllToolsets** plugins enabled (`AllToolsets` provides the tools; the server exposes none without it)
2. **Editor running to execute tools**, with the MCP server started. Run `ModelContextProtocol.StartServer`, or enable `bAutoStartServer` through `setup.md`. The optional proxy can keep the client connection open while the editor is stopped.

Read `setup.md` for the full setup procedure for a fresh project.

## Verification

1. Launch Unreal Editor, then run `ModelContextProtocol.StartServer` in the console to start the MCP server.
2. Check the Output Log for MCP server startup messages.
5. Try: "List all actors in the current level".

## Configuration

The default port is **8000** with URL path `/mcp`. If the port is in use, run `ModelContextProtocol.StartServer <port>` in the console with a different port number.

> **Note:** This plugin does not ship a static `.mcp.json` file. Run `ModelContextProtocol.GenerateClientConfig ClaudeCode` (or your coding agent of choice; see `setup.md`) in the editor console to generate it from the current server port and URL; re-run after changing either.

### Optional proxy for editor recovery

If your engine build includes `Engine/Plugins/Experimental/ModelContextProtocol/Extras/Proxy`, you can use its `unreal_mcp_proxy` executable.

The proxy keeps the client-facing MCP session open while Unreal is unavailable and reconnects when Unreal starts again. It stores Unreal's native tool catalog as a temporary fallback. Cached tools do not prove that live calls can succeed. Without a cache, it exposes only `unreal_mcp_status` until the client fetches the recovered catalog.

See [proxy setup](setup.md#4-optional-install-the-proxy) for platform binaries and installation commands. See [proxy recovery](operations.md#proxy-recovery) for status, cached catalogs, and connection failures.

### Tool search

**Tool Search is required.** Keep `bEnableToolSearch=True` in `[/Script/ModelContextProtocolEngine.ModelContextProtocolSettings]`.
The MCP server exposes `list_toolsets`, `describe_toolset`, and `call_tool`; clients discover a toolset, inspect its
schema, then dispatch it through `call_tool` on the same turn. The model-facing usage contract lives in
`skills/unreal-mcp/SKILL.md`.

## Security

Installing this plugin gives your coding agent broad, live access to the running Unreal Editor. Treat that access the same way you would treat running arbitrary code from an assistant, because in practice it is.

**Localhost is not a trust boundary.** The MCP server binds to `localhost:8000` with origin validation. Origin validation protects against a browser tab talking to the server, but any process running as the same user on the same machine can connect. Do not run the MCP server on shared or untrusted machines, and do not expose the port outside the loopback interface.

**`ProgrammaticToolset.execute_tool_script` executes arbitrary Python** inside the editor process. That script has full access to every toolset API, the project on disk, the asset database, and editor-privileged functions. Treat every invocation as a privileged operation that can mutate, move, or delete project content, and expect it to succeed without a second confirmation when approvals are disabled.

**Auto mode.** If the project is a large existing game and not meant to be a fully agent-made one/few-prompt project, prefer to keep (the equivalent of) Auto mode in your coding agent **off** so that each tool call requires approval, unless you'd like the agent to full-auto the project as much as possible. 

**Source-control hygiene.** MCP tools edit live `UObject` state and can mutate, move, or delete VCS-tracked assets in a single call. Save and commit (or shelve) before any long MCP-driven session so the working copy is recoverable if Claude produces an unexpected result. Review the diff before submitting.

## What's Available

The host discovers tools through Unreal MCP Tool Search. Tools cover the full editor surface across these domains:

- **Actors and Scene** - spawn, transform, inspect, and delete actors; manage components and outliner folders
- **Blueprints** - create, edit graphs, add nodes, connect pins, manage variables, compile
- **Assets and Content** - find, load, save, move, duplicate assets; edit Data Tables, Curve Tables, String Tables
- **Materials** - author material graphs, create and configure material instances
- **Meshes and Textures** - inspect/edit static and skeletal meshes, LODs, collisions, Nanite, sockets, bones
- **Animation** - build Control Rigs, inspect State Trees and Behavior Trees
- **Sequencer** - create and edit Level Sequences, keyframe animation, manage cameras, Control Rig integration, FBX import/export
- **VFX** - author Niagara systems and Dataflow graphs
- **UI** - build UMG widget blueprints, automate Slate UI interaction
- **Gameplay** - manage gameplay tags, inspect GAS state, create Game Feature Plugins, edit physics assets
- **Testing** - discover, run, and inspect C++ automation tests with detailed results
- **Editor** - screenshots, camera control, actor/asset selection, content browser, log inspection
- **Scripting** - batch multiple tool calls into a single Python script execution
