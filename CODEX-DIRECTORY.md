# Codex directory build

This branch is what gets uploaded to the OpenAI plugin directory. `main` is the
Claude Code plugin and stays the source of truth; this branch is `main` plus one
commit, and it only ever moves by rebasing forward onto it.

## Live listing

| | |
| --- | --- |
| Version | 1.1.1 |
| Listing | https://chatgpt.com/plugins/plugins_6a7d2cd3322881918351d952417730fa |
| Portal | https://platform.openai.com/plugins |

## What differs from `main`

`.claude-plugin/plugin.json`, `assets/`, and this file. Nothing else, so rebase
forward rather than merging back: `interface` is unknown to Claude Code and
`claude plugin validate` reports it as a warning, which is why it stays off
`main`.

`description` also differs. The directory serves **skills only**: `mcpServers`,
`mcp.json` and `.mcp.json` are stripped at upload, so the wording on `main` that
says the plugin bundles the connector is not true of this build. The skill
registers the connector itself on first run, and
`skills/build-world/SetupAndInstallationFlow.md` is the file that carries that
path for directory installs.

The uploader reads the listing copy out of a **top-level** `interface` object,
not out of the `extensions."com.openai"` namespace the portable-manifest docs
describe. `interface.logo` and `interface.composerIcon` must both be square;
`assets/` holds the brand mark trimmed to its content and centred on a
transparent square at 1024px and 512px, since the source mark is 1024x978 with a
transparent margin.

## Fields the manifest cannot carry

**Subtitle** (30 characters, currently "Your 3D creation engine") and
**Capabilities** live in the portal only. There is no manifest field for either,
so check both after every upload rather than assuming an upload preserved them.

Everything else in the listing comes from `interface`, so editing a value in the
portal without bringing it back here means the next upload overwrites it.

## Cutting the next version

1. Rebase onto `main` so the skill content is current.
2. Raise `version`.
3. Push, then take the branch zip:
   `https://github.com/thrixel/build-world/archive/refs/heads/codex-skills.zip`
4. Upload it in the portal. The validator reports one problem at a time, so read
   every field it names before re-zipping.
