local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local state = ReplicatedStorage:WaitForChild("GameState")

local gui = Instance.new("ScreenGui")
gui.Name = "OrreryLockHUD"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local loading = Instance.new("Frame")
loading.Name = "LoadingCover"
loading.Size = UDim2.fromScale(1, 1)
loading.BackgroundColor3 = Color3.fromRGB(6, 12, 28)
loading.BorderSizePixel = 0
loading.ZIndex = 100
loading.Parent = gui

local loadingText = Instance.new("TextLabel")
loadingText.AnchorPoint = Vector2.new(0.5, 0.5)
loadingText.Position = UDim2.fromScale(0.5, 0.5)
loadingText.Size = UDim2.fromOffset(520, 90)
loadingText.BackgroundTransparency = 1
loadingText.Font = Enum.Font.GothamBold
loadingText.Text = "CALIBRATING THE OBSERVATORY…"
loadingText.TextColor3 = Color3.fromRGB(213, 171, 84)
loadingText.TextScaled = true
loadingText.ZIndex = 101
loadingText.Parent = loading

local function refreshLoading()
	loading.Visible = workspace:GetAttribute("BuildReady") ~= true
end

workspace:GetAttributeChangedSignal("BuildReady"):Connect(refreshLoading)
refreshLoading()

local panel = Instance.new("Frame")
panel.AnchorPoint = Vector2.new(0.5, 0)
panel.Position = UDim2.fromScale(0.5, 0.04)
panel.Size = UDim2.fromOffset(440, 92)
panel.BackgroundColor3 = Color3.fromRGB(10, 16, 32)
panel.BackgroundTransparency = 0.12
panel.BorderSizePixel = 0
panel.Parent = gui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 16)
corner.Parent = panel

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -28, 0, 34)
title.Position = UDim2.fromOffset(14, 8)
title.BackgroundTransparency = 1
title.Font = Enum.Font.GothamBold
title.Text = "ORRERY LOCK"
title.TextColor3 = Color3.fromRGB(213, 171, 84)
title.TextScaled = true
title.Parent = panel

local objective = Instance.new("TextLabel")
objective.Size = UDim2.new(1, -28, 0, 34)
objective.Position = UDim2.fromOffset(14, 47)
objective.BackgroundTransparency = 1
objective.Font = Enum.Font.GothamMedium
objective.TextColor3 = Color3.fromRGB(215, 241, 255)
objective.TextScaled = true
objective.TextWrapped = true
objective.Parent = panel

local function refresh()
	local collected = state:GetAttribute("CellsCollected") or 0
	local required = state:GetAttribute("RequiredCells") or 3
	local text = state:GetAttribute("Objective") or "Explore the observatory"
	objective.Text = `{text}  •  Cells {collected}/{required}`
end

state.AttributeChanged:Connect(refresh)
refresh()
