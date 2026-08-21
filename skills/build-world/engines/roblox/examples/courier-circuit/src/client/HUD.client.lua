local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local deliveries = ReplicatedStorage:WaitForChild("CourierState"):WaitForChild("Deliveries")
local gui = Instance.new("ScreenGui")
gui.Name = "CourierHUD"
gui.ResetOnSpawn = false
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.fromScale(0.5, 0.04)
label.Size = UDim2.fromOffset(390, 62)
label.BackgroundColor3 = Color3.fromRGB(18, 24, 31)
label.BackgroundTransparency = 0.12
label.TextColor3 = Color3.fromRGB(238, 245, 252)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui

local function update()
    label.Text = string.format("DELIVERIES  %02d\nDrive through the green checkpoint", deliveries.Value)
end
deliveries.Changed:Connect(update)
update()
