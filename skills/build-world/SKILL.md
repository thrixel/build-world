---
name: build-world
description: Builds polished, fully playable 3D browser games in three.js, with high-quality .glb models from the Thrixel API, and publishes each finished game to a public thrixel.world link that anyone can play. Use when the user wants to make a game, build a playable prototype, or generate 3D assets, and also when they want to publish or host a game folder they already have, share a playable link, or list, rename, update, unpublish or find the link for a game they published earlier.
---

# This is the ChatGPT build - read this section first

This copy of the skill runs in ChatGPT, not on the user's computer. The Thrixel connector
is Thrixel's hosted server, and there is no local machine, terminal, GPU or browser for you
to use. **Where anything below conflicts with this section, this section wins.**

- **three.js only.** Unity, Unreal and Roblox need an engine installed on a computer. If the
  user asks for one of them, say this build makes three.js games and offer that, or point
  them to the Claude Code or Codex version of Thrixel on their own machine.
- **Nothing to set up.** Sign-in happened when the connector was added.
- **Static files, no build step.** Write plain HTML and ES modules. Load three.js from a CDN
  with an import map, for example:
  `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>`.
  No bundler and no build step.
- **Models stay on Thrixel.** Generation tools return a download link and a `submission_id`
  instead of saving a file. Do not paste model data into your files. In the game, load each
  model from a path of your choosing (`models/boat.glb`), and remember which `submission_id`
  belongs to each path: publishing packs them in for you.
- **Never hand out a localhost address.** Nothing is served locally, so a `localhost` link
  leads nowhere. The user's link is the one publishing returns.
- **You cannot run the game here.** There is no browser or GPU, so there is no preview
  video either: leave `cold_open` off. Check the game by reading your own code carefully instead: every model
  path you load appears in `assets`, every control you describe is wired up.
- **Publish automatically when the game plays end to end.** This replaces the serve-and-ask
  step of asking first. Call:

  ```
  thrixel_publish_game(
      files={"index.html": "...", "js/main.js": "...", "css/style.css": "..."},
      assets={"models/boat.glb": "<submission_id>", "models/dock.glb": "<submission_id>"},
      title="...", controls="...", controls_touch="...",
      description="...", engine="threejs", genre="...", tags="...",
  )
  ```

  `files` holds every file except the models (text; a data URI for a binary such as
  `cover.png`), with `index.html` at the root. Everything in "Publish" about `controls`,
  `description`, `genre` and `tags` applies.
- **Then give the user the link.** The publish result carries the game's public
  `https://<slug>.thrixel.world` URL; put it on the first line of your closing message.
  To change the game later, publish again with the same `game_id`: the link stays the same.

# Cubes in this build

Generating models spends the Cubes on the user's Thrixel account. This build never talks about
money beyond that:

- **Never offer, recommend or describe plans, upgrades, top-ups, prices or promotions,** and
  never send a payment or checkout link. There is no money question to ask at any point.
- **Before generating,** call `thrixel_account_status`, and say in one line where the balance
  runs out in the ranked asset list (see "Draw the line through the list"). Then carry on
  without waiting.
- **If the Cubes run out,** finish the game with what exists (unbuilt assets stay as simple
  blocks), publish it, and say plainly which assets are still blocks and that they can be
  generated once the account has Cubes again. Their Cubes and plan are managed in their
  Thrixel account at https://thrixel.com, which is the only place to point them.

# What is being asked for - route before you read further

This skill covers three jobs, and only one of them is a build. Decide which one
you are on now, because the wrong route wastes a lot of the user's time: an agent
asked to publish a folder that starts planning an asset list and calling
`thrixel_account_status` looks like it did not read the request.

**1. Build a game** ("make me a game", "build a X prototype"). The default, and
the rest of this file. Continue below.

**2. Publish a game the user pastes or uploads here.** Collect its files into `files`
(index.html at the root) and publish, as in **Publishing to thrixel.world**. No assets are
generated, so skip the asset list and every generation step.

