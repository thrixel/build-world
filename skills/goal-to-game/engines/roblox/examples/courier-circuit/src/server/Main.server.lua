local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local state = Instance.new("Folder")
state.Name = "CourierState"
state.Parent = ReplicatedStorage

local deliveries = Instance.new("IntValue")
deliveries.Name = "Deliveries"
deliveries.Parent = state

local function part(name, size, cf, color, material)
    local value = Instance.new("Part")
    value.Name = name
    value.Size = size
    value.CFrame = cf
    value.Anchored = true
    value.Color = color
    value.Material = material or Enum.Material.SmoothPlastic
    value.Parent = workspace
    return value
end

local importedCart = workspace:FindFirstChild("delivery-cart-grouped")
if importedCart then
    for _, instance in importedCart:GetDescendants() do
        if instance:IsA("BasePart") then
            instance.Anchored = true
        end
    end
end

part("Road", Vector3.new(220, 2, 220), CFrame.new(0, -1, 0), Color3.fromRGB(34, 38, 45), Enum.Material.Asphalt)
for x = -90, 90, 30 do
    for z = -90, 90, 30 do
        if math.abs(x) < 20 or math.abs(z) < 20 then
            continue
        end
        local height = 16 + ((math.abs(x * 3 + z * 5) % 4) * 8)
        part("Building", Vector3.new(20, height, 20), CFrame.new(x, height / 2, z), Color3.fromRGB(70 + math.abs(x) % 80, 92, 116 + math.abs(z) % 80), Enum.Material.Concrete)
    end
end

local spawn = Instance.new("SpawnLocation")
spawn.Name = "DepotSpawn"
spawn.Size = Vector3.new(12, 1, 12)
spawn.Position = Vector3.new(0, 1, 0)
spawn.Anchored = true
spawn.Neutral = true
spawn.Parent = workspace

local cart = Instance.new("Model")
cart.Name = "ThrixelDeliveryCart"
cart:SetAttribute("ThrixelAsset", true)
cart.Parent = workspace
CollectionService:AddTag(cart, "ThrixelAsset")

local body = part("CartBody", Vector3.new(8, 2, 12), CFrame.new(0, 4, 14), Color3.fromRGB(240, 177, 54), Enum.Material.Metal)
body.Anchored = false
body.Parent = cart

local seat = Instance.new("VehicleSeat")
seat.Name = "DriverSeat"
seat.Size = Vector3.new(4, 1, 4)
seat.CFrame = body.CFrame * CFrame.new(0, 1.5, 1)
seat.Anchored = false
seat.MaxSpeed = 55
seat.Parent = cart

local seatWeld = Instance.new("WeldConstraint")
seatWeld.Part0 = body
seatWeld.Part1 = seat
seatWeld.Parent = seat

local wheelSpecs = {
    {"WheelFrontLeft", -4.4, -3.5}, {"WheelFrontRight", 4.4, -3.5},
    {"WheelRearLeft", -4.4, 3.5}, {"WheelRearRight", 4.4, 3.5},
}
local visualWheels = {}
for _, spec in wheelSpecs do
    local wheel = Instance.new("Part")
    wheel.Name = spec[1]
    wheel.Shape = Enum.PartType.Cylinder
    wheel.Size = Vector3.new(2.4, 1.2, 2.4)
    wheel.CFrame = body.CFrame * CFrame.new(spec[2], -1.2, spec[3]) * CFrame.Angles(0, 0, math.rad(90))
    wheel.Color = Color3.fromRGB(28, 31, 36)
    wheel.Material = Enum.Material.Rubber
    wheel.Anchored = true
    wheel.CanCollide = false
    wheel:SetAttribute("ThrixelMovingPart", true)
    wheel:SetAttribute("ThrixelPivotVerified", false)
    wheel.Parent = cart
    CollectionService:AddTag(wheel, "ThrixelMovingPart")
    table.insert(visualWheels, {part = wheel, offset = CFrame.new(spec[2], -1.2, spec[3])})
end
cart.PrimaryPart = body

local wheelAngle = 0
RunService.Heartbeat:Connect(function(dt)
    if seat.Occupant then
        local forward = body.CFrame.LookVector * seat.ThrottleFloat * 52
        body.AssemblyLinearVelocity = Vector3.new(forward.X, body.AssemblyLinearVelocity.Y, forward.Z)
        body.AssemblyAngularVelocity = Vector3.new(0, -seat.SteerFloat * 1.7, 0)
        wheelAngle += seat.ThrottleFloat * dt * 12
    end

    for _, visual in visualWheels do
        visual.part.CFrame = body.CFrame
            * visual.offset
            * CFrame.Angles(0, 0, math.rad(90))
            * CFrame.Angles(0, wheelAngle, 0)
        visual.part:SetAttribute("ThrixelPivotVerified", true)
    end
end)

local checkpointPositions = {
    Vector3.new(0, 3, -78), Vector3.new(78, 3, -78),
    Vector3.new(78, 3, 78), Vector3.new(-78, 3, 78), Vector3.new(-78, 3, 0),
}
local activeIndex = 1
local checkpoint

local function moveCheckpoint()
    checkpoint.Position = checkpointPositions[activeIndex]
end

checkpoint = part("DeliveryCheckpoint", Vector3.new(12, 8, 12), CFrame.new(checkpointPositions[1]), Color3.fromRGB(53, 224, 177), Enum.Material.Neon)
checkpoint.Transparency = 0.35
checkpoint.CanCollide = false
checkpoint.Touched:Connect(function(hit)
    if not hit:IsDescendantOf(cart) then
        return
    end
    deliveries.Value += 1
    activeIndex = activeIndex % #checkpointPositions + 1
    moveCheckpoint()
end)

Players.PlayerAdded:Connect(function(player)
    player.CharacterAdded:Connect(function()
        task.wait(1)
        cart:PivotTo(CFrame.new(0, 4, 14))
    end)
end)
