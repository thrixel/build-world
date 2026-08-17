local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage:WaitForChild("GameConfig"))

Lighting.Brightness = 2.35
Lighting.ExposureCompensation = 0.05
Lighting.Ambient = Color3.fromRGB(76, 86, 118)
Lighting.OutdoorAmbient = Color3.fromRGB(55, 65, 92)
Lighting.EnvironmentDiffuseScale = 0.55
Lighting.EnvironmentSpecularScale = 0.6
Lighting.GlobalShadows = true

local world = Instance.new("Folder")
world.Name = "OrreryLockWorld"
world.Parent = workspace
workspace:SetAttribute("BuildReady", false)

local state = Instance.new("Folder")
state.Name = "GameState"
state:SetAttribute("CellsCollected", 0)
state:SetAttribute("RequiredCells", Config.RequiredCells)
state:SetAttribute("Objective", "Find three star cells")
state:SetAttribute("Completed", false)
state.Parent = ReplicatedStorage

local function part(name: string, size: Vector3, cframe: CFrame, color: Color3, material: Enum.Material?): Part
	local value = Instance.new("Part")
	value.Name = name
	value.Size = size
	value.CFrame = cframe
	value.Color = color
	value.Material = material or Enum.Material.SmoothPlastic
	value.Anchored = true
	value.TopSurface = Enum.SurfaceType.Smooth
	value.BottomSurface = Enum.SurfaceType.Smooth
	value.Parent = world
	return value
end

local navy = Color3.fromRGB(34, 47, 76)
local brass = Color3.fromRGB(184, 132, 54)
local cyan = Color3.fromRGB(80, 237, 255)

local floor = part("ObservatoryFloor", Vector3.new(80, 2, 80), CFrame.new(0, -1, 0), navy, Enum.Material.Slate)
local roof = part("ObservatoryRoof", Vector3.new(82, 2, 148), CFrame.new(0, 15, -31), Color3.fromRGB(18, 26, 49), Enum.Material.Metal)
roof.CanCollide = true
local vaultFloor = part("VaultFloor", Vector3.new(18, 2, 22), CFrame.new(0, -1, -49), navy, Enum.Material.Slate)
local vaultRoof = part("VaultRoof", Vector3.new(20, 2, 28), CFrame.new(0, 15, -48), Color3.fromRGB(18, 26, 49), Enum.Material.Metal)
local upperPath = part("UpperExitPath", Vector3.new(14, 2, 26), CFrame.new(0, 5, -89), navy, Enum.Material.Slate)
local exitRoof = part("ExitRoof", Vector3.new(18, 2, 32), CFrame.new(0, 15, -88), Color3.fromRGB(18, 26, 49), Enum.Material.Metal)
local vaultLightAnchor = part("VaultLight", Vector3.new(0.25, 0.25, 0.25), CFrame.new(0, 10, -43), cyan, Enum.Material.Neon)
vaultLightAnchor.Transparency = 1
vaultLightAnchor.CanCollide = false
local vaultLight = Instance.new("PointLight")
vaultLight.Color = Color3.fromRGB(116, 205, 255)
vaultLight.Brightness = 0.7
vaultLight.Range = 24
vaultLight.Shadows = false
vaultLight.Parent = vaultLightAnchor

for index, position in ipairs({ Vector3.new(-12, 15, 10), Vector3.new(12, 15, 10), Vector3.new(0, 13, -18) }) do
	local lightAnchor = part(`KeyLight_{index}`, Vector3.new(0.25, 0.25, 0.25), CFrame.new(position), navy, Enum.Material.SmoothPlastic)
	lightAnchor.Transparency = 1
	lightAnchor.CanCollide = false
	local keyLight = Instance.new("PointLight")
	keyLight.Color = index == 3 and Color3.fromRGB(128, 177, 255) or Color3.fromRGB(190, 218, 255)
	keyLight.Brightness = 0.85
	keyLight.Range = 45
	keyLight.Shadows = false
	keyLight.Parent = lightAnchor
