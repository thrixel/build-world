# Build World

Build interactive 3D worlds with high-quality assets from [Thrixel](https://thrixel.com/) and your AI agent of choice.

Claude Code (or your preferred agent) handles the logic, interactions, and scene setup. Thrixel generates, organizes, and manages the 3D assets. Save your coding agent tokens and time by using Thrixel to generate 3D assets faster and at higher quality than Claude Code.

Build World currently supports **Unity**, **Three.js**, and **Roblox Studio**. This page covers **Claude Code**, but the workflow works with other coding agents as well.

> Build World was previously called Goal to Game. The name changed because the skill goes beyond games: it can build interactive experiences, simulations, educational experiences, virtual tourism and historical recreations, AR/VR experiences, and more.

## Thrixel inside the Gauntlet Loop

Build World uses a Gauntlet-style iterative workflow for creating interactive 3D worlds. The agent calls Thrixel to generate and refine 3D assets inside the loop. The agent continuously builds, evaluates, and improves the world itself, including its gameplay, interactions, and assets. With Build World, you can vibe out a game or other interactive 3D experience from a single prompt, then keep refining it with follow-up prompts.

<p align="center">
  <img src="https://raw.githubusercontent.com/ThatCharlieK/READMEAssets/main/Thrixel-1prompt-to-game-readme.gif" width="600"/>
</p>



## Quick start

Steps 1 and 2 are once per machine. After that, a new game is just step 3.

> Using [Codex](https://thrixel.com/docs/build-world#codex) or
> [Gemini CLI](https://thrixel.com/docs/build-world#gemini-cli) instead? Each one
> installs Thrixel its own way - the
> [installation page](https://thrixel.com/docs/build-world) has the steps for both.

### 1. Install Claude Code and uv

```bash
claude --version
uv --version
```

**Both print a version? Skip to step 2.**

<details>
<summary><b>Not installed? Install commands here</b></summary>

**macOS, Linux, WSL**
```bash
curl -fsSL https://claude.ai/install.sh | bash    # the agent that writes your game
curl -LsSf https://astral.sh/uv/install.sh | sh   # runs the Thrixel connector
```

**Windows PowerShell**
```powershell
irm https://claude.ai/install.ps1 | iex
irm https://astral.sh/uv/install.ps1 | iex
```

⚠️ **NOW OPEN A NEW TERMINAL**, then re-run the check above. Skipping this is the number one cause
of `command not found`.

</details>

### 2. Connect Thrixel with [Claude Code Plugins](https://code.claude.com/docs/en/plugins)

Same on every platform:

```bash
# 1. Sign up and log in. Opens a page with a code, click Approve. The only manual step here.
uvx thrixel-mcp@latest login

# 2. One plugin carries both the skill and the Thrixel connector, for every project.
claude plugin marketplace add thrixel/build-world
claude plugin install thrixel@thrixel
```

Confirm both pieces landed:

```bash
claude plugin list     # thrixel@thrixel -> enabled
claude mcp list        # plugin:thrixel:thrixel -> Connected
```

**Both lines look right? You are done. Go to step 3.**

**Turn on updates (once).** Updates are off by default. In Claude Code:

1. Type `/plugin`
2. **Marketplaces** > **thrixel**
3. **Enable auto-update**

(Or update manually anytime: `/plugin update thrixel@thrixel`. Skipped this? No problem, the
agent tells you when a newer version is out.)

<details>
<summary><b>Installed manually before? Remove the old copies</b></summary>

The plugin includes both pieces, so your old install is now a duplicate. Remove it once.

<details open>
<summary><b>macOS, Linux, WSL</b></summary>

```bash
claude mcp remove thrixel
rm -rf ~/.claude/skills/build-world ~/.claude/skills/goal-to-game ~/.claude/skills/thrixel
```

</details>

<details>
<summary><b>Windows PowerShell</b></summary>

```powershell
claude mcp remove thrixel
Remove-Item -Recurse -Force "$HOME\.claude\skills\build-world","$HOME\.claude\skills\goal-to-game","$HOME\.claude\skills\thrixel"
```

</details>

</details>

### 3. Ask for a game

```bash
# Run this wherever you keep projects. Claude makes the project folder itself.
claude --permission-mode auto
```

**Into Claude Code** (not the terminal), start the line with **`/thrixel:build-world`**, then
describe the game and name the engine (three.js, Unity, or Roblox Studio):

```text
/thrixel:build-world build a submarine exploration game in three.js set in a bright, vibrant tropical sea with coral and fish
```

> [!TIP]
> Type `/thr` and Claude completes **`/thrixel:build-world`** for you, so you never type it in
> full. If the completion does not appear, the skill is not installed - go back to step 2.

> We recommend setting /model to Opus 5 or a more capable model, with effort set to high or above.

Claude checks your Thrixel account and starts building. Keep talking to it in plain English to
change things.

<details>
<summary><b>No plugin? Install the <a href="https://code.claude.com/docs/en/skills">skill</a> and the <a href="https://modelcontextprotocol.io">MCP connector</a> separately</b></summary>

Replaces steps 2 and 3 above. Same start command either way: `/thrixel:build-world`.

**2. Connect Thrixel**

<details open>
<summary><b>macOS, Linux, WSL</b></summary>

```bash
# 1. Sign up and log in. Opens a page with a code, click Approve. The only manual step here.
uvx thrixel-mcp@latest login

# 2. Install the Thrixel connector. --scope user covers EVERY project, not just this folder.
claude mcp add --scope user thrixel -- uvx thrixel-mcp@latest

# 3. Install the skill. Clone, not download, so it can update itself later.
git clone https://github.com/thrixel/build-world ~/.claude/skills/thrixel
```

</details>

<details>
<summary><b>Windows PowerShell</b></summary>

Same three commands. Only the path differs: `~` is not reliably expanded when PowerShell passes it
to git, and a skill that lands anywhere else is invisible to Claude.

```powershell
uvx thrixel-mcp@latest login

claude mcp add --scope user thrixel -- uvx thrixel-mcp@latest

git clone https://github.com/thrixel/build-world "$HOME\.claude\skills\thrixel"
```

</details>

Confirm both landed:

```bash
claude mcp list        # thrixel -> Connected
ls ~/.claude/skills/   # thrixel listed
```

If either is missing, Claude will build the game without Thrixel and never mention it.

**3. Ask for a game**

Identical to step 3 above, same command and all:

```text
/thrixel:build-world build a submarine exploration game in three.js set in a bright, vibrant tropical sea with coral and fish
```

</details>

<details>
<summary>Something went wrong</summary>

**"command not found"** - **open a new terminal.** Fixes it almost every time. If a fresh terminal
still fails, run `export PATH="$HOME/.local/bin:$PATH"` (PowerShell:
`$env:Path = "$HOME\.local\bin;$env:Path"`).

**Claude has no Thrixel tools** - check `claude mcp list` for `thrixel`. If missing, re-run the
`claude mcp add` line, then restart Claude.

**Claude says you need to sign in** - re-run `uvx thrixel-mcp@latest login` and click Approve. No
restart needed, just tell Claude to continue.

**"Out of cubes"** - cubes are Thrixel's generation credits. Claude shows you what is built, marks
missing assets as labelled blocks, and asks how you want to continue.

</details>

## Working with Thrixel API

Every asset generated through the Thrixel API is saved to your Thrixel workspace.

**Manage and Edit**: Visit [Thrixel Web App](https://thrixel.com/create) to view, manage, and edit your assets. If you make changes in the web app, ask your coding agent to pull the updated versions back into your game.

**Engine Agnostic**: Because your assets are managed in Thrixel rather than tied to one codebase, you can also reuse them across projects and engines. For example, you can prototype in Three.js and later ask your agent to rebuild the game in Unity using the same asset library.

**Parallel Processing**: Thrixel can manage and process jobs in parallel. Your coding agent can farm out parallel jobs to Thrixel while building out the logic of the game. Each [plan](https://thrixel.com/create/#upgrade) has a different concurrency limit.

## Usage and credits
You can test this workflow using the free Thrixel Cubes included with your Starter account. However, building a full-scale game generally requires a wider variety of assets and rapid iteration that usually exceeds Starter limits. Upgrading to a [Paid Plan](https://thrixel.com/create/#upgrade) unlocks higher parallel job processing capacity and higher generation limits, allowing you to bring your most ambitious ideas to life. You can keep track of your remaining Cubes anytime in [Account Settings](https://thrixel.com/create/#settings/billing).

## About Thrixel
Learn more about Thrixel at [thrixel.com](https://thrixel.com/).
