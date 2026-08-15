local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Shared.Config)

local remotes = Instance.new("Folder")
remotes.Name = "VaultbreakEvents"
remotes.Parent = ReplicatedStorage
local stateEvent = Instance.new("RemoteEvent")
stateEvent.Name = "State"
stateEvent.Parent = remotes

local world = Instance.new("Folder")
world.Name = "VaultbreakWorld"
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

part("Floor", Vector3.new(96, 1, 76), CFrame.new(0, -0.5, 0), Color3.fromRGB(28, 35, 45))
for _, wall in {
	{Vector3.new(96, 12, 1), CFrame.new(0, 6, -38)},
	{Vector3.new(96, 12, 1), CFrame.new(0, 6, 38)},
	{Vector3.new(1, 12, 76), CFrame.new(-48, 6, 0)},
	{Vector3.new(1, 12, 76), CFrame.new(48, 6, 0)},
	{Vector3.new(1, 9, 44), CFrame.new(-12, 4.5, -2)},
	{Vector3.new(44, 9, 1), CFrame.new(15, 4.5, 12)},
} do
	part("Wall", wall[1], wall[2], Color3.fromRGB(58, 66, 78))
end

local spawn = Instance.new("SpawnLocation")
spawn.Name = "Start"
spawn.Size = Vector3.new(8, 1, 8)
spawn.CFrame = CFrame.new(-39, 0.5, 28)
spawn.Anchored = true
spawn.Neutral = true
spawn.Color = Color3.fromRGB(62, 180, 160)
spawn.Parent = world

local vaultMarker = part("VaultHitbox", Vector3.new(20, 14, 5), CFrame.new(35, 7, -28), Color3.fromRGB(133, 93, 55))
vaultMarker.Transparency = 0.55
local door = part("VaultDoorBlockout", Vector3.new(10, 11, 1), CFrame.new(35, 5.5, -24.8), Color3.fromRGB(205, 155, 65))
door:SetAttribute("BlockoutOnly", true)
local importedRoot = Workspace:FindFirstChild("ThrixelAssets")
local importedVault = importedRoot and importedRoot:FindFirstChild("ClockworkVault")
if importedVault and importedVault:IsA("Model") then
	local bounds = importedVault:GetExtentsSize()
	local longest = math.max(bounds.X, bounds.Y, bounds.Z)
	if longest > 0 and not importedVault:GetAttribute("ThrixelScale") then
		local scale = 18 / longest
		importedVault:ScaleTo(importedVault:GetScale() * scale)
		importedVault:SetAttribute("ThrixelScale", scale)
	end
	for _, instance in importedVault:GetDescendants() do
		if instance:IsA("BasePart") then
			instance.Anchored = true
		end
		if instance:IsA("BasePart") and string.find(string.lower(instance.Name), "vaultdoor", 1, true) then
			door = instance
		end
	end
	importedVault:PivotTo(CFrame.new(35, 7, -28))
	world.VaultDoorBlockout.Transparency = 1
	world.VaultDoorBlockout.CanCollide = false
end
local doorClosedCFrame = door.CFrame
local exit = part("VaultExit", Vector3.new(8, 8, 1), CFrame.new(35, 4, -29), Color3.fromRGB(70, 210, 145))
exit.Transparency = 0.65
exit.CanCollide = false

local fusePositions = {
	Vector3.new(-31, 2, -25),
	Vector3.new(7, 2, 27),
	Vector3.new(28, 2, 1),
}
local fuseParts = {}
for index, position in fusePositions do
	local fuse = part("Fuse" .. index, Vector3.new(1.3, 3, 1.3), CFrame.new(position), Color3.fromRGB(102, 225, 255))
	fuse.Material = Enum.Material.Neon
	fuse.CanCollide = false
	table.insert(fuseParts, fuse)
end

local sentinels = {}
for index, data in {
	{Vector3.new(-26, 3, 2), Vector3.new(-26, 3, -27)},
	{Vector3.new(12, 3, 30), Vector3.new(37, 3, 30)},
	{Vector3.new(18, 3, -7), Vector3.new(41, 3, -7)},
} do
	local body = part("Sentinel" .. index, Vector3.new(3, 3, 3), CFrame.new(data[1]), Color3.fromRGB(235, 72, 92))
	body.Shape = Enum.PartType.Ball
	body.Material = Enum.Material.Neon
	body.CanCollide = false
	table.insert(sentinels, {body = body, a = data[1], b = data[2], phase = index * 1.7})
end