end
local spawn = Instance.new("SpawnLocation")
spawn.Name = "ObservatorySpawn"
spawn.Size = Vector3.new(8, 1, 8)
spawn.CFrame = CFrame.new(0, 0.5, 32)
spawn.Transparency = 1
spawn.CanCollide = true
spawn.Neutral = true
spawn.Duration = 0
spawn.Parent = world

local recoveryPlane = part("RecoveryPlane", Vector3.new(120, 2, 160), CFrame.new(0, -12, -20), navy)
recoveryPlane.Transparency = 1
recoveryPlane.CanCollide = true

local function placeCharacter(character: Model)
	local root = character:WaitForChild("HumanoidRootPart", 5)
	if not root or not root:IsA("BasePart") then return end
	root.AssemblyLinearVelocity = Vector3.zero
	root.AssemblyAngularVelocity = Vector3.zero
	root.Anchored = not workspace:GetAttribute("BuildReady")
	character:PivotTo(spawn.CFrame * CFrame.new(0, 3.25, 0))
	if not character:GetAttribute("SpawnGuardInstalled") then
		character:SetAttribute("SpawnGuardInstalled", true)
		task.spawn(function()
			while character.Parent and root.Parent do
				if root.Position.Y < -6 then
					root.AssemblyLinearVelocity = Vector3.zero
					root.AssemblyAngularVelocity = Vector3.zero
					character:PivotTo(spawn.CFrame * CFrame.new(0, 3.25, 0))
				end
				task.wait(0.15)
			end
		end)
	end
end

local function setupPlayer(player: Player)
	player.RespawnLocation = spawn
	player.CharacterAdded:Connect(placeCharacter)
	if player.Character then
		task.defer(placeCharacter, player.Character)
	end
end

Players.PlayerAdded:Connect(setupPlayer)
for _, player in Players:GetPlayers() do
	setupPlayer(player)
end

recoveryPlane.Touched:Connect(function(hit)
	local character = hit:FindFirstAncestorOfClass("Model")
	if character and Players:GetPlayerFromCharacter(character) then
		placeCharacter(character)
	end
end)

for _, boundary in {
	{ Vector3.new(2, 16, 80), CFrame.new(-40, 7, 0) },
	{ Vector3.new(2, 16, 80), CFrame.new(40, 7, 0) },
	{ Vector3.new(80, 16, 2), CFrame.new(0, 7, 40) },
	{ Vector3.new(32, 16, 2), CFrame.new(-24, 7, -40) },
	{ Vector3.new(32, 16, 2), CFrame.new(24, 7, -40) },
} do
	part("PerimeterWall", boundary[1] :: Vector3, boundary[2] :: CFrame, navy, Enum.Material.Brick)
end

local function mazeWall(name: string, size: Vector3, position: Vector3)
	local wall = part(name, size, CFrame.new(position), Color3.fromRGB(40, 55, 86), Enum.Material.Brick)
	wall:SetAttribute("MazeWall", true)
	return wall
end

for index, wall in ipairs({
	-- Four connected cross-walls. The gaps are intentional maze doors.
	{ Vector3.new(10, 16, 2), Vector3.new(-35, 7, 24) },
	{ Vector3.new(32, 16, 2), Vector3.new(-6, 7, 24) },
	{ Vector3.new(22, 16, 2), Vector3.new(29, 7, 24) },
	{ Vector3.new(22, 16, 2), Vector3.new(-29, 7, 8) },
	{ Vector3.new(32, 16, 2), Vector3.new(6, 7, 8) },
	{ Vector3.new(10, 16, 2), Vector3.new(35, 7, 8) },
	{ Vector3.new(10, 16, 2), Vector3.new(-35, 7, -8) },
	{ Vector3.new(32, 16, 2), Vector3.new(-6, 7, -8) },
	{ Vector3.new(22, 16, 2), Vector3.new(29, 7, -8) },
	{ Vector3.new(22, 16, 2), Vector3.new(-29, 7, -24) },
	{ Vector3.new(32, 16, 2), Vector3.new(6, 7, -24) },
	{ Vector3.new(10, 16, 2), Vector3.new(35, 7, -24) },
	-- Alternating connectors turn the rows into a navigable maze.
	{ Vector3.new(2, 16, 16), Vector3.new(-30, 7, 16) },
	{ Vector3.new(2, 16, 16), Vector3.new(10, 7, 16) },
	{ Vector3.new(2, 16, 16), Vector3.new(-10, 7, 0) },
	{ Vector3.new(2, 16, 16), Vector3.new(30, 7, 0) },
	{ Vector3.new(2, 16, 16), Vector3.new(-30, 7, -16) },
	{ Vector3.new(2, 16, 16), Vector3.new(10, 7, -16) },
}) do
	mazeWall(`MazeWall_{index}`, wall[1] :: Vector3, wall[2] :: Vector3)
