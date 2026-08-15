# Skyrail Salvage

Prompt used with the skill:

> Build a Roblox three-lane arcade runner called Skyrail Salvage. The player pilots a clockwork
> glider through a storm rail, changes lanes to collect charge cogs, dodges barriers, and reaches
> the rescue beacon with enough charge. Generate the glider with Architect, keep `Propeller`
> independently movable, and optimize it for mobile.

The prepared `thrixel_assets/ready/clockwork-glider.glb`, manifest, and passing preflight reports
are included. Import the GLB in Studio with **Import as a Model** enabled and **Merge Meshes**
disabled. Put the Model at
`Workspace/ThrixelAssets/ClockworkGlider` and set:

- `ThrixelExpectedMovingGroups = "Propeller"`
- `ThrixelTargetLongestAxis = 18`

The round lasts about 65 seconds. A/D, arrow keys, touch buttons, and gamepad shoulder controls
change lanes. The server owns lane/score/damage state; the client owns presentation. The glider
propeller spins independently, 20 cogs and 12 barriers make a deterministic course, 12 collected
cogs are required at the finish, and every round ends in a win/lose/reset state.
