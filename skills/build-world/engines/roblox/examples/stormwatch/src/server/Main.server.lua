local Lighting = game:GetService("Lighting")
local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local state = Instance.new("Folder")
state.Name = "StormwatchState"
state.Parent = ReplicatedStorage

local phase = Instance.new("StringValue")
phase.Name = "Phase"
phase.Value = "Dawn"
phase.Parent = state

local timeLeft = Instance.new("IntValue")
timeLeft.Name = "TimeLeft"
timeLeft.Value = 20
timeLeft.Parent = state

local function part(name, size, position, color, material)
    local value = Instance.new("Part")
    value.Name = name
    value.Size = size
    value.Position = position
    value.Anchored = true
    value.Color = color
    value.Material = material or Enum.Material.SmoothPlastic
    value.Parent = workspace
    return value
end

local importedLighthouse = workspace:FindFirstChild("lighthouse-grouped")
if importedLighthouse then
    for _, instance in importedLighthouse:GetDescendants() do
        if instance:IsA("BasePart") then
            instance.Anchored = true
        end
    end
end

part("Island", Vector3.new(180, 4, 180), Vector3.new(0, -2, 0), Color3.fromRGB(50, 67, 54), Enum.Material.Grass)
part("Cliff", Vector3.new(54, 14, 54), Vector3.new(0, 5, 0), Color3.fromRGB(72, 75, 78), Enum.Material.Slate)

local spawn = Instance.new("SpawnLocation")
spawn.Name = "HarborSpawn"
spawn.Size = Vector3.new(12, 1, 12)
spawn.Position = Vector3.new(0, 13, 24)
spawn.Anchored = true
spawn.Neutral = true
spawn.Parent = workspace

local lighthouse = Instance.new("Model")
lighthouse.Name = "ThrixelLighthouse"
lighthouse:SetAttribute("ThrixelAsset", true)
lighthouse.Parent = workspace
CollectionService:AddTag(lighthouse, "ThrixelAsset")

for level = 0, 5 do
    local tower = part("TowerSegment", Vector3.new(18 - level * 1.4, 8, 18 - level * 1.4), Vector3.new(0, 13 + level * 8, 0), level % 2 == 0 and Color3.fromRGB(236, 230, 214) or Color3.fromRGB(173, 57, 48), Enum.Material.Concrete)
    tower.Shape = Enum.PartType.Cylinder
    tower.Orientation = Vector3.new(0, 0, 90)
    tower.Parent = lighthouse
end

local lanternRoom = part("LanternRoom", Vector3.new(16, 8, 16), Vector3.new(0, 61, 0), Color3.fromRGB(255, 217, 116), Enum.Material.Glass)
lanternRoom.Transparency = 0.35
lanternRoom.Shape = Enum.PartType.Cylinder
lanternRoom.Orientation = Vector3.new(0, 0, 90)
lanternRoom.Parent = lighthouse

local beacon = part("Beacon", Vector3.new(3, 3, 20), Vector3.new(0, 62, -8), Color3.fromRGB(255, 241, 168), Enum.Material.Neon)
beacon.CanCollide = false
beacon:SetAttribute("ThrixelMovingPart", true)
beacon:SetAttribute("ThrixelPivotVerified", true)
beacon.Parent = lighthouse
CollectionService:AddTag(beacon, "ThrixelMovingPart")
lighthouse.PrimaryPart = lanternRoom

local safeRadius = 48
local rotation = 0
RunService.Heartbeat:Connect(function(dt)
    rotation += dt * 0.8
    beacon.CFrame = CFrame.new(0, 62, 0) * CFrame.Angles(0, rotation, 0) * CFrame.new(0, 0, -8)
end)

local function setStorm(active)
    phase.Value = active and "Storm" or "Calm"
    Lighting.ClockTime = active and 1 or 8
    Lighting.Brightness = active and 0.8 or 2.5
    Lighting.FogEnd = active and 130 or 1000
    Lighting.FogColor = active and Color3.fromRGB(55, 68, 84) or Color3.fromRGB(180, 210, 235)
    workspace.GlobalWind = active and Vector3.new(42, 0, 18) or Vector3.zero
end

task.spawn(function()
    while true do
        setStorm(false)
        for remaining = 20, 0, -1 do
            timeLeft.Value = remaining
            task.wait(1)
        end
        setStorm(true)
        for remaining = 35, 0, -1 do
            timeLeft.Value = remaining
            for _, player in Players:GetPlayers() do
                local character = player.Character
                local humanoid = character and character:FindFirstChildOfClass("Humanoid")
                local root = character and character:FindFirstChild("HumanoidRootPart")
                if humanoid and root and Vector3.new(root.Position.X, 0, root.Position.Z).Magnitude > safeRadius then
                    humanoid:TakeDamage(6)
                end
            end
            task.wait(1)
        end
    end
end)