end

for stepIndex = 1, 8 do
	local height = stepIndex * 0.75
	part(`VaultStair_{stepIndex}`, Vector3.new(12, 0.75, 2.5), CFrame.new(0, height - 0.375, -57 - stepIndex * 2.25), navy, Enum.Material.Slate)
end

for _, railX in { -7, 7 } do
	part("ExitRail", Vector3.new(1, 8, 30), CFrame.new(railX, 9, -87), brass, Enum.Material.Metal)
end

-- These walls join the two halves of the north perimeter and enclose the
-- vault, stairway, landing, and exit as one continuous roofed corridor.
part("VaultCorridorWall", Vector3.new(2, 16, 64), CFrame.new(-9, 7, -70), navy, Enum.Material.Brick)
part("VaultCorridorWall", Vector3.new(2, 16, 64), CFrame.new(9, 7, -70), navy, Enum.Material.Brick)

local exitPortal = part("ExitPortal", Vector3.new(11, 10, 1), CFrame.new(0, 10, -101), cyan, Enum.Material.Neon)
exitPortal.Transparency = 1
exitPortal.CanCollide = false

local function firstPart(instance: Instance): BasePart?
	if instance:IsA("BasePart") then
		return instance
	end
	return instance:FindFirstChildWhichIsA("BasePart", true)
end

local function fitAndPlace(model: Model, targetHeight: number, target: CFrame, ground: boolean?)
	local _, initialSize = model:GetBoundingBox()
	assert(initialSize.Y > 0, `{model.Name} has zero height`)
	model:ScaleTo(model:GetScale() * targetHeight / initialSize.Y)
	model:PivotTo(target)
	if ground then
		local boxCFrame, boxSize = model:GetBoundingBox()
		model:PivotTo(model:GetPivot() + Vector3.new(0, boxSize.Y * 0.5 - boxCFrame.Position.Y, 0))
	end
end

local function prepareAsset(model: Model, collidableName: string?)
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Anchored = true
			descendant.CanCollide = collidableName ~= nil and descendant.Name == collidableName
		end
	end
end

local function styleGroup(root: Instance, groupName: string, color: Color3, material: Enum.Material)
	local group = root:FindFirstChild(groupName, true)
	if not group then
		return
	end
	if group:IsA("BasePart") then
		group.Color = color
		group.Material = material
	end
	for _, descendant in group:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Color = color
			descendant.Material = material
		end
	end
end

local assets = ReplicatedStorage:FindFirstChild("Assets")
local function cloneAsset(templateName: string, cloneName: string, targetHeight: number, target: CFrame, ground: boolean?, collidableName: string?): Model?
	local source = assets and assets:FindFirstChild(templateName)
	if not source or not source:IsA("Model") then
		return nil
	end
	local clone = source:Clone()
	clone.Name = cloneName
	clone.Parent = world
	prepareAsset(clone, collidableName)
	fitAndPlace(clone, targetHeight, target, ground)
	return clone
end

