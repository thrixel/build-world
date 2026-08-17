local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("GameConfig"))
local random = Random.new()

Lighting.Brightness = 2.8
Lighting.ExposureCompensation = 0.22
Lighting.Ambient = Color3.fromRGB(105, 82, 126)
Lighting.OutdoorAmbient = Color3.fromRGB(92, 72, 112)
Lighting.EnvironmentDiffuseScale = 0.7
Lighting.EnvironmentSpecularScale = 0.55
Lighting.GlobalShadows = true

local world = Instance.new("Folder")
world.Name = "MoonmarketWorld"
world.Parent = workspace
workspace:SetAttribute("BuildReady", false)

local state = Instance.new("Folder")
state.Name = "GameState"
state:SetAttribute("SecondsLeft", Config.RoundSeconds)
state:SetAttribute("Order", "")
state:SetAttribute("Status", "Market open")
state:SetAttribute("Round", 0)
state:SetAttribute("TargetBrews", Config.BrewsToWin)
state:SetAttribute("Winner", "")
state.Parent = ReplicatedStorage

local inventories: { [Player]: { [string]: number } } = {}
local roundBrews: { [Player]: number } = {}
local playerOrders: { [Player]: { string } } = {}
local roundWinner: Player? = nil
local roundActive = false

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

local plum = Color3.fromRGB(89, 45, 109)
local amber = Color3.fromRGB(255, 174, 65)
local jade = Color3.fromRGB(80, 220, 157)

part("MarketFloor", Vector3.new(92, 2, 72), CFrame.new(0, -1, 0), Color3.fromRGB(62, 39, 85), Enum.Material.Cobblestone)
local spawn = Instance.new("SpawnLocation")
spawn.Name = "MarketSpawn"
spawn.Size = Vector3.new(8, 1, 8)
spawn.CFrame = CFrame.new(0, 0.5, 25) * CFrame.Angles(0, math.pi, 0)
spawn.Transparency = 1
spawn.CanCollide = true
spawn.Neutral = true
spawn.Duration = 0
spawn.Parent = world

local staticPickupObstacles: { Instance } = { spawn }

for _, boundary in {
	{ "WestBoundary", Vector3.new(2, 14, 72), CFrame.new(-46, 6, 0) },
	{ "EastBoundary", Vector3.new(2, 14, 72), CFrame.new(46, 6, 0) },
	{ "NorthBoundary", Vector3.new(92, 14, 2), CFrame.new(0, 6, -36) },
	{ "SouthBoundary", Vector3.new(92, 14, 2), CFrame.new(0, 6, 36) },
} do
	local wall = part(boundary[1] :: string, boundary[2] :: Vector3, boundary[3] :: CFrame, plum)
	wall.Transparency = 1
end

local recoveryPlane = part("RecoveryPlane", Vector3.new(140, 2, 120), CFrame.new(0, -12, 0), plum)
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

local function protectPlayer(player: Player)
	player.RespawnLocation = spawn
	player.CharacterAdded:Connect(placeCharacter)
	if player.Character then
		task.defer(placeCharacter, player.Character)
	end
end

Players.PlayerAdded:Connect(protectPlayer)
for _, player in Players:GetPlayers() do
	protectPlayer(player)
end

recoveryPlane.Touched:Connect(function(hit)
	local character = hit:FindFirstAncestorOfClass("Model")
	if character and Players:GetPlayerFromCharacter(character) then
		placeCharacter(character)
	end
end)

local function firstPart(instance: Instance): BasePart?
	if instance:IsA("BasePart") then
		return instance
	end
	return instance:FindFirstChildWhichIsA("BasePart", true)
end

local assets = ReplicatedStorage:FindFirstChild("Assets")
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
	local wanted = string.lower(groupName)
	for _, candidate in root:GetDescendants() do
		if string.lower(candidate.Name) == wanted then
			if candidate:IsA("BasePart") then
				candidate.Color = color
				candidate.Material = material
			end
			for _, descendant in candidate:GetDescendants() do
				if descendant:IsA("BasePart") then
					descendant.Color = color
					descendant.Material = material
				end
			end
		end
	end
end

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

