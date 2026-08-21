local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local state = ReplicatedStorage:WaitForChild("StormwatchState")
local phase = state:WaitForChild("Phase")
local timeLeft = state:WaitForChild("TimeLeft")

local gui = Instance.new("ScreenGui")
gui.Name = "StormwatchHUD"
gui.ResetOnSpawn = false
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.fromScale(0.5, 0.04)
label.Size = UDim2.fromOffset(360, 58)
label.BackgroundColor3 = Color3.fromRGB(16, 23, 32)
label.BackgroundTransparency = 0.15
label.TextColor3 = Color3.fromRGB(245, 239, 214)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui

local function update()
    local instruction = phase.Value == "Storm" and "Stay inside the lighthouse glow" or "Explore before the storm"
    label.Text = string.format("%s  %ds\n%s", string.upper(phase.Value), timeLeft.Value, instruction)
end

phase.Changed:Connect(update)
timeLeft.Changed:Connect(update)
update()