-- Each floor exhibit occupies the dead-end side of a different maze chamber.
-- The gaps that connect those chambers remain clear on the opposite side.
local telescope = cloneAsset("ThrixelTelescope", "ObservatoryTelescope", 5.5, CFrame.new(3, 0, 16), true)
if telescope then
	styleGroup(telescope, "TelescopeBody", navy, Enum.Material.Metal)
	styleGroup(telescope, "telescope_body", brass, Enum.Material.Metal)
	styleGroup(telescope, "tripod", brass, Enum.Material.Metal)
	styleGroup(telescope, "finder_scope", Color3.fromRGB(46, 143, 158), Enum.Material.Glass)
	styleGroup(telescope, "adjustment_wheel", brass, Enum.Material.Metal)
end

local lectern = cloneAsset("ThrixelLectern", "CelestialLectern", 5, CFrame.new(34, 0, 16) * CFrame.Angles(0, math.pi * 0.5, 0), true)
if lectern then
	styleGroup(lectern, "lectern_body_Group", navy, Enum.Material.Wood)
	styleGroup(lectern, "open_chart_Group", Color3.fromRGB(213, 194, 153), Enum.Material.Fabric)
	styleGroup(lectern, "rolled_charts_Group", Color3.fromRGB(187, 164, 121), Enum.Material.Fabric)
	styleGroup(lectern, "page_clamps_Group", brass, Enum.Material.Metal)
	styleGroup(lectern, "compass_inset_Group", Color3.fromRGB(45, 151, 165), Enum.Material.Glass)
end

local astrolabe = cloneAsset("ThrixelAstrolabe", "AstrolabePillar", 5.5, CFrame.new(-34, 0, 0), true)
if astrolabe then
	styleGroup(astrolabe, "pillar_body", navy, Enum.Material.Metal)
	styleGroup(astrolabe, "astrolabe_rings", brass, Enum.Material.Metal)
	styleGroup(astrolabe, "celestial_markers", Color3.fromRGB(208, 172, 93), Enum.Material.Metal)
	styleGroup(astrolabe, "central_gem", Color3.fromRGB(57, 174, 188), Enum.Material.Glass)
end

local workbench = cloneAsset("ThrixelWorkbench", "EquipmentWorkbench", 4, CFrame.new(-2, 0, 0) * CFrame.Angles(0, math.pi * 0.5, 0), true)
if workbench then
	styleGroup(workbench, "cabinet_body_Group", Color3.fromRGB(45, 35, 56), Enum.Material.Wood)
	styleGroup(workbench, "cabinet_doors_Group", navy, Enum.Material.Wood)
	styleGroup(workbench, "drawers_Group", Color3.fromRGB(78, 55, 61), Enum.Material.Wood)
	styleGroup(workbench, "chart_compartment_Group", Color3.fromRGB(197, 177, 137), Enum.Material.Fabric)
	styleGroup(workbench, "indicator_dial_Group", brass, Enum.Material.Metal)
end

local vaultAlcoveBench = cloneAsset(
	"ThrixelWorkbench",
	"VaultAlcoveBench",
	4,
	CFrame.new(31, 0, -32) * CFrame.Angles(0, math.pi * 0.5, 0),
	true
)
if vaultAlcoveBench then
	styleGroup(vaultAlcoveBench, "cabinet_body_Group", Color3.fromRGB(45, 35, 56), Enum.Material.Wood)
	styleGroup(vaultAlcoveBench, "cabinet_doors_Group", navy, Enum.Material.Wood)
	styleGroup(vaultAlcoveBench, "drawers_Group", Color3.fromRGB(78, 55, 61), Enum.Material.Wood)
	styleGroup(vaultAlcoveBench, "chart_compartment_Group", Color3.fromRGB(197, 177, 137), Enum.Material.Fabric)
	styleGroup(vaultAlcoveBench, "indicator_dial_Group", brass, Enum.Material.Metal)
end

local ringPivots: { Instance } = {}
local template = assets and assets:FindFirstChild("ThrixelOrrery")
local orrery: Model
local crank: BasePart