**3. Manage what is already published** ("what have I published?", "what was the
link for my racing game?", "take the golf one down", "rename it", "hide it from
the directory"). One or two tool calls and an answer. Go straight to **Managing
published games**. Do not read the rest of this file.

Jobs 2 and 3 need no Thrixel plan, no cubes and no account balance - publishing is
free. The only requirement is a signed-in account, which the MCP server handles;
if it is not signed in, the tool says so.

# Overview

Use Thrixel for 3D assets. Use the target engine to orchestrate game logic, UI, effects, and sounds.
The game MUST be polished and visually stunning. The game should do everything thats
done in a AAA game, anything from high quality models and environment polish, to physics, including:
- UI (HUD, health bars, etc.)
- A mix of Architect and Architect -> Detailer meshes from Thrixel
- Visually stunning environments (atmosphere, terrain if relevant, set and background dressing, shaders)
- Rigorously playtested gameplay with intuitive keyboard controls
- **Playable on a phone**, with touch controls and a HUD that fits a small screen
- Optimized framerate of at least 30 FPS

## Mobile is a requirement, not a port

**Build every game to be playable on a phone from the start.** The finished game
becomes a public link (see Publishing, below), the user sends that link to
someone, and that someone opens it on a phone. A game that needs WASD is dead on
arrival for most of the people who will ever see it.

This is a design constraint before it is a technical one, so decide it while you
are deciding the controls, not afterwards:

- Every action needs a touch equivalent. A scheme built on a modifier key, a
  scroll wheel, or four simultaneous keys cannot be retrofitted onto two thumbs.
- On-screen controls have to be visible. Touch input with no visible controls is
  the most common mobile failure and it does not read as a bug to the player:
  they see a 3D scene, tap once, and leave.
- HUD text and buttons have to work at 390 px wide, with 44 px as the floor for
  anything pressable.
- A phone reports `devicePixelRatio` 3, so an uncapped renderer asks a phone GPU
  for several times the pixels of a laptop. Cap it.

The three.js kit does most of this for you: `lib/input.js` feeds touch into the
same input snapshot the keyboard feeds (so gameplay code needs no touch branch), and
`lib/touchui.js` draws the on-screen controls. Read the Mobile section of
[engines/threejs/threejs.md](engines/threejs/threejs.md).

**Never report a property you did not measure.** You cannot run the game in this build,
so do not say it "works perfectly" or runs at 60 FPS. Say what you built and checked in the
code, and that the user can try it at the link.

Pay special attention to mesh quality, realism, character quality, and UI to ensure it looks AAA.
Work alone, do NOT launch subagents to do work - subagents will interfere with each other and make
everything more difficult. However, frequently launch subagents as harsh critic agents to inspect
your work. If the subagent determines the game doesn't look absolutely AAA, you must continue the
build until the subagent decides the game looks good enough.

## Player Guidance and UI Design

Teach and guide the player primarily through the **game itself**, not through HUD explanations.

The first question should not be “what UI should explain this?” but **“how can the game design communicate this?”** Use level layout, encounters, environmental cues, animation, sound, object behavior, NPC dialogue, diegetic signs/displays, pacing, and player experimentation to convey mechanics and objectives whenever practical.

A mechanic can be introduced by creating a safe situation where the player naturally discovers it. A required action can be taught by designing an obstacle that makes that action necessary. A control can appear on a sign, device, NPC prompt, or other element that belongs in the world. Sightlines, lighting, landmarks, contrast, recurring colors/materials, and spatial composition can guide attention without explicitly telling the player where to go.

The player does **not** need to understand everything immediately. It is often better to let them experiment, notice patterns, and build an understanding through play. Introduce complexity progressively and make cause and effect clear enough that the player can learn from what happens.

### Use Non-Diegetic UI Sparingly

HUD space and player attention are scarce. Treat **all onscreen text—persistent or temporary—as something that must justify interrupting the game**.

Persistent UI should primarily show information the player genuinely needs during play, such as health, resources, time, score, or other important state. Temporary text should not become a substitute for good teaching or level design.

Generally avoid:

- persistent chapter, area, or scene titles that are not useful during play;
- prose explaining mechanics or controls;
- repeated reminders of basic actions;
- text that merely narrates what just happened;
- decorative or poetic flavor popups attached to ordinary interactions or collectibles;
- labels that restate information the world already communicates.

For example, collecting an important item can usually be communicated through animation, sound, effects, and a visible state change rather than a flavor text popup on the screen. Likewise, a mechanic such as rolling or dashing should preferably be taught through play rather than a popup explaining how the player can roll.

If explicit instruction is genuinely needed, keep it **brief, contextual, and integrated into the experience**. Showing `Shift - Roll` beside the first obstacle that requires rolling is very different from repeatedly explaining the mechanic in the HUD.

### Design Hierarchy

When deciding how to communicate something to the player, prefer roughly this order:

1. **Game and level design** — let the player learn by doing.
2. **Environmental/diegetic communication** — world design, NPCs, signs, objects, animation, audio, and feedback.
3. **Minimal contextual UI** — only when the first two approaches would be unclear or impractical.
4. **Persistent explanatory UI** — use only when the game genuinely requires it.

Do not add text simply to make the game completely self-explanatory. Some uncertainty, experimentation, and discovery are part of good gameplay.

The UI that does exist should also feel like part of the game's **visual identity**. Typography, shapes, iconography, spacing, motion, and materials should fit the game's art direction and tone rather than feeling like a generic overlay.

These are principles, not rigid rules. Different games communicate differently. The goal is to make the **game itself do as much of the teaching and guiding as possible**, with UI supporting the experience rather than explaining it.

# Plan the asset list - REQUIRED first step when BUILDING a game
**"Required" means required on the build path.** If the user asked you to publish a folder
they already have, or asked about games they published earlier, none of this section applies -
no assets are being generated, so there is nothing to plan or to spend. Go to Publishing or to
Managing published games.

Otherwise, once the user has asked for a game, do this FIRST. It applies to every game, whether
this is the user's first game or their tenth.

**Size the asset list to the game, never to the balance.** Write out every 3D asset the game
needs in order to be good, then rank that list by how much the player will notice each item.
Build in that order. The balance decides how far down that list this session gets; it does not
decide how big the idea is. Do not shorten the list, downgrade a tier, or cut a feature because
of what the balance says - a game planned around a cube budget is a smaller, duller game, and
the game is the point. Not before the user has had a chance to say how ambitious they want this
build to be, either.


**Call `thrixel_account_status` and read the real numbers.** Do not assume a plan. It returns the
user's plan, cube balance and concurrent-job cap. The cap is the number that changes what you
*do*: it limits how many jobs may run at once. The balance does not change the plan, it only
tells you how far down the ranked list you will get before you have to ask.

**Never state a cap or cost from memory, including from this file.** `thrixel_account_status`
reads live from Thrixel. Numbers written into this file eventually are not.

## Draw the line through the list before you generate anything

You have the list the game wants and the balance that exists. Work out where one meets the
other now, at the desk, rather than discovering it later when a call fails.

1. **Rank the whole list as if cubes were unlimited.** A chicken farm wants twenty things.
   Write all twenty, then order them by how much a player would miss each one.
2. **Estimate how far the balance reaches, costing the list by subject.** Architect is
   metered on object complexity, so one average across a mixed list is the wrong tool: a
   character costs the better part of two props, and a list that is mostly characters and
   buildings runs out at half the count a flat average predicts. `thrixel_create_model`
   publishes a typical cost per subject; take the absolute numbers from there and from
   `thrixel_account_status`, and add the flat price for every asset you also intend to detail or
   sculpt. Cost the ranked list row by row and stop where the balance does.

   Approximate is still the point. You are looking for "about eight of these", not a figure
   to defend.
3. **Say where the line falls, in one line, before the first generation call.** "Twenty things
   would make this farm properly. Your balance covers roughly the first eight, so the coop, the
   hens and the feed trough get built and the tractor, the silo and the scarecrow start as
   blocks." Then start. It is a statement, not a question - do not wait for an answer.
4. **Build above the line, block out below it, then finish the game.** Everything under the line
   goes into the scene as a labelled placeholder at the right size and in the right place, and
   the game logic is written against the FULL list. What ships is a complete game with some of
   its art still grey, which is playable, rather than a fraction of a game, which is not.

**Do this on every account.** A plan name is not a balance: the allowance arrives
once a billing month and spends down from there, so an account on the largest plan, late in its
cycle, can be holding less than a brand-new free one. Reading the plan name instead of the
number is how a paying user ends up starting a twenty-asset game with seven assets' worth of
cubes.

**If the balance reaches the whole list, there is nothing to say.** No line, no news.

**Re-check `thrixel_account_status` every few assets.** Estimates drift, and a balance that
jumped means Cubes were added: move the line down and carry on in the same ranked order.

### The line is a forecast, not a quota

It exists so the user knows what to expect, and it is deliberately approximate. Treating it as a
budget to stop at leaves cubes unspent and the game thinner than the balance was good for, so
keep working down the ranked list until the service says no. Whether the balance covers the next
item is something it will tell you, at no cost, more accurately than an estimate can.

Two kinds of operation, gated differently, so "no" arrives in two shapes:

- **Create and Edit are priced after the run**, so the only question is whether
  anything is left. Any positive balance buys one more, and a single overrun past zero is
  absorbed rather than refused mid-job. Worth attempting even when what remains looks small
  for it.
- **Detailer, Sculptor and Texture cost a flat price** the balance has to cover up front. Once
  it no longer does, those are finished for the session while a Create may still go through.
  That is a reason to reorder rather than to stop; a plain Architect asset is still worth having.

So the build ends when the service refuses, or when `thrixel_account_status` reports nothing
left, rather than at a number estimated earlier.

## What things cost

Read the current costs from `thrixel_account_status` and the generation tools' own
descriptions. The shape is what matters here, and it is stable even when the numbers are not:

- **Detailer, Sculptor, Texture: a flat price per run, plus a reference image when you give
  them only a prompt.** The flat part buys the GPU run. Handed just text, the service also has
  to generate the image the run works from, and that is billed on its own - roughly a third
  again on top. Passing an image, or reusing one with `reference_image_id`, skips it. Budget
  the prompt-only case or your arithmetic is short on every one of them.
- **Reduce triangles, rebake: free.** Always use `thrixel_reduce_triangles` to hit a triangle
  budget; never re-run the detailer at a lower target to make something lighter.
- **Architect: metered on real usage and charged after the run**, so it varies by what the
  object is. Props are the cheap end, vehicles a little more, buildings more again, and
  characters and creatures the expensive end at roughly two props each. The tail is long:
  about one asset in ten costs double its subject's typical figure, which is why a plan
  costed at the typical figure needs headroom rather than exactness. `thrixel_create_model`
  carries the current per-subject numbers; take the balance from `thrixel_account_status`.

  **Object complexity moves the cost far more than any setting you control.** There is no
  tier-shopping decision to make here - the numbers are for planning the order of work, not
  for finding a cheaper way to build the same asset.

## Quality tier - always Plus

**Always use `plus`. It is the default when you omit `quality`, so the correct action is to
omit it.**

Do not pass `balanced` on your own initiative - not to save cubes, not because the balance
looks low, not because the asset seems simple, and not because the user said something
general like "keep it cheap". The only time you pass it is when the user explicitly names a
lower tier and asks you to use it. That is an advanced override, and it is never the default.

- `plus` - the default, and the right answer for essentially everything.
- `balanced` - only if the user explicitly asks for it.

The two tiers are a flat 2x apart on price, so a set built entirely on Plus does cost about
twice a set built entirely on Balanced. That is a known and accepted cost: the balance buys
fewer assets and every one of them is the better version. Where the balance is the binding
constraint, cut the asset list rather than the tier - a shorter list of assets that look
right beats a longer one that does not, and the ranking in "Draw the line" already says
which ones to cut.

Instancing is a *scene-dressing* technique, not a savings technique: rotating, scaling and
recoloring one mesh into a row of crates is good level design, and retexturing against a shared
`reference_image_id` gets variants cheaply. Use it where it makes the scene better. Do not use
it to avoid generating an asset the game actually needs.

Do not downgrade the *generation type* to save money either. Sculptor vs architect vs
architect+detailer is a correctness choice, made by the rules below.


# Target engine

three.js, always, in this build. Read [engines/threejs/threejs.md](engines/threejs/threejs.md)
**in full** before writing the game; its kit in `engines/threejs/lib/` is plain browser modules
you can copy into `files`.

# Thrixel asset generation

Thrixel turns text or image prompts into meshes, downloadable as `.glb`, `.fbx`,
`.obj`, `.stl`, or `.usdz`. Thrixel provides three main paths, depending on the user's need:
- "Architect" path: Generate low poly assets with smart hierarchy
- "Architect -> Detailer" path: Generate low poly assets, then run "detailer" to add high
quality high poly detail, retaining smart hierarchy
- "Sculptor" path: Immediately generate detailed high poly assets, no hierarchy

Thrixel also provides other utilities/sub-features:
- A  "Texture" follow-up can be run on ANY completed submission, regardless of type. Applies fresh materials
and preserves geometry exactly.

## Choosing a path per asset - ask this first

**Does any part of this asset have to move on its own?**

Wheels that spin, sails that turn, a turret that rotates, a door that opens, a lid, a limb,
a propeller. That single question decides the path, because **only Architect produces named,
separately addressable parts**, and it is the only property you cannot add later. Polygon
count and realism you can always change; a merged mesh can never be un-merged.

| Need | Path | Why |
|---|---|---|
| **Moving parts, lower poly, more stylized look** | Architect | Named part hierarchy, cheapest option |
| **Moving parts AND high poly, high quality, or organic/complex details** | Architect -> Detailer | The detailer mostly keeps the hierarchy, but see the caveat below: thin parts can still be lost |
| **Moving parts, and the shape is already right** | Architect -> Texture | Geometry is untouched, so every part and name survives exactly. Same price as the detailer |
| **Static, organic** (creature, character, plant, rock, food) | Sculptor | Best organic shapes, and cheaper than Architect -> Detailer |
| **Static, man-made, high poly, high quality, or organic and/or complex** | Sculptor | Nothing moves, so the part hierarchy buys you nothing and costs ~1.5x |
| **Static, stylized / low-poly, instanced a lot** (trees, rocks, crates) | Architect | Keeps triangle counts sane when placed hundreds of times |

**`adherence_level` runs 0 to 12, and 9 is the DEFAULT, not the maximum.** 9 keeps
`preserve_parts` on. **Below 9 the server merges the parts by default**, because holding a part
split together while the silhouette is being reshaped is what produced the remesh artifacts. So
if you chose Architect *for the parts*, do not lower adherence. If you truly need both, pass
`preserve_parts: true` explicitly and inspect the result.

**`preserve_parts: true` is best effort, not a guarantee, and thin parts are what it loses.**
The survivors are the thick parts. A propeller blade is thin, and thinness is what predicts
destruction, so the parts most likely to be destroyed are exactly the moving parts you chose
Architect to get.

**If parts must survive, set `adherence_level: 12`.** The default 9 is not enough. Measured on
one 78-part quadcopter blockout, same seed and same reference image, only adherence changed:

| | `adherence_level: 9` (default) | `adherence_level: 12` |
|---|---|---|
| parts returned | 28 of 78 | **35 of 78** |
| propellers | one gone, two returned as slivers | **all four, at full size** |

12 still drops very small decorative sub-parts (cooling slots, indicator rings), so it improves
the odds rather than guaranteeing anything.

**So: if the blockout's shape is already what you want, do not run the detailer at all.** Use
`thrixel_retexture_model` instead. It costs the same, gives the asset a finished look, and never
touches geometry, so every part and name survives exactly. The detailer is for when you want the
*shape itself* to gain detail. Always `thrixel_inspect_model` a detailer result and confirm the
parts you need are still there.

**Proportions matter too.** An asset whose bounding box is far from a cube - a building, a roof,
a floor plane, anything long and thin - comes back noticeably worse from both the Detailer and
the Sculptor, because the object fills only a small part of the working volume. For buildings,
texture rather than detail.

**What the paths cost relative to each other** (absolute numbers from the tools' own descriptions):

| Path | Cost | Note |
|---|---|---|
| Architect alone | Cheapest by a wide margin | Metered, so it varies with the object |
| Sculptor | One flat operation, plus a reference image if you gave it only text | Cheaper from an image you already have |
| Architect -> Detailer | Metered Architect **plus** one flat operation | The most expensive route. The detailer inherits the mesh, so no reference image is generated |

So **Architect -> Detailer costs roughly 1.5x a Sculptor**. That ratio is the decision;
the exact cube figures are not, and change without this file changing.

**If the object will not be animated, reach for the Sculptor directly.** What Architect ->
Detailer adds over a Sculptor is the named part hierarchy, and a static prop never uses it - so
on something that just sits there you are paying ~1.5x for articulation the game will not
touch. The Sculptor is built for exactly this case: static and organic subjects, one flat
price, the best organic shapes of the three paths. Pay the premium only where you need
articulation *and* fidelity on the same asset: the hero vehicle, the main character, and little
else.

Decide the moving-part list at planning time, not later. It is the same list you will pass to
`thrixel_group_parts`'s `keep_groups` (see Mesh grouping below), so writing it down early makes both decisions
at once.

## Other asset rules

- **Scale**: Thrixel is built for singular, well-defined objects ("a cute chunky bike"), and
  that is where it is strongest. Terrain, mountains and very large buildings are the engine's
  job - build the large-scale structure in engine code, use Architect for any blocked-out
  massing, and spend Thrixel on the props the player walks up to.
- **Complex visual features** (a dragon made of stained glass) need Sculptor or
  Architect -> Detailer. Architect alone gives flat-colored low-poly, which is the right look
  for a stylized set and the wrong one for a hero asset.
- **Use all three paths in a project** - for variance, for performance, and because each one is
  the right answer for a different kind of asset.
- **Iterate with follow-up prompts.** `thrixel_edit_model` holds every part outside
  `focus_on_node_names` bit-identical, so refining is cheap and safe. Place the asset, look at
  it in the scene, and revise it until it fits.
- **Never pass an `image`.** Text prompts only, on every endpoint. Thrixel generates and manages
  its reference imagery internally.
- **Every asset arrives at roughly the same size.** Scale is normalised, so a castle keep and
  a peasant import into the same bounding box. Nothing warns you; the castle just turns out to
  be a garden shed. Set relative scale explicitly at import - decide the real-world size of
  each asset class when you write the asset list, not when the scene looks wrong.
- **Up is always Y. Only FORWARD varies.** Thrixel exports Y-up on every asset, as glTF
  requires, so never write per-asset up-axis detection or a Z-up correction branch. glTF does
  not define a forward axis, though, so a long axis can land on X where you expected Z: read
  the bounding box or look at the thumbnail, decide the facing per asset, and correct it once
  at import rather than discovering it when a vehicle drives sideways. (If a pivot listing from
  `thrixel_group_parts` looks Z-up, that is Thrixel's internal working space, not the file -
  a real project once wrote "these assets came back Z-up" into a source comment on the strength
  of that listing and carried the wrong belief for its whole life.)

If necessary, read thrixel api docs here: https://thrixel.com/docs/,
but the vast majority of thrixel information is contained within this skill and the mcp.

## API Workflow

Use the **Thrixel MCP tools** for every generation step. Each one submits the job, waits for it,
returns a download link plus a rendered thumbnail - the whole round trip, handled. Do not
write your own polling loop or call the API any other way: across a build
with thirty assets, a hand-rolled loop is one dropped result away from a missing model that
nobody notices until the scene is assembled.

1. **Start a project, named after the game.** Free, one call, and it must come before the first
   generation:

   ```sh
   thrixel_start_project(name="Submarine Explorer")
   ```

   Everything generated afterwards is filed under it automatically. **Do not pass `project_id`
   on any other tool** - it is already handled, and threading it through thirty calls is how it
   ends up missing from three of them.

   This is the difference between the user opening the web app and finding this game's assets
   as a set, or finding every asset from every game they have ever built in one flat list. That
   cannot be sorted out afterwards, so it has to be right at the start.

   If the user is returning to a game they built earlier, call `thrixel_list_projects` and
   resume it instead, so the new assets join the old ones:
   `thrixel_start_project(project_id="<the id>")`.

   Each result tells you where it landed (`Filed under project: ...`). If that line is missing,
   you skipped this step - fix it before generating anything else.

   The project is also what a style guide attaches to (step 2a), and only generations inside
   it are given that guide - another reason this call comes first.

2. **Decide the shared style once, and put it somewhere the tools can apply for you.**
   Thirty prompts that each restate the style is thirty chances to state it slightly
   differently, and the set drifts. There are three places to put it, and they are not
   interchangeable:

   **a. Rules -> a project style guide.** Things you can state in words: polycount budgets,
   "flat colours, no gradients", "never add a ground plane", "a door is 2.1m tall", in-world
   naming. Write it once; it applies to every generation in the project from then on.

   ```sh
   thrixel_add_project_source(filename="style.md", content="...art direction, budgets, scale...")
   ```

   **b. Look -> a style reference.** How something should APPEAR: palette, material, finish,
   how worn it is. A paragraph is bad at this and a finished model is good at it. Build one
   asset you are happy with, then point the rest at it:

   ```sh
   hero = thrixel_create_model(prompt="a weathered wooden market stall")
   thrixel_create_model(prompt="a wooden barrel",
                        style_reference_submission_id=hero.submission_id)
   ```

   The reference contributes appearance ONLY - the subject always comes from your prompt.
   `thrixel_sculpt_model` takes it too. Give that one an `image` as well and it restyles YOUR
   image into that look, so what comes back is no longer the picture you passed in.

   **c. One-off tweaks -> the prompt.** Anything that applies to this asset and no other.

   Use a and b together. Text carries constraints, a picture carries appearance; asking
   either to do the other's job is where a set starts drifting.

3. **Generate base meshes** with `thrixel_create_model`, passing `quality` per the plan above.
   Run them in waves that respect the concurrency cap from `thrixel_account_status`.

   Generation runs in the background, so start it early and write systems while it runs, placing
   real assets as they arrive.

4. **Look at every thumbnail.** It comes back with the result, so there is no excuse to build on a
   bad asset. If the shape is wrong, fix it with `thrixel_edit_model` (natural language, and it
   holds every part outside `focus_on_node_names` bit-identical) rather than regenerating from
   scratch, which costs more and throws away what was already right.

   **Then refine it. This step is REQUIRED for every hero asset and it is the one agents skip.**
   Editing is where Architect assets get good, and a first generation is a draft, not a result.
   For anything the player sees up close, run at least one `thrixel_edit_model` pass and keep
   going until you would ship it:

   1. Place the asset in the scene and screenshot it **in context**, not in isolation. Wrong
      proportions only show up next to a door, a character, or the ground.
   2. Name the single worst thing about it. If you cannot, look harder - "it's fine" after one
      generation means you have not compared it to the reference.
   3. Fix exactly that with `thrixel_edit_model`, scoped with `focus_on_node_names` so the rest
      stays bit-identical. Look again.

   Editing is metered and cheap next to regenerating, so the loop costs far less than settling.
   Stop when the asset is genuinely good, not after a fixed number of passes.

5. **Detail pass (optional, animated assets only)** with `thrixel_detail_model` - one flat
   operation. Turns a blockout into high-resolution geometry with a PBR texture. Only worth it when the asset needs
   its part hierarchy *and* fidelity; for anything static, generate it with the Sculptor instead.
   Pass a `prompt` describing the finished look, and set `adherence_level: 12` so your named
   parts survive - the default of 9 loses thin ones. `texture_size` is 2048 or 4096;
   `decimation_target` around 20000 is a good game target. **Skip this step entirely if the
   blockout's shape is already right** - go straight to step 6, which costs the same and cannot
   damage the geometry. After any detail pass, `thrixel_inspect_model` the result and confirm
   your moving parts are still in the list; thin ones do get lost.

6. **Texture pass (optional)** with `thrixel_retexture_model` - one flat operation, new
   materials, geometry untouched. This is the cheap way to restyle a whole set: pass the same `reference_image_id` to
   every asset and they come back visually consistent, and reusing an image is not re-charged.
   `apply_to_node_names` restricts it to named parts.

7. **Hit the triangle budget** with `thrixel_reduce_triangles`. **Free.** Never re-run the detailer
   at a lower target to lighten something.

8. **Group the meshes before importing into the engine** (see below), then:

   ```sh
   thrixel_group_parts(submission_id=..., keep_groups=[...])
   ```

## Mesh grouping - required, not an optimisation

Thrixel returns a *named part hierarchy*: one mesh node per part. That naming is the whole
point of the Architect path, but the node count is high (ie dozens or hundreds). In engine,
this gives each object its own draw call and kills fps.

**`thrixel_group_parts` fixes this, and it is FREE.** It runs on Thrixel's servers. Run it on every model before importing into the engine.

- **Everything that does not move becomes one mesh** (default name `Body`). Material slots
  survive the join, so the semantic slots (`Paint`, `Glass`, `Chrome`, `Rubber`, `Rim`, ...)
  stay addressable per-surface. Re-skinning those slots with authored PBR is what makes
  independently generated assets look like one set. How the slots surface in your engine is
  in the engine file.
- **Named moving parts stay separate**, one mesh each, via `keep_groups`. Each gets its
  origin set to its own geometric centre, so the engine can spin or steer it in place
  instead of orbiting the model root. `FL` / `FR` / `RL` / `RR` auto-expand to the
  wheel-corner spellings Thrixel actually emits, so you can omit their aliases.
- **The result reports each group's pivot origin.** That is what you position and animate
  against; it is not recoverable from the GLB without re-parsing it. Pivots always sit at the
  group's geometric centre - right for a wheel, wrong for a turret or a head on a swivel,
  where the real axis is the mount point. Fix those in-engine: parent the part under an empty
  (Unity) or a `THREE.Group` placed at the mount point, and rotate the parent.
- **Scattered props get a triangle budget** via `target_triangles`, applied to the merged
  mesh only. Kept groups are left alone, because decimating a wheel to hit a whole-model
  budget wrecks it. Sculptor output is deliberately dense - trees arrive at 90-160k triangles,
  which is what you want for a hero close-up and far more than you want instanced hundreds of
  times. `target_triangles` serves both, and it is free.

```
thrixel_group_parts(
  submission_id = "<the detailed car>",
  keep_groups   = [{"name": "FL"}, {"name": "FR"}, {"name": "RL"}, {"name": "RR"}],
  target_triangles = 20000,
)
```

**Call `thrixel_inspect_model` first to get the real part names.** A `keep_groups` entry
that matches nothing **fails the job on purpose**. Silently welding a moving part into the
body gives you a model that looks perfect and simply never animates, which is far more
expensive to debug than a failed job.

Two things it handles that are easy to get wrong by hand: matching part names requires
tokenising the node path (regex `\b` fails on `_`, so `\bfl\b` never matches `FL_spoke0`),
and structural parts nested *inside* a moving group - `FL_arch`, `FL_Coil3` under
`FL_Wheel_Group` - must be excluded or the wheel arch spins with the tyre.

### If you decimate a GLB yourself, weld first

`thrixel_reduce_triangles` already handles this, which is the main reason to use it. If you
reduce a Thrixel GLB with your own tooling instead, **weld coincident vertices before you run
the decimator** (Merge by Distance in Blender, `mergeVertices` in three.js).

glTF has no per-face UVs, so a textured GLB arrives with its vertices split along every UV
island boundary. Those duplicates sit in the same place but are not connected, so a collapse
decimator pulls them apart and the seams open into large visible cracks.
`thrixel_reduce_triangles` welds first, which is why it does not. Welding does not disturb the
UVs, which are stored per-corner, so each island keeps its own coordinates.

Better still, do not decimate by hand at all - `thrixel_reduce_triangles` is free and already
correct.

# Publishing to thrixel.world

Publishing puts the game at a public `https://<name>.thrixel.world` address that anyone with
the link can play in a browser, phone included. It is free, and every later publish with the
same `game_id` updates the same address. In this build it is automatic: publish as soon as the
game plays end to end, as described at the top of this file.

## Assemble the bundle

The bundle is what `files` and `assets` describe: `index.html` at the root, the JavaScript and
CSS it loads, and the models by path. There is no build step, so what you write is what ships.
Include only what the game loads; leave out notes, drafts and anything else that is not part
of the game.

## Check it before it is public

The server refuses unsafe paths and skips junk files on its own, and it scans the bundle
for API keys and refuses to publish one it finds.

What the server cannot judge is what the files MEAN, and that is your job, because
you are the only one who has read them. Four things, quickly:

1. **Secrets.** Never put an API key, password or token in `files`. A game that calls
   an API from the browser needs the key in the browser, where anyone can read it, so
   the fix is a key that is safe to be public, or no such feature.
2. **Private files that came along for the ride.** Notes, screenshots of other
   things, documents, exports - a game folder often accumulates them. Name anything
   that does not look like part of the game and let the user decide.
3. **Content that is not theirs to publish.** Downloaded models, ripped audio,
   someone else's game. Local play and a public URL under their name are different
   things. If the folder is obviously somebody else's work, ask before publishing.
4. **What it actually is.** Publish games. Do NOT publish a page that imitates a
   real company's login, a payment form, a fake storefront, or anything built to
   look like a service it is not - regardless of how it is described. That is
   phishing infrastructure, and it is not a judgement call about the user's
   intentions: the platform must not host it. If a folder is that, say plainly you
   cannot publish it, and do not offer a workaround.

And one fact that is not a problem but must be said out loud before the link
exists: **a server component will be dead.** A multiplayer relay, an LLM proxy, a
score backend - only static files ship. Say which feature stops working, and make
sure the game degrades gracefully rather than hanging on a failed fetch.

## Publish

Use `thrixel_publish_game`.

```
thrixel_publish_game(
    files={"index.html": "...", "js/main.js": "..."},
    assets={"models/pan.glb": "<submission_id>"},
    title="Order Up!",
    controls="Arrow keys to move, Space to plate, Esc to pause",
    controls_touch="Drag a dish onto a plate, tap the bell to serve",
    description="A restaurant kitchen where the orders never stop and the timer always wins.",
    engine="threejs",
    genre="Simulation",
    tags="Cooking, Fast, Arcade",
)
```

**Pass every one of these. Nothing can recover them later.**

- **`controls`** and **`controls_touch`** - one line each, and both must be what
  you actually WIRED UP rather than what you meant to: read them off your own input
  code, keyboard and touch both. A stranger who opens this from the gallery and presses the wrong
  thing concludes the game is broken, which makes a wrong answer here worse than
  none.

  The page picks between them by POINTER TYPE, not screen size, so a phone gets
  the touch line and a laptop gets the keyboard one even at the same width. Omit
  `controls_touch` when the game plays the same either way - an absent line falls
  back to `controls`, so leaving it out says "no difference" rather than "no
  phone support".
- **`description`** - one sentence about the GAME, for somebody who has never seen
  it. This is the blurb a stranger reads on the game's card. Describe what the
  game IS, not what you built or how. "A restaurant kitchen where the orders never
  stop" - not "I built a restaurant game with a timer".
- **`engine`** - `threejs`.
- **`genre`** - ONE word, and it is the shelf the gallery files the game under:
  `Action`, `Shooter`, `Platformer`, `Puzzle`, `Racing`, `Strategy`, `Simulation`,
  `Adventure`, `Sandbox`, `Board`, `Tool`. Pick the closest one rather than the
  most flattering one. Anything outside the list is dropped, so inventing
  `Roguelike-lite` files the game nowhere.
- **`tags`** - up to four, comma-separated, describing what the game is LIKE:
  `Cozy`, `Relaxing`, `Fast`, `Atmospheric`, `Colorful`, `Retro`, `Neon`,
  `Sci-fi`, `Fantasy`, `Space`, `Steampunk`, `Underwater`, `Post-apocalyptic`,
  `Arcade`, `Story`, `Short`, `Endless`, `Creative`, `Turn-based`, `Realistic`,
  `Physics`, `Roguelike`, `Idle`, `Exploration`, `Collectathon`, `Builder`,
  `Tower defense`, `Stunts`, `Cooking`, `Time trial`, `Party`, `Two players`,
  `Multiplayer`, `Sandbox-y`, `Data`, `Experimental`.

  Describe the GAME, not the technology. `3d`, `browser` and `singleplayer` are
  true of almost everything published here and are ignored. Common synonyms fold
  in (`scifi` and `science fiction` both become `Sci-fi`), but a word the
  vocabulary does not know is **not stored** - it comes back in the response, and
  resending it will not make it work. Pick the nearest listed word instead.

  **You are the only one who can supply these two.** Nothing downstream can look
  at a zip of compiled JavaScript and work out that it is a cozy platformer. A
  game published without them sits on no shelf in the gallery and can be found
  only by scrolling past everything else.

The project is attached for you - the MCP server knows which one the assets came
out of, so there is nothing to look up and nothing to pass.

It zips the directory, uploads it, waits for the deploy and returns the live URL.
Give the user the URL as the first line of your reply - it is the thing they asked
for. A random address like `zesty-panda-14743.thrixel.world` is normal and is
theirs permanently.

## After the first publish

- **Updates:** republish with the same `game_id` - the link never changes, and the old
  version keeps serving until the new one is fully deployed, so a failed republish never
  takes a live game down. Offer this when the user makes further changes to a published game.
- **Unpublish** takes the game offline immediately; the address stays theirs and
  republishing revives it.
- **Sharing is by link, and that is already the default.** The game's address is
  public and anyone who has it can play; nothing else is needed for "just for
  friends". A published game is NOT in the gallery unless somebody asked and staff
  agreed, so do not call anything to keep it private - there is nothing to turn off.
- **Discovery is opt-in and reviewed.** `thrixel.com/world` is a public gallery Thrixel
  curates. `thrixel_update_game(game_id=..., listed=true)` asks to be in it; staff answer,
  so it goes `pending` rather than straight in. **This is the ONLY thing here that waits
  on a human, and it never touches the link** - the game is playable at its own address
  before the request, during it, and after a refusal.

  **Offer it once, when the game is finished** - not while they are still iterating. A
  natural finish line looks like: they stop asking for changes, they say it is done, or
  they ask about sharing it more widely. One sentence, and if they decline do not raise
  it again this session:

  > Want me to submit it to the Thrixel gallery? It stays playable at the same link
  > either way - this just asks to have it featured where people browse.

  Do not describe the wait as blocking anything, because it does not.

# Managing published games

The user does not have to be building anything to ask about what they have already
published. Answer these directly, without touching the rest of this file.

**If these tools are not in your tool list**, publishing has not reached your Thrixel
MCP server version yet. Say so in one line, tell them upgrading the server brings it,
and stop. Do not call the REST API by hand and do not guess at what they have
published - the user's own record of their links is better than a guess.

| they ask | do this |
|---|---|
| "what have I published?" / "list my games" | `thrixel_list_games()` - returns title, status, URL and `game_id` for each |
| "what's the link for X?" | `thrixel_list_games()`, then give them the URL for X. Do not make them scroll a table for one link. |
| "take X offline" / "unpublish X" | Get the `game_id` from `thrixel_list_games()`, then `thrixel_unpublish_game(game_id=...)`. Tell them the address stays theirs and republishing revives it. |
| "take X out of the gallery" | Only if it is actually in it. `thrixel_update_game(game_id=..., listed=false)` ASKS to be taken off; staff answer, and it stays listed until they do. On a game that was never listed this is a 409, so check `thrixel_list_games()` first. The link is unaffected either way. |
| "get X featured" / "put X in the gallery" | `thrixel_update_game(game_id=..., listed=true)`. Tell them staff review it, and that the link keeps working regardless. Do not promise a timescale. |
| "rename X" | `thrixel_update_game(game_id=..., title="...")` |
| "update X with my changes" | `thrixel_publish_game(files=..., assets=..., game_id=...)` with the whole updated game. Same URL, and the live version keeps serving until the new one is ready. Pass `controls` and `description` again only if they changed. |

Two rules for this whole set:

- **Look up the `game_id`; never ask the user for it.** They know their game by its
  name, and `thrixel_list_games` maps names to ids in one free call. Asking for an
  id is asking them to do your lookup.
- **Confirm before unpublishing.** It takes the game offline for everyone
  immediately, and a link the user has already sent to people stops working. Name
  the game and its URL and get a yes first. Renaming, relisting and republishing
  need no confirmation - they are all reversible and none of them break a link.
