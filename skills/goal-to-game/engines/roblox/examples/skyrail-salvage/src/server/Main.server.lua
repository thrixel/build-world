local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Shared.Config)

local remotes = Instance.new("Folder")
remotes.Name = "SkyrailEvents"
remotes.Parent = ReplicatedStorage
local laneEvent = Instance.new("RemoteEvent")
laneEvent.Name = "Lane"
laneEvent.Parent = remotes
local stateEvent = Instance.new("RemoteEvent")
stateEvent.Name = "State"
stateEvent.Parent = remotes

local world = Instance.new("Folder")
world.Name = "SkyrailWorld"
world.Parent = Workspace
local reviewShots = Instance.new("Folder")
reviewShots.Name = "ReviewShots"
reviewShots.Parent = Workspace

local function part(name, size, cframe, color, parent)
	local value = Instance.new("Part")
	value.Name = name
	value.Size = size
	value.CFrame = cframe
	value.Anchored = true
	value.Material = Enum.Material.SmoothPlastic
	value.Color = color
	value.TopSurface = Enum.SurfaceType.Smooth
	value.BottomSurface = Enum.SurfaceType.Smooth
	value.Parent = parent or world
	return value
end

local cloudFloor = part("CloudFloor", Vector3.new(86, 1, Config.CourseLength + 100), CFrame.new(0, -9, -Config.CourseLength / 2 + 40), Color3.fromRGB(77, 105, 143))
cloudFloor.Material = Enum.Material.Foil
cloudFloor.Transparency = 0.25
cloudFloor.CanCollide = false
for lane = 1, 3 do
	local rail = part("Rail" .. lane, Vector3.new(1.1, 0.7, Config.CourseLength + 30), CFrame.new(Config.Lanes[lane], -1.5, -Config.CourseLength / 2 + 10), Color3.fromRGB(88, 168, 205))
	rail.Material = Enum.Material.Neon
end

local obstacles = {}
local pickups = {}
local obstaclePattern = {2, 1, 3, 2, 3, 1, 2, 1, 3, 2, 1, 3}
for index, lane in obstaclePattern do
	local z = -55 - (index - 1) * 50
	local obstacle = part("Barrier" .. index, Vector3.new(7, 7, 2), CFrame.new(Config.Lanes[lane], 2.5, z), Color3.fromRGB(222, 74, 83))
	obstacle.Material = Enum.Material.Neon
	obstacle.CanCollide = false
	table.insert(obstacles, {part = obstacle, lane = lane, z = z})
end
for index = 1, 20 do
	local lane = ((index * 7) % 3) + 1
	local z = -32 - (index - 1) * 31
	local cog = part("ChargeCog" .. index, Vector3.new(2.2, 2.2, 0.8), CFrame.new(Config.Lanes[lane], 3, z), Color3.fromRGB(255, 198, 70))
	cog.Shape = Enum.PartType.Cylinder
	cog.Orientation = Vector3.new(0, 0, 90)
	cog.Material = Enum.Material.Neon
	cog.CanCollide = false
	table.insert(pickups, {part = cog, lane = lane, z = z, index = index})
end
local finish = part("RescueBeacon", Vector3.new(32, 28, 4), CFrame.new(0, 13, -Config.CourseLength), Color3.fromRGB(70, 235, 184))
finish.Material = Enum.Material.Neon
finish.CanCollide = false

local shotData = {
	Establishing = CFrame.new(48, 38, 35) * CFrame.Angles(math.rad(-28), math.rad(145), 0),
	PlayerScale = CFrame.new(15, 8, 12) * CFrame.Angles(math.rad(-12), math.rad(145), 0),
	HeroClose = CFrame.new(11, 7, 7) * CFrame.Angles(math.rad(-8), math.rad(142), 0),
	MovingPart = CFrame.new(-8, 6, 4) * CFrame.Angles(math.rad(-5), math.rad(-135), 0),
	Collision = CFrame.new(26, 11, -53) * CFrame.Angles(math.rad(-12), math.rad(145), 0),
	LightingDark = CFrame.new(-28, 16, -155) * CFrame.Angles(math.rad(-18), math.rad(-35), 0),
	Gameplay = CFrame.new(34, 24, -225) * CFrame.Angles(math.rad(-24), math.rad(150), 0),
}
for name, cframe in shotData do
	local marker = part(name, Vector3.one, cframe, Color3.new(), reviewShots)
	marker.Transparency = 1
	marker.CanCollide = false
end

local playerState = {}
local carts = Instance.new("Folder")
carts.Name = "PlayerGliders"
carts.Parent = world