if template and template:IsA("Model") then
	orrery = template:Clone()
	orrery.Name = "ThrixelOrrery"
	orrery:SetAttribute("RequiredMovingGroups", "crank,orbit_ring_inner,orbit_ring_middle,orbit_ring_outer,pointer_arm")
	orrery.Parent = world
	prepareAsset(orrery, "OrreryBody")
	fitAndPlace(orrery, 14, CFrame.new(0, 0, 0), true)
	styleGroup(orrery, "OrreryBody", navy, Enum.Material.Metal)
	styleGroup(orrery, "orbit_ring_inner", brass, Enum.Material.Metal)
	styleGroup(orrery, "orbit_ring_middle", Color3.fromRGB(44, 156, 166), Enum.Material.Metal)
	styleGroup(orrery, "orbit_ring_outer", brass, Enum.Material.Metal)
	styleGroup(orrery, "pointer_arm", brass, Enum.Material.Metal)
	styleGroup(orrery, "crank", Color3.fromRGB(214, 158, 71), Enum.Material.Metal)
	for _, name in { "orbit_ring_inner", "orbit_ring_middle", "orbit_ring_outer" } do
		local moving = orrery:FindFirstChild(name, true)
		assert(moving, `Missing grouped Orrery part {name}`)
		if moving:IsA("Model") then
			local pivot = moving:GetBoundingBox()
			moving.WorldPivot = pivot
		end
		table.insert(ringPivots, moving)
	end
	local crankGroup = orrery:FindFirstChild("crank", true)
	assert(crankGroup, "Missing grouped Orrery crank")
	crank = assert(firstPart(crankGroup), "Grouped Orrery crank has no BasePart")
else
	orrery = Instance.new("Model")
	orrery.Name = "HeroOrrery_PLACEHOLDER"
	orrery:SetAttribute("ReplaceWithThrixelAsset", true)
	orrery.Parent = world

	local base = part("base", Vector3.new(10, 2, 10), CFrame.new(0, 1, 0), brass, Enum.Material.Metal)
	base.Parent = orrery

	for index, scale in ipairs({ 10, 14, 18 }) do
		local pivot = Instance.new("Model")
		pivot.Name = `ring_{index}_pivot`
		pivot.Parent = orrery
		local ring = part(`ring_{index}`, Vector3.new(scale, 0.7, 0.7), CFrame.new(0, 4 + index * 2, 0), cyan, Enum.Material.Neon)
		ring.Parent = pivot
		pivot.PrimaryPart = ring
		table.insert(ringPivots, pivot)
	end

	crank = part("crank", Vector3.new(1, 5, 1), CFrame.new(6, 3, 0), brass, Enum.Material.Metal)
	crank.Parent = orrery
end

local crankPrompt = Instance.new("ProximityPrompt")
crankPrompt.ActionText = "Align Orrery"
crankPrompt.ObjectText = "Power required"
crankPrompt.MaxActivationDistance = Config.InteractDistance
crankPrompt.RequiresLineOfSight = false
crankPrompt.Enabled = false
crankPrompt.Parent = crank

local vaultModel = cloneAsset("ThrixelVaultDoor", "VaultDoor", 14, CFrame.new(0, 0, -40) * CFrame.Angles(0, math.pi, 0), true, "vault_frame")
local vaultDoor: Instance
if vaultModel then
	styleGroup(vaultModel, "vault_frame", brass, Enum.Material.Metal)
	styleGroup(vaultModel, "sliding_rails", brass, Enum.Material.Metal)
	styleGroup(vaultModel, "door_panel", navy, Enum.Material.Metal)
	styleGroup(vaultModel, "lock_wheel", brass, Enum.Material.Metal)
	styleGroup(vaultModel, "teal_insets", Color3.fromRGB(58, 183, 193), Enum.Material.Glass)
	assert(vaultModel:FindFirstChild("door_panel", true), "Grouped vault is missing door_panel")
	vaultDoor = vaultModel
	for _, descendant in vaultModel:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.CanCollide = true
		end
	end
	if vaultDoor:IsA("BasePart") then
		vaultDoor.CanCollide = true
	end