for row = -1, 1, 2 do
	for column = -2, 2 do
		local stallPosition = Vector3.new(column * 17, 0, row * 25)
		local stallModel = cloneAsset(
			"ThrixelStall",
			`MarketStall_{row}_{column}`,
			10,
			CFrame.lookAt(stallPosition, Vector3.new(stallPosition.X, 0, 0)),
			true,
			"StallBody"
		)
		if not stallModel then
			local stall = part("MarketStall_PLACEHOLDER", Vector3.new(12, 8, 8), CFrame.new(stallPosition + Vector3.new(0, 4, 0)), plum, Enum.Material.WoodPlanks)
			stall:SetAttribute("ReplaceWithThrixelAsset", true)
			part("Awning_PLACEHOLDER", Vector3.new(13, 1, 9), stall.CFrame * CFrame.new(0, 5, 0), amber, Enum.Material.Fabric)
			table.insert(staticPickupObstacles, stall)
		end
		if stallModel then
			table.insert(staticPickupObstacles, stallModel)
			styleGroup(stallModel, "StallBody", Color3.fromRGB(71, 38, 92), Enum.Material.WoodPlanks)
			styleGroup(stallModel, "awning", Color3.fromRGB(177, 65, 139), Enum.Material.Fabric)
			styleGroup(stallModel, "brass_trim", Color3.fromRGB(207, 144, 58), Enum.Material.Metal)
			styleGroup(stallModel, "lantern", Color3.fromRGB(255, 177, 91), Enum.Material.Neon)
		end

		local lanternPosition = stallPosition + Vector3.new(column % 2 == 0 and 4 or -4, 6.5, -row * 4.5)
		local lanternModel = cloneAsset("ThrixelLantern", `MarketLantern_{row}_{column}`, 3.2, CFrame.new(lanternPosition), false)
		local lantern = lanternModel and firstPart(lanternModel) or part("MarketLantern_PLACEHOLDER", Vector3.new(1, 1.8, 1), CFrame.new(lanternPosition), amber, Enum.Material.Metal)
		if lanternModel then
			styleGroup(lanternModel, "LanternFrame", Color3.fromRGB(207, 144, 58), Enum.Material.Metal)
			styleGroup(lanternModel, "hook", Color3.fromRGB(118, 75, 42), Enum.Material.Metal)
			styleGroup(lanternModel, "glass", Color3.fromRGB(255, 190, 104), Enum.Material.Glass)
			styleGroup(lanternModel, "glow", Color3.fromRGB(255, 150, 63), Enum.Material.Neon)
		end
		assert(lantern, "Lantern asset has no BasePart")
		lantern.CanCollide = false
		local light = Instance.new("PointLight")
		light.Color = Color3.fromRGB(255, 177, 91)
		light.Brightness = 1.05
		light.Range = 25
		light.Shadows = false
		light.Parent = lantern
	end
end

for index, position in ipairs({
	Vector3.new(-36, 13, -10),
	Vector3.new(0, 13, -18),
	Vector3.new(36, 13, -10),
	Vector3.new(-28, 13, 22),
	Vector3.new(28, 13, 22),
}) do
	local anchor = part(`MarketFillLight_{index}`, Vector3.new(0.25, 0.25, 0.25), CFrame.new(position), amber)
	anchor.Transparency = 1
	anchor.CanCollide = false
	local fill = Instance.new("PointLight")
	fill.Color = index <= 3 and Color3.fromRGB(255, 190, 122) or Color3.fromRGB(181, 132, 255)
	fill.Brightness = 1.15
	fill.Range = 42
	fill.Shadows = false
	fill.Parent = anchor
end

local template = assets and assets:FindFirstChild("ThrixelCauldron")
local cauldron: BasePart
local cauldronModel: Model?

if template and template:IsA("Model") then
	local model = assert(cloneAsset("ThrixelCauldron", "ThrixelCauldron", 11, CFrame.new(0, 0, 0), true, "CauldronBody"))
	cauldronModel = model
	model:SetAttribute("RequiredMovingGroups", "lid,stirring_paddle,left_handle,right_handle")
	styleGroup(model, "CauldronBody", Color3.fromRGB(48, 57, 78), Enum.Material.Metal)
	styleGroup(model, "lid", Color3.fromRGB(55, 64, 86), Enum.Material.Metal)
	styleGroup(model, "left_handle", Color3.fromRGB(207, 144, 58), Enum.Material.Metal)
	styleGroup(model, "right_handle", Color3.fromRGB(207, 144, 58), Enum.Material.Metal)
	styleGroup(model, "stirring_paddle", Color3.fromRGB(125, 75, 46), Enum.Material.Wood)
	local body = model:FindFirstChild("CauldronBody", true) or model
	cauldron = assert(firstPart(body), "Grouped Cauldron has no body BasePart")
