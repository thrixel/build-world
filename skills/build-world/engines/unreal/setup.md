# Setup

## General guideline for agents

Assume little knowledge about Unreal from the user, and do as much as you can automatically.
Minimize the amount of manual GUI steps needed, and if any are needed, ask/explain to the user
in plain and simple language. In practice everything in this file can be done without the user:
editing the `.uproject` and `.ini`, restarting the editor, and talking to the MCP server from a
shell.

## Requirements

- Unreal Engine version >=5.8 (to use the official MCP server).
  Detect it yourself: `~/.config/Epic/UnrealEngine/Install.ini` (Linux) maps the
  `EngineAssociation` GUID in the `.uproject` to the install path; on Windows look in the
  registry / `%PROGRAMDATA%\Epic\UnrealEngineLauncher\LauncherInstalled.dat`. If you can't,
  ask for the path to the engine installation. Direct the user to install or upgrade to the
  latest version if Unreal >=5.8 is not available.
- Confirm the plugins exist: `<Engine>/Engine/Plugins/Experimental/ModelContextProtocol` and
  `<Engine>/Engine/Plugins/Experimental/Toolsets/AllToolsets`.

## Project initialization

Before doing anything, make sure the user points you to, or you can see in the working
directory, an existing project folder with a `.uproject` file. If there is none, walk them
through creating one using the editor. Advise on a starting template that fits the game
(First Person, Third Person, Blank...).

Then go through the setup procedure in `EpicGames-UnrealMCP-skills/setup.md`, which ensures the
project has the plugins needed for MCP enabled and the editor's MCP server is active and
reachable. Do the file edits yourself:

1. `.uproject` -> `Plugins`: `ModelContextProtocol` and `AllToolsets` (`"Enabled": true`), plus
   any engine plugins the game needs (`Water`, `Niagara`...). Enabling through
   `PluginToolset.SetPluginEnabled` does not persist.
2. `Config/DefaultEditorPerProjectUserSettings.ini` in the project (create if absent). Do NOT
   append these to `Saved/Config/<Platform>Editor/EditorPerProjectUserSettings.ini`: the editor
   rewrites that file on exit from its in-memory settings and silently drops sections it did not
   load, so the server stops auto-starting after the first clean shutdown. The `Config/Default*`
   files are read-only inputs and survive.

   ```ini
   [/Script/ModelContextProtocolEngine.ModelContextProtocolSettings]
   bAutoStartServer=True
   bEnableToolSearch=True
   ServerPortNumber=8000
   ServerUrlPath=/mcp

   [/Script/UnrealEd.EditorPerformanceSettings]
   bThrottleCPUWhenNotForeground=False
   bDisableRealtimeViewportsInRemoteSessions=False
   ```

   The second section matters on headless/remote setups: without it the editor idles and the
   Play-In-Editor world stops ticking when nobody touches the mouse (see
   `community-field-notes/headless-autonomy.md` §4).
3. `.mcp.json` next to the `.uproject` (installed build) with the `unreal-mcp` HTTP entry.

## Interactive editing and saving

Use `-RenderOffscreen` for a headless interactive editor, including MCP and Pixel Streaming
sessions. **Omit `-Unattended` from these launches.** Keep it for automated commandlets or
tests that handle saving and exit explicitly.

### Why Save All can silently fail

Verified in the installed UE 5.8.2 source, `Engine/Source/Editor/UnrealEd/Private/FileHelpers.cpp`:
the normal checkout-and-save path returns `PR_Cancelled` when `FApp::IsUnattended()` is true
and `bAlreadyCheckedOut` is false. This can leave a map dirty after Save All, with no dialog;
restarting then discards the edits. Writable filesystem permissions do not prevent this.
This is a verified 5.8.2 behavior; check the implementation when using another engine version.

### Recover an existing unattended editor session

Do not restart while user edits are unsaved. Work on the editor world outside Play/Simulate;
changes made only to a preview world need to be transferred to the editor world first.
In the Output Log's **Cmd** box, run:

```text
py import unreal; print(unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)); print(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
```

The direct Python save handles dirty map and content packages; the second call explicitly
saves the current level. Inspect the return values and Output Log, then check remaining packages:

```text
py import unreal; print([p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]); print([p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()])
```

Confirm both lists are empty and the expected files have updated timestamps. If saving fails
or a package remains dirty, keep the editor open and investigate. After saving succeeds,
restart without `-Unattended`. Changing a launcher does not change an already-running process.
Normal Save Current Level and Save All should then work; verify with a small saved edit.

## Is the editor already running?

Check before launching a second one: `ps aux | grep UnrealEditor` and `ss -ltnp | grep :8000`.
If it runs but was started before the plugins were enabled, it must be restarted - plugins
load at startup. Read the current command line from `/proc/<pid>/cmdline` (Linux) so the
relaunch keeps the user's relevant flags (Pixel Streaming, resolution, offscreen rendering...),
removing `-Unattended` for an interactive editor. Inspect dirty map/content packages and save
them before stopping the editor; missing transaction log lines do not prove the session is clean.
After confirming persistence, stop the editor, wait for exit, and relaunch with
`nohup <UnrealEditor> <project.uproject> <interactive flags> -ModelContextProtocolStartServer &`.
Startup takes 1-2 minutes; the server is ready when the log contains
`LogModelContextProtocol: Starting MCP server on port 8000`.

## Connecting

- If your harness already lists `unreal-mcp` tools (`list_toolsets` works), use them.
- If not - typically because `.mcp.json` was written after the harness started - do **not**
  ask the user to restart the harness. Use `tools/uemcp.py` (see `tools/README.md`) to call the
  server over HTTP from the shell; it needs nothing but Python 3. The user's next session will
  pick up `.mcp.json` normally.
- Verify with a read-only call: `uemcp.py call editor_toolset.toolsets.scene.SceneTools get_current_level '{}'`.

## Before the first mutating call

- `tar czf Saved/AgentBackup/Content-<date>.tgz Content` - cheap insurance.
- `AssetTools.find_assets` on `/Engine/BasicShapes` and your plugin content roots so you know
  what primitives and textures exist (`/Water/Textures/...` when the Water plugin is on).
- Dump toolset signatures once: `for t in <toolsets>; do uemcp.py sig $t; done > sigs.txt`.
