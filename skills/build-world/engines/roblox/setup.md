# Roblox toolchain setup
You must use the following setup for Roblox game development. Three independent pieces, all required:
- **Rojo** — syncs game code from disk into Studio. Makes the project file-based and editable.
- **Roblox Studio MCP server** — runs Luau inside the live session and takes screenshots.
  Ships inside Studio; nothing to download.
- **An Open Cloud API key** — the only scriptable way to get a mesh into Roblox. Rojo
  cannot sync binary assets at all, so without this there is no Thrixel pipeline.

Prerequisites: Roblox Studio installed, and `curl`.

**Three steps need the user and cannot be automated: enabling the MCP server in Studio,
creating the API key, and clicking Connect in the Rojo plugin. Ask for all of them up
front.** The key in particular blocks every asset, and a build that discovers this thirty
minutes in has wasted thirty minutes.

# Instructions to tell the user
The user may not, and should not need to, understand Rojo, roblox MCP, etc. The clicks on their end
should be minimized and the instructions you tell them should be simple and straightforward. Once they
enter a prompt, do the minimal amount of work to setup the project and tell them what they must do within
roblox. So prompt -> ~20s of making the roblox scene -> ask the user. To ask the user, format a nice
short response with casual language telling the user that they must open the roblox studio app, and connect rojo.
This response should be extremely clear to the user, and it should be no longer than 4 sentences at most.


## 1. Rojo

```sh
curl -sSf https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.sh | bash
. "$HOME/.rokit/env"
rokit init
rokit trust rojo-rbx/rojo
rokit add rojo
rojo plugin install
```

Rokit is a toolchain manager; it pins the Rojo version in `rokit.toml`.

Two things that will bite an unattended agent:

- `rokit add` fails without the `rokit trust` line first — it wants an interactive
  confirmation and there is no TTY.
- The installer only edits your shell profile, so PATH is not live in the current shell.
  Source `. "$HOME/.rokit/env"` before every `rokit`/`rojo` call in a script.

On a machine that already has a `rokit.toml`, all of the above collapses to `rokit install`.

Scaffold and launch:

```sh
rojo init
rojo build -o game.rbxl
rojo serve
```

Then open `game.rbxl` in Studio, open the **Rojo** plugin from the Plugins toolbar, and click
**Connect**. Studio now updates whenever a file changes.

Verify with `rojo serve` running:

```sh
curl -s http://localhost:34872/api/rojo
```

## 2. Roblox Studio MCP server

Register it with your client:

```sh
claude mcp add --scope project Roblox_Studio /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP
```

On Windows the command is `cmd.exe /c %LOCALAPPDATA%\Roblox\mcp.bat`.

**Then enable it inside Studio — the server does nothing until you do.** This is a GUI-only
step; ask the user to do it and wait:

> In Studio, click the **Assistant** icon in the cluster of small icons at the far top-right of
> the window (same row as the Home/Avatar/UI tabs — it is not in the ribbon). In that panel:
> **…** → **Manage MCP Servers** → turn on **Enable Studio as MCP server**. A green indicator
> confirms it.

Skip the panel's **Quick connect** toggle — it writes its own config entry and you end up with
the server registered twice.

Restart the client so it picks up the new server. Confirm with `list_roblox_studios`: it
returns the open Studio instances and their ids. Every other MCP tool requires a `studio_id`
from that call.

If the tool list comes back empty, the in-Studio toggle is off — that is the failure mode, not
a bad config.

## 3. Open Cloud API key

Rojo does not sync meshes. Roblox's Open Cloud Assets API is how they get in, and it needs
a key that only the account owner can create. GUI-only — ask, and wait:

> Go to **https://create.roblox.com/dashboard/credentials** and click **Create API Key**.
>
> 1. **Name**: anything, e.g. `ThrixelBuildWorld`
> 2. **Access Permissions** → **Add API System** → choose **Assets**
> 3. Set the owner to **your own account** (not a group), then tick **Read** and **Write**
> 4. **Security** → **Accepted IP Addresses** → add `0.0.0.0/0`, or turn IP restriction off
> 5. **Expiration**: 30 days is fine
> 6. **Save**, then **Copy the key** — it is shown once
>
> Save it to `roblox_api_key.txt` in the project root.

Add that filename to `.gitignore` before anything else.

Step 4 is the one that silently breaks things: the IP allowlist is a required field, and
leaving it empty makes every request fail with a 401 and no useful message.

You also need the user's Roblox user ID for the upload's `creationContext`. Do not ask for
it — read it from the open place:

```lua
-- via execute_luau, datamodel_type "Edit"
return game.CreatorId
```

Verify by uploading one asset and inserting it before generating a whole set.
[roblox.md](roblox.md) has the endpoints, the 20 MB limit, and the FBX-vs-GLB decision that
determines whether assets arrive with their part names and colours intact.

## 4. Thrixel

The asset pipeline is unchanged from the other engines — see
[../../SetupAndInstallationFlow.md](../../SetupAndInstallationFlow.md).

```sh
claude mcp add --scope project thrixel uvx thrixel-mcp@latest
```

If `thrixel_download` gives you trouble, you can call the Thrixel API directly —
[roblox.md](roblox.md) has the conversion endpoints.

## Checklist before building anything

- `rojo serve` running and the Studio plugin shows connected
- `list_roblox_studios` returns your place
- A trivial `execute_luau` call round-trips
- `screen_capture` returns an image
- Thrixel tools respond
- One test asset uploads via Open Cloud and inserts into Studio with its texture intact