else
	local placeholder = part("Cauldron_PLACEHOLDER", Vector3.new(12, 8, 12), CFrame.new(0, 4, 0), jade, Enum.Material.Metal)
	placeholder.Shape = Enum.PartType.Cylinder
	placeholder:SetAttribute("ReplaceWithThrixelAsset", true)
	cauldron = placeholder
end
table.insert(staticPickupObstacles, cauldronModel or cauldron)

local brewSurface = part("BrewSurface", Vector3.new(0.3, 7.2, 7.2), CFrame.new(0, 6.05, 0) * CFrame.Angles(0, 0, math.rad(90)), jade, Enum.Material.Glass)
brewSurface.Shape = Enum.PartType.Cylinder
brewSurface.Transparency = 0.28
brewSurface.CanCollide = false
local brewLight = Instance.new("PointLight")
brewLight.Color = jade
brewLight.Brightness = 0.45
brewLight.Range = 11
brewLight.Shadows = false
brewLight.Parent = brewSurface

local deliverPrompt = Instance.new("ProximityPrompt")
local brewInteraction = part("BrewInteraction", Vector3.new(5, 6, 5), CFrame.new(0, 3, 8.5), jade)
brewInteraction.Transparency = 1
brewInteraction.CanCollide = false
brewInteraction.CanTouch = false
brewInteraction.CanQuery = false
deliverPrompt.ActionText = "Brew recipe"
deliverPrompt.ObjectText = "Center cauldron"
deliverPrompt.KeyboardKeyCode = Enum.KeyCode.E
deliverPrompt.HoldDuration = 0
deliverPrompt.MaxActivationDistance = 14
deliverPrompt.RequiresLineOfSight = false
deliverPrompt.Exclusivity = Enum.ProximityPromptExclusivity.AlwaysShow
deliverPrompt.Parent = brewInteraction

local ingredientColors = {
	Glowcap = Color3.fromRGB(255, 90, 210),
	Moonfruit = Color3.fromRGB(124, 235, 170),
	StarCrystal = Color3.fromRGB(96, 202, 255),
}

local recipePool: { { string } } = {}
for first = 1, #Config.IngredientNames do
	for second = first, #Config.IngredientNames do
		for third = second, #Config.IngredientNames do
			table.insert(recipePool, {
				Config.IngredientNames[first],
				Config.IngredientNames[second],
				Config.IngredientNames[third],
			})
		end
	end
end

local function recipeSignature(recipe: { string }): string
	return table.concat(recipe, "|")
end