local shotData = {
	Establishing = CFrame.new(0, 62, 38) * CFrame.Angles(math.rad(-58), 0, 0),
	PlayerScale = CFrame.new(-38, 8, 17) * CFrame.Angles(math.rad(-15), 0, 0),
	HeroClose = CFrame.new(35, 8, -15) * CFrame.Angles(math.rad(-8), math.rad(180), 0),
	MovingPart = CFrame.new(27, 7, -22) * CFrame.Angles(0, math.rad(-90), 0),
	Collision = CFrame.new(15, 9, -1) * CFrame.Angles(math.rad(-22), math.rad(-25), 0),
	LightingDark = CFrame.new(-7, 7, -29) * CFrame.Angles(math.rad(-10), math.rad(-25), 0),
	Gameplay = CFrame.new(12, 42, 38) * CFrame.Angles(math.rad(-52), math.rad(8), 0),
}
for name, cframe in shotData do
	local marker = part(name, Vector3.one, cframe, Color3.new(), reviewShots)
	marker.Transparency = 1
	marker.CanCollide = false
end

local playerState = {}
local roundEndsAt = Workspace:GetServerTimeNow() + Config.RoundSeconds
local doorOpen = false

local function send(player, message)
	local state = playerState[player]
	if not state then
		return
	end
	stateEvent:FireClient(player, {
		fuses = state.fuses,
		required = Config.RequiredFuses,
		timeLeft = math.max(0, math.ceil(roundEndsAt - Workspace:GetServerTimeNow())),
		alarm = state.alarm,
		message = message,
		won = state.won,
	})
end

local function resetPlayer(player)
	playerState[player] = {fuses = 0, alarm = 0, won = false, collected = {}}
	player:LoadCharacter()
	task.delay(0.5, function()
		send(player, "Collect all fuse keys, then reach the vault")
	end)
end

for index, fuse in fuseParts do
	fuse.Touched:Connect(function(hit)
		local player = Players:GetPlayerFromCharacter(hit.Parent)
		local state = player and playerState[player]
		if not state or state.won or state.collected[index] then
			return
		end
		state.collected[index] = true
		state.fuses += 1
		fuse.Transparency = 1
		fuse.CanTouch = false
		send(player, state.fuses == Config.RequiredFuses and "Vault unlocked — reach the green door" or "Fuse key secured")
		if state.fuses == Config.RequiredFuses and not doorOpen then
			doorOpen = true
			local closed = door.CFrame
			local hinge = closed * CFrame.new(-door.Size.X * 0.5, 0, 0)
			local opened = hinge * CFrame.Angles(0, math.rad(-95), 0) * CFrame.new(door.Size.X * 0.5, 0, 0)
			TweenService:Create(door, TweenInfo.new(1.4, Enum.EasingStyle.Quart, Enum.EasingDirection.Out), {
				CFrame = opened,
			}):Play()
		end
	end)
end

exit.Touched:Connect(function(hit)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	local state = player and playerState[player]
	if not state or state.won then
		return
	end
	if state.fuses < Config.RequiredFuses then
		send(player, "The vault needs all three fuse keys")
		return
	end
	state.won = true
	send(player, "VAULTBREAKER — escape complete")
end)

Players.PlayerAdded:Connect(resetPlayer)
Players.PlayerRemoving:Connect(function(player)
	playerState[player] = nil
end)
for _, player in Players:GetPlayers() do
	task.spawn(resetPlayer, player)
end

local accumulator = 0
RunService.Heartbeat:Connect(function(delta)
	local now = Workspace:GetServerTimeNow()
	for _, sentinel in sentinels do
		local alpha = (math.sin(now * 0.65 + sentinel.phase) + 1) * 0.5
		local position = sentinel.a:Lerp(sentinel.b, alpha)
		sentinel.body.CFrame = CFrame.new(position) * CFrame.Angles(0, now, 0)
	end
	accumulator += delta
	if accumulator < 0.1 then
		return
	end
	accumulator = 0
	for player, state in playerState do
		local character = player.Character
		local rootPart = character and character:FindFirstChild("HumanoidRootPart")
		if rootPart and not state.won then
			local detected = false
			for _, sentinel in sentinels do
				local offset = rootPart.Position - sentinel.body.Position
				if offset.Magnitude <= Config.SentinelRange then
					local ray = Workspace:Raycast(sentinel.body.Position, offset)
					if ray and ray.Instance:IsDescendantOf(character) then
						detected = true
						break
					end
				end
			end
			state.alarm = math.clamp(state.alarm + (detected and 0.16 or -0.09), 0, Config.AlarmSeconds)
			if state.alarm >= Config.AlarmSeconds then
				state.alarm = 0
				rootPart.CFrame = spawn.CFrame + Vector3.new(0, 4, 0)
				send(player, "Detected — returned to the entry")
			else
				send(player, nil)
			end
		end
	end
	if now >= roundEndsAt then
		roundEndsAt = now + Config.RoundSeconds
		doorOpen = false
		door.CFrame = doorClosedCFrame
		for index, fuse in fuseParts do
			fuse.Transparency = 0
			fuse.CanTouch = true
		end
		for player in playerState do
			resetPlayer(player)
		end
	end
end)