else
	vaultDoor = part("VaultDoor_PLACEHOLDER", Vector3.new(14, 14, 2), CFrame.new(0, 7, -40), brass, Enum.Material.Metal)
end

local vaultDoorStart = vaultDoor:IsA("Model") and vaultDoor:GetPivot() or (vaultDoor :: BasePart).CFrame
local vaultBarrier = part("VaultDoorCollision", Vector3.new(16, 14, 2), CFrame.new(0, 7, -39.25), navy)
vaultBarrier.Transparency = 1
vaultBarrier.CanCollide = true

local prismModel = cloneAsset("ThrixelStarPrism", "StarPrism", 7, CFrame.new(0, 0, -50), true)
local prismPlaceholder: BasePart?
if prismModel then
	for _, descendant in prismModel:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Color = cyan
			descendant.Material = Enum.Material.Glass
		end
	end
end
if not prismModel then
	prismPlaceholder = part("StarPrism_PLACEHOLDER", Vector3.new(3, 7, 3), CFrame.new(0, 4, -50), cyan, Enum.Material.Neon)
	prismPlaceholder.Transparency = 0.15
end

-- Keep interaction independent from the imported mesh hierarchy so the prize
-- remains easy to collect even if the asset's first mesh is offset or tiny.
local prismInteraction = part("StarPrismInteraction", Vector3.new(6, 9, 6), CFrame.new(0, 4.5, -50), cyan)
prismInteraction.Transparency = 1
prismInteraction.CanCollide = false
local prismPrompt = Instance.new("ProximityPrompt")
prismPrompt.ActionText = "Claim"
prismPrompt.ObjectText = "Star prism"
prismPrompt.MaxActivationDistance = math.max(Config.InteractDistance, 12)
prismPrompt.RequiresLineOfSight = false
prismPrompt.HoldDuration = 0
prismPrompt.Enabled = false
prismPrompt.Parent = prismInteraction

local prismClaimed = false
local function setVisible(root: Instance, visible: boolean)
	if root:IsA("BasePart") then
		root.Transparency = visible and 0 or 1
	end
	for _, descendant in root:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Transparency = visible and 0 or 1
		end
	end
end

prismPrompt.Triggered:Connect(function()
	if prismClaimed then return end
	prismClaimed = true
	prismPrompt.Enabled = false
	state:SetAttribute("Objective", "Star prism secured — climb the stairs to the exit")
	if prismModel and prismModel.Parent then
		setVisible(prismModel, false)
	elseif prismPlaceholder and prismPlaceholder.Parent then
		setVisible(prismPlaceholder, false)
	end
	exitPortal.Transparency = 0.25
end)

for index, placement in ipairs({
	{ Vector3.new(-22, 8, 38), 0 },
	{ Vector3.new(22, 8, 38), 0 },
	{ Vector3.new(-22, 8, -38), math.pi },
	{ Vector3.new(22, 8, -38), math.pi },
	{ Vector3.new(-38, 8, 16), math.pi * 0.5 },
	{ Vector3.new(38, 8, 16), -math.pi * 0.5 },
	{ Vector3.new(-38, 8, -16), math.pi * 0.5 },
	{ Vector3.new(38, 8, -16), -math.pi * 0.5 },
	{ Vector3.new(-8, 8, -52), math.pi * 0.5 },
	{ Vector3.new(8, 8, -72), -math.pi * 0.5 },
}) do
	local position = placement[1] :: Vector3
	local yaw = placement[2] :: number
	local lampModel = cloneAsset(
		"ThrixelLamp",
		`ObservatoryLamp_{index}`,
		4,
		CFrame.new(position) * CFrame.Angles(0, yaw, 0),
		false
	)
	local lamp = lampModel and firstPart(lampModel) or part(`ObservatoryLamp_{index}_PLACEHOLDER`, Vector3.new(1.2, 1.2, 1.2), CFrame.new(position), brass, Enum.Material.Metal)
	if lampModel then
		styleGroup(lampModel, "LampBody", brass, Enum.Material.Metal)
		styleGroup(lampModel, "glass_orb", Color3.fromRGB(105, 205, 255), Enum.Material.Glass)
	end
	assert(lamp, "Lamp asset has no BasePart")
	lamp.CanCollide = false
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(116, 191, 255)
	light.Brightness = 0.6
	light.Range = 26
	light.Shadows = true
	light.Parent = lamp