local function assignPlayerOrder(player: Player)
	local unavailable = {}
	for otherPlayer, recipe in playerOrders do
		if otherPlayer ~= player then
			unavailable[recipeSignature(recipe)] = true
		end
	end

	local previousRecipe = playerOrders[player]
	local previousSignature = previousRecipe and recipeSignature(previousRecipe) or nil
	local candidates = {}
	for _, recipe in recipePool do
		local signature = recipeSignature(recipe)
		if not unavailable[signature] and signature ~= previousSignature then
			table.insert(candidates, recipe)
		end
	end
	if #candidates == 0 then
		for _, recipe in recipePool do
			if not unavailable[recipeSignature(recipe)] then
				table.insert(candidates, recipe)
			end
		end
	end
	if #candidates == 0 then
		candidates = recipePool
	end

	local selected = candidates[random:NextInteger(1, #candidates)]
	local personalRecipe = table.clone(selected)
	playerOrders[player] = personalRecipe
	player:SetAttribute("Order", table.concat(personalRecipe, " + "))
end

local function inventoryText(player: Player): string
	local inventory = inventories[player] or {}
	local chunks = {}
	for _, name in Config.IngredientNames do
		table.insert(chunks, `{name}:{inventory[name] or 0}`)
	end
	return table.concat(chunks, "  ")
end

local function refreshPlayer(player: Player)
	player:SetAttribute("Inventory", inventoryText(player))
end

local activePickupPositions: { [Instance]: Vector3 } = {}
local pickupHalfExtent = 3.5

local function obstacleBounds(instance: Instance): (CFrame?, Vector3?)
	if instance:IsA("Model") then
		return instance:GetBoundingBox()
	elseif instance:IsA("BasePart") then
		return instance.CFrame, instance.Size
	end
	return nil, nil
end

local function isPickupPositionClear(position: Vector3): boolean
	-- Keep pickups comfortably inside the invisible boundary walls.
	if math.abs(position.X) > 39 or math.abs(position.Z) > 29 then
		return false
	end

	for _, otherPosition in activePickupPositions do
		if Vector2.new(position.X - otherPosition.X, position.Z - otherPosition.Z).Magnitude < Config.PickupClearance then
			return false
		end
	end

	for _, obstacle in staticPickupObstacles do
		if obstacle.Parent then
			local obstacleCFrame, obstacleSize = obstacleBounds(obstacle)
			if obstacleCFrame and obstacleSize then
				local localPosition = obstacleCFrame:PointToObjectSpace(position)
				if math.abs(localPosition.X) < obstacleSize.X * 0.5 + pickupHalfExtent
					and math.abs(localPosition.Z) < obstacleSize.Z * 0.5 + pickupHalfExtent then
					return false
				end
			end
		end
	end

	return true
end

local function randomPickupPosition(): Vector3
	for _ = 1, 200 do
		local candidate = Vector3.new(random:NextNumber(-39, 39), 2, random:NextNumber(-29, 29))
		if isPickupPositionClear(candidate) then
			return candidate
		end
	end
	error("Unable to find a collision-free Moonmarket pickup position")
end

local function spawnPickup(ingredientName: string)
	local position = randomPickupPosition()
	local pickupModel = cloneAsset(`Thrixel{ingredientName}`, ingredientName, 4.2, CFrame.new(position), false)
	local pickup = pickupModel and firstPart(pickupModel) or part(`${ingredientName}_PLACEHOLDER`, Vector3.new(2.5, 2.5, 2.5), CFrame.new(position), ingredientColors[ingredientName], Enum.Material.Neon)
	assert(pickup, `{ingredientName} asset has no BasePart`)
	if pickupModel then
		if ingredientName == "Glowcap" then
			styleGroup(pickupModel, "mushroom_cap", Color3.fromRGB(186, 46, 132), Enum.Material.SmoothPlastic)
			styleGroup(pickupModel, "cap_rim", Color3.fromRGB(111, 45, 126), Enum.Material.SmoothPlastic)
			styleGroup(pickupModel, "mushroom_stem", Color3.fromRGB(224, 198, 165), Enum.Material.SmoothPlastic)
			styleGroup(pickupModel, "brass_band", Color3.fromRGB(213, 151, 61), Enum.Material.Metal)
			styleGroup(pickupModel, "glow_spots", Color3.fromRGB(98, 221, 173), Enum.Material.Neon)
		elseif ingredientName == "Moonfruit" then
			styleGroup(pickupModel, "fruit_body", Color3.fromRGB(124, 235, 170), Enum.Material.SmoothPlastic)
			styleGroup(pickupModel, "plum_ridges", Color3.fromRGB(112, 48, 142), Enum.Material.SmoothPlastic)
			styleGroup(pickupModel, "brass_stem", Color3.fromRGB(228, 169, 72), Enum.Material.Metal)
		elseif ingredientName == "StarCrystal" then
			styleGroup(pickupModel, "crystal_points", Color3.fromRGB(86, 183, 202), Enum.Material.Glass)
			styleGroup(pickupModel, "stone_collar", Color3.fromRGB(91, 43, 111), Enum.Material.Slate)
			styleGroup(pickupModel, "brass_bands", Color3.fromRGB(228, 169, 72), Enum.Material.Metal)
			styleGroup(pickupModel, "inner_glow", Color3.fromRGB(89, 211, 224), Enum.Material.Neon)
		end
	end
	if not pickupModel then
		pickup.Shape = Enum.PartType.Ball
		pickup:SetAttribute("ReplaceWithThrixelAsset", true)
	end
	pickup.CanCollide = false
	local interactionAnchor = part(`${ingredientName}Interaction`, Vector3.new(3, 4, 3), CFrame.new(position + Vector3.new(0, 1, 0)), ingredientColors[ingredientName])
	interactionAnchor.Transparency = 1
	interactionAnchor.CanCollide = false
	activePickupPositions[interactionAnchor] = position
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Collect"
	prompt.ObjectText = ingredientName
	prompt.MaxActivationDistance = Config.InteractDistance
	prompt.RequiresLineOfSight = false
	prompt.Parent = interactionAnchor
	local claimed = false
	prompt.Triggered:Connect(function(player)
		if claimed then return end
		claimed = true
		activePickupPositions[interactionAnchor] = nil
		local inventory = inventories[player]
		if inventory then
			inventory[ingredientName] = (inventory[ingredientName] or 0) + 1
			refreshPlayer(player)
		end
		if pickupModel then
			pickupModel:Destroy()
		else
			pickup:Destroy()
		end
		interactionAnchor:Destroy()
		task.delay(Config.IngredientRespawnSeconds, function()
			spawnPickup(ingredientName)
		end)
	end)
end

for _, ingredientName in Config.IngredientNames do
	for _ = 1, Config.PickupCountPerIngredient do
		spawnPickup(ingredientName)
	end
end

local function addScore(player: Player, amount: number): number
	local newScore = (player:GetAttribute("Score") or 0) + amount
	player:SetAttribute("Score", newScore)
	local leaderstats = player:FindFirstChild("leaderstats")
	local scoreValue = leaderstats and leaderstats:FindFirstChild("Score")
	if scoreValue and scoreValue:IsA("IntValue") then
		scoreValue.Value = newScore
	end
	return newScore
end

deliverPrompt.Triggered:Connect(function(player)
	if not roundActive then return end
	local inventory = inventories[player]
	if not inventory then return end
	local order = playerOrders[player]
	if not order then
		assignPlayerOrder(player)
		order = assert(playerOrders[player])
	end
	local needed = {}
	for _, ingredientName in order do
		needed[ingredientName] = (needed[ingredientName] or 0) + 1
	end
	local missingIngredients = {}
	for ingredientName, count in needed do
		local missingCount = count - (inventory[ingredientName] or 0)
		if missingCount > 0 then
			table.insert(missingIngredients, `{ingredientName} x{missingCount}`)
		end
	end
	if #missingIngredients > 0 then
		player:SetAttribute("LastResult", `Still needed: {table.concat(missingIngredients, ", ")}`)
		return
	end
	for ingredientName, count in needed do
		inventory[ingredientName] -= count
	end
	addScore(player, Config.BrewPoints)
	local leaderstats = player:FindFirstChild("leaderstats")
	local brewsValue = leaderstats and leaderstats:FindFirstChild("Brews")
	if brewsValue and brewsValue:IsA("IntValue") then brewsValue.Value += 1 end
	roundBrews[player] = (roundBrews[player] or 0) + 1
	player:SetAttribute("RoundBrews", roundBrews[player])
	player:SetAttribute("LastResult", `Perfect brew! +{Config.BrewPoints}`)
	refreshPlayer(player)
	if roundBrews[player] >= Config.BrewsToWin then
		roundWinner = player
		roundActive = false
		deliverPrompt.Enabled = false
		state:SetAttribute("Status", `{player.DisplayName} completed {Config.BrewsToWin} brews!`)
	else
		assignPlayerOrder(player)
	end
end)

local function setupPlayer(player: Player)
	inventories[player] = {}
	roundBrews[player] = 0
	local oldLeaderstats = player:FindFirstChild("leaderstats")
	if oldLeaderstats then oldLeaderstats:Destroy() end
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	leaderstats.Parent = player
	for _, name in { "Score", "Brews", "Wins" } do
		local value = Instance.new("IntValue")
		value.Name = name
		value.Parent = leaderstats
	end
	player:SetAttribute("Score", 0)
	player:SetAttribute("RoundBrews", 0)
	player:SetAttribute("Order", "Waiting for the next round")
	player:SetAttribute("Inventory", "")
	player:SetAttribute("LastResult", "Collect the current order")
	refreshPlayer(player)
	if roundActive then
		assignPlayerOrder(player)
	end
end

Players.PlayerAdded:Connect(setupPlayer)
for _, player in Players:GetPlayers() do
	setupPlayer(player)
end

Players.PlayerRemoving:Connect(function(player)
	inventories[player] = nil
	roundBrews[player] = nil
	playerOrders[player] = nil
end)

task.spawn(function()
	while true do
		state:SetAttribute("Round", (state:GetAttribute("Round") :: number) + 1)
		state:SetAttribute("Status", `Market open — first to {Config.BrewsToWin} brews wins`)
		state:SetAttribute("Winner", "")
		roundWinner = nil
		roundActive = true
		table.clear(playerOrders)
		for _, player in Players:GetPlayers() do
			roundBrews[player] = 0
			player:SetAttribute("RoundBrews", 0)
			assignPlayerOrder(player)
		end
		deliverPrompt.Enabled = true
		for seconds = Config.RoundSeconds, 0, -1 do
			state:SetAttribute("SecondsLeft", seconds)
			if not roundActive then break end
			task.wait(1)
		end
		roundActive = false
		deliverPrompt.Enabled = false

		local winners: { Player } = {}
		if roundWinner and roundWinner.Parent == Players then
			table.insert(winners, roundWinner)
		else
			local bestBrewCount = 0
			for _, player in Players:GetPlayers() do
				bestBrewCount = math.max(bestBrewCount, roundBrews[player] or 0)
			end
			if bestBrewCount > 0 then
				for _, player in Players:GetPlayers() do
					if (roundBrews[player] or 0) == bestBrewCount then
						table.insert(winners, player)
					end
				end
			end
		end

		if #winners == 0 then
			state:SetAttribute("Status", "Round complete — brew an order next round to win")
			state:SetAttribute("Winner", "")
		else
			local winnerNames = {}
			for _, player in winners do
				local leaderstats = player:FindFirstChild("leaderstats")
				local wins = leaderstats and leaderstats:FindFirstChild("Wins")
				if wins and wins:IsA("IntValue") then wins.Value += 1 end
				addScore(player, Config.WinBonus)
				player:SetAttribute("LastResult", `Round winner! +{Config.WinBonus}`)
				table.insert(winnerNames, player.DisplayName)
			end
			local winnerText = table.concat(winnerNames, ", ")
			state:SetAttribute("Winner", winnerText)
			state:SetAttribute("Status", `Winner: {winnerText} — +{Config.WinBonus} points`)
		end

		for _, player in Players:GetPlayers() do
			roundBrews[player] = 0
			player:SetAttribute("RoundBrews", 0)
		end
		for seconds = Config.IntermissionSeconds, 1, -1 do
			state:SetAttribute("SecondsLeft", seconds)
			state:SetAttribute("Order", `Next round starts in {seconds}s`)
			for _, player in Players:GetPlayers() do
				player:SetAttribute("Order", `Next recipe in {seconds}s`)
			end
			task.wait(1)
		end
	end
end)

task.wait(3)
workspace:SetAttribute("BuildReady", true)
for _, player in Players:GetPlayers() do
	if player.Character then
		placeCharacter(player.Character)
	end
end
local requiredAssets = { "ThrixelCauldron", "ThrixelStall", "ThrixelLantern", "ThrixelGlowcap", "ThrixelMoonfruit", "ThrixelStarCrystal" }
local missingAssets = {}
for _, name in requiredAssets do
	if not assets or not assets:FindFirstChild(name) then
		table.insert(missingAssets, name)
	end
end
workspace:SetAttribute("MissingThrixelAssets", table.concat(missingAssets, ","))
local pickupCount = 0
local pickupSpacingPassed = true
local recordedPositions = {}
for _, position in activePickupPositions do
	pickupCount += 1
	for _, otherPosition in recordedPositions do
		if Vector2.new(position.X - otherPosition.X, position.Z - otherPosition.Z).Magnitude < Config.PickupClearance then
			pickupSpacingPassed = false
		end
	end
	table.insert(recordedPositions, position)
end
workspace:SetAttribute("ActivePickupCount", pickupCount)
workspace:SetAttribute("PickupSpacingPassed", pickupSpacingPassed)
workspace:SetAttribute("RoundSeconds", Config.RoundSeconds)
workspace:SetAttribute("BrewsToWin", Config.BrewsToWin)
workspace:SetAttribute("BrewPromptReady", deliverPrompt.Parent == brewInteraction and deliverPrompt.KeyboardKeyCode == Enum.KeyCode.E)
workspace:SetAttribute(
	"SelfTestPassed",
	#missingAssets == 0
		and #Config.IngredientNames == 3
		and Config.OrderSize == 3
		and Config.RoundSeconds <= 90
		and Config.BrewsToWin >= 1
		and deliverPrompt.Parent == brewInteraction
		and deliverPrompt.KeyboardKeyCode == Enum.KeyCode.E
		and #recipePool == 10
		and pickupCount == #Config.IngredientNames * Config.PickupCountPerIngredient
		and pickupSpacingPassed
)
workspace:SetAttribute("PrototypeMeshParts", template and 5 or 0)
local runtimeMeshParts = 0
for _, descendant in world:GetDescendants() do
	if descendant:IsA("MeshPart") then
		runtimeMeshParts += 1
	end
end
workspace:SetAttribute("RuntimeMeshParts", runtimeMeshParts)