local function gliderFor(player)
	local importedRoot = Workspace:FindFirstChild("ThrixelAssets")
	local template = importedRoot and importedRoot:FindFirstChild("ClockworkGlider")
	if template and template:IsA("Model") then
		local model = template:Clone()
		model.Name = player.Name .. "Glider"
		model.Parent = carts
		local bounds = model:GetExtentsSize()
		local longest = math.max(bounds.X, bounds.Y, bounds.Z)
		if longest > 0 then
			model:ScaleTo(model:GetScale() * 18 / longest)
		end
		local propeller
		for _, instance in model:GetDescendants() do
			if instance:IsA("BasePart") then
				instance.Anchored = true
				model.PrimaryPart = model.PrimaryPart or instance
				if string.find(string.lower(instance.Name), "propeller", 1, true) then
					propeller = instance
				end
			end
		end
		if propeller and model.PrimaryPart then
			model:PivotTo(CFrame.new(0, 2, 15))
			return model, propeller, model:GetPivot():ToObjectSpace(propeller.CFrame)
		end
		model:Destroy()
	end
	local model = Instance.new("Model")
	model.Name = player.Name .. "GliderBlockout"
	local hull = part("Hull", Vector3.new(8, 2, 12), CFrame.new(0, 2, 15), Color3.fromRGB(41, 126, 155), model)
	hull:SetAttribute("BlockoutOnly", true)
	local wing = part("Wing", Vector3.new(14, 0.6, 4), hull.CFrame * CFrame.new(0, 0, 1), Color3.fromRGB(227, 165, 70), model)
	local propeller = part("Propeller", Vector3.new(7, 0.5, 0.7), hull.CFrame * CFrame.new(0, 0, 6.4), Color3.fromRGB(245, 213, 125), model)
	model.PrimaryPart = hull
	model.Parent = carts
	return model, propeller, model:GetPivot():ToObjectSpace(propeller.CFrame)
end

local function send(player, message)
	local state = playerState[player]
	if state then
		stateEvent:FireClient(player, {
			lane = state.lane,
			progress = math.clamp(-state.z / Config.CourseLength, 0, 1),
			cogs = state.cogs,
			required = Config.RequiredCogs,
			hull = state.hull,
			status = state.status,
			message = message,
		})
	end
end

local function reset(player)
	local old = playerState[player]
	if old and old.model then
		old.model:Destroy()
	end
	local model, propeller, propellerLocal = gliderFor(player)
	playerState[player] = {
		lane = 2,
		z = 15,
		cogs = 0,
		hull = Config.MaxHull,
		status = "running",
		collected = {},
		hit = {},
		model = model,
		propeller = propeller,
		propellerLocal = propellerLocal,
		lastLaneAt = 0,
	}
	local character = player.Character or player.CharacterAdded:Wait()
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = 0
		humanoid.JumpPower = 0
	end
	send(player, "Collect 12 charge cogs before the rescue beacon")
end

laneEvent.OnServerEvent:Connect(function(player, direction)
	local state = playerState[player]
	if not state or state.status ~= "running" or (direction ~= -1 and direction ~= 1) then
		return
	end
	local now = Workspace:GetServerTimeNow()
	if now - state.lastLaneAt < 0.14 then
		return
	end
	state.lastLaneAt = now
	state.lane = math.clamp(state.lane + direction, 1, 3)
end)

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function()
		task.wait(0.25)
		reset(player)
	end)
	if player.Character then
		task.spawn(reset, player)
	end
end)
Players.PlayerRemoving:Connect(function(player)
	local state = playerState[player]
	if state and state.model then
		state.model:Destroy()
	end
	playerState[player] = nil
end)

local stateAccumulator = 0
RunService.Heartbeat:Connect(function(delta)
	local now = Workspace:GetServerTimeNow()
	stateAccumulator += delta
	for player, state in playerState do
		if state.status == "running" then
			state.z -= Config.Speed * delta
			local x = Config.Lanes[state.lane]
			local target = CFrame.new(x, 2, state.z)
			state.model:PivotTo(state.model:GetPivot():Lerp(target, math.clamp(delta * 10, 0, 1)))
			state.propeller.CFrame = state.model:GetPivot() * state.propellerLocal * CFrame.Angles(0, 0, now * 12)
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart")
			if root then
				root.CFrame = CFrame.new(x, 5.5, state.z + 1)
			end
			for _, pickup in pickups do
				if not state.collected[pickup.index] and pickup.lane == state.lane and math.abs(state.z - pickup.z) < 3.5 then
					state.collected[pickup.index] = true
					state.cogs += 1
				end
			end
			for index, obstacle in obstacles do
				if not state.hit[index] and obstacle.lane == state.lane and math.abs(state.z - obstacle.z) < 3.8 then
					state.hit[index] = true
					state.hull -= 1
					send(player, "Barrier impact — change lanes earlier")
					if state.hull <= 0 then
						state.status = "lost"
						send(player, "GLIDER LOST — restarting")
						task.delay(3, function()
							if player.Parent then reset(player) end
						end)
					end
				end
			end
			if state.z <= -Config.CourseLength then
				state.status = state.cogs >= Config.RequiredCogs and "won" or "lost"
				send(player, state.status == "won" and "RESCUE POWERED — route complete" or "Beacon undercharged — restarting")
				task.delay(4, function()
					if player.Parent then reset(player) end
				end)
			end
		end
		if stateAccumulator >= 0.15 then
			send(player, nil)
		end
	end
	if stateAccumulator >= 0.15 then
		stateAccumulator = 0
	end
	for _, pickup in pickups do
		pickup.part.CFrame = CFrame.new(pickup.part.Position) * CFrame.Angles(0, 0, now * 2.4)
	end
end)