end

local cells = {
	CFrame.new(-35, 2.5, 31),
	CFrame.new(25, 2.5, 0),
	CFrame.new(-16, 2.5, -32),
}

local cellFolder: Folder?
local function spawnCells()
	if cellFolder then
		cellFolder:Destroy()
	end
	cellFolder = Instance.new("Folder")
	cellFolder.Name = "StarCellPickups"
	cellFolder.Parent = world

	for index, cframe in ipairs(cells) do
		local cellModel = cloneAsset("ThrixelStarCell", `StarCell_{index}`, 4, cframe, false)
		if cellModel then
			cellModel.Parent = cellFolder
			styleGroup(cellModel, "crystal_core", Color3.fromRGB(72, 189, 205), Enum.Material.Glass)
			styleGroup(cellModel, "brass_cage", brass, Enum.Material.Metal)
			styleGroup(cellModel, "left_endcap", brass, Enum.Material.Metal)
			styleGroup(cellModel, "right_endcap", brass, Enum.Material.Metal)
			styleGroup(cellModel, "carry_handle", brass, Enum.Material.Metal)
		end
		local cell = cellModel and firstPart(cellModel) or part(`StarCell_{index}_PLACEHOLDER`, Vector3.new(2, 4, 2), cframe, cyan, Enum.Material.Neon)
		assert(cell, "Star Cell asset has no BasePart")
		if not cellModel then
			cell.Parent = cellFolder
		end
		cell.CanCollide = false
		local light = Instance.new("PointLight")
		light.Color = cyan
		light.Range = 6
		light.Brightness = 0.16
		light.Parent = cell

		-- The prompt lives on a generous invisible volume, not on whichever
		-- imported MeshPart happens to be first in the GLB hierarchy.
		local interaction = part(`StarCellInteraction_{index}`, Vector3.new(7, 7, 7), cframe, cyan)
		interaction.Transparency = 1
		interaction.CanCollide = false
		interaction.Parent = cellFolder
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Collect"
		prompt.ObjectText = "Star cell"
		prompt.MaxActivationDistance = math.max(Config.InteractDistance, 12)
		prompt.RequiresLineOfSight = false
		prompt.HoldDuration = 0
		prompt.Parent = interaction
		local claimed = false
		prompt.Triggered:Connect(function()
			if claimed then return end
			claimed = true
			local count = (state:GetAttribute("CellsCollected") :: number) + 1
			state:SetAttribute("CellsCollected", count)
			if cellModel then
				cellModel:Destroy()
			else
				cell:Destroy()
			end
			interaction:Destroy()
			if count >= Config.RequiredCells then
				state:SetAttribute("Objective", "Find the center and align the orrery")
				crankPrompt.ObjectText = "Orrery charged"
				crankPrompt.Enabled = true
			end
		end)
	end
end

spawnCells()

local completed = false
local function getPivot(instance: Instance): CFrame
	if instance:IsA("Model") then
		return instance:GetPivot()
	end
	return (instance :: BasePart).CFrame
end

local function setPivot(instance: Instance, value: CFrame)
	if instance:IsA("Model") then
		instance:PivotTo(value)
	else
		(instance :: BasePart).CFrame = value
	end
end


local function animatePivot(instance: Instance, rotation: CFrame, duration: number)
	local start = getPivot(instance)
	local elapsed = 0
	while elapsed < duration do
		elapsed += RunService.Heartbeat:Wait()
		local alpha = TweenService:GetValue(math.min(elapsed / duration, 1), Enum.EasingStyle.Quint, Enum.EasingDirection.Out)
		setPivot(instance, start:Lerp(start * rotation, alpha))
	end
end

local ringStarts: { CFrame } = {}
for index, pivot in ipairs(ringPivots) do
	ringStarts[index] = getPivot(pivot)
end

local resetting = false
local function resetRound()
	if resetting then return end
	resetting = true
	completed = false
	prismClaimed = false
	state:SetAttribute("CellsCollected", 0)
	state:SetAttribute("Objective", "Find three star cells")
	state:SetAttribute("Completed", false)
	crankPrompt.ObjectText = "Power required"
	crankPrompt.Enabled = false
	prismPrompt.Enabled = false
	exitPortal.Transparency = 1
	vaultBarrier.CanCollide = true
	setPivot(vaultDoor, vaultDoorStart)
	for index, pivot in ipairs(ringPivots) do
		setPivot(pivot, ringStarts[index])
	end
	if prismModel and prismModel.Parent then
		setVisible(prismModel, true)
	elseif prismPlaceholder and prismPlaceholder.Parent then
		setVisible(prismPlaceholder, true)
	end
	spawnCells()
	resetting = false
end

crankPrompt.Triggered:Connect(function()
	if completed then return end
	completed = true
	crankPrompt.Enabled = false
	state:SetAttribute("Objective", "The vault is opening")
	for index, pivot in ipairs(ringPivots) do
		task.spawn(animatePivot, pivot, CFrame.Angles(math.rad(90 * index), math.rad(180), math.rad(45 * index)), Config.RingTweenSeconds)
	end
	task.wait(Config.RingTweenSeconds * 0.75)
	animatePivot(vaultDoor, CFrame.new(0, 16, 0), Config.VaultTweenSeconds)
	vaultBarrier.CanCollide = false
	state:SetAttribute("Objective", "Enter the vault and claim the star prism")
	prismPrompt.Enabled = true
end)

exitPortal.Touched:Connect(function(hit)
	if not prismClaimed or resetting then return end
	local character = hit:FindFirstAncestorOfClass("Model")
	local player = character and Players:GetPlayerFromCharacter(character)
	if not player or not character then return end
	state:SetAttribute("Completed", true)
	state:SetAttribute("Objective", "Escape complete — returning to the observatory")
	exitPortal.Transparency = 0.05
	task.wait(1.25)
	resetRound()
	placeCharacter(character)
end)

local atmosphere = Instance.new("Atmosphere")
atmosphere.Density = 0.32
atmosphere.Color = Color3.fromRGB(86, 108, 151)
atmosphere.Decay = Color3.fromRGB(18, 24, 46)
atmosphere.Parent = Lighting

task.wait(8)
workspace:SetAttribute("BuildReady", true)
for _, player in Players:GetPlayers() do
	if player.Character then
		placeCharacter(player.Character)
	end
end
local requiredAssets = {
	"ThrixelOrrery",
	"ThrixelVaultDoor",
	"ThrixelStarCell",
	"ThrixelLamp",
	"ThrixelStarPrism",
	"ThrixelTelescope",
	"ThrixelLectern",
	"ThrixelAstrolabe",
	"ThrixelWorkbench",
}
local missingAssets = {}
for _, name in requiredAssets do
	if not assets or not assets:FindFirstChild(name) then
		table.insert(missingAssets, name)
	end
end
workspace:SetAttribute("MissingThrixelAssets", table.concat(missingAssets, ","))
local mazeWallCount = 0
for _, descendant in world:GetDescendants() do
	if descendant:GetAttribute("MazeWall") then
		mazeWallCount += 1
	end
end
workspace:SetAttribute("MazeWallCount", mazeWallCount)
workspace:SetAttribute("SelfTestPassed", #missingAssets == 0 and #cells == Config.RequiredCells and mazeWallCount >= 12 and orrery:FindFirstChild("crank", true) ~= nil)
workspace:SetAttribute("PrototypeMeshParts", template and 6 or 0)
local runtimeMeshParts = 0
for _, descendant in world:GetDescendants() do
	if descendant:IsA("MeshPart") then
		runtimeMeshParts += 1
	end
end
workspace:SetAttribute("RuntimeMeshParts", runtimeMeshParts)
