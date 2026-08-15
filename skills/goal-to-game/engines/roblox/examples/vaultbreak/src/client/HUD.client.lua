local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local gui = Instance.new("ScreenGui")
gui.Name = "VaultbreakHUD"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local label = Instance.new("TextLabel")
label.Position = UDim2.fromOffset(24, 24)
label.Size = UDim2.fromOffset(390, 92)
label.BackgroundColor3 = Color3.fromRGB(12, 18, 27)
label.BackgroundTransparency = 0.1
label.TextColor3 = Color3.fromRGB(232, 242, 249)
label.Font = Enum.Font.GothamBold
label.TextSize = 17
label.TextXAlignment = Enum.TextXAlignment.Left
label.TextYAlignment = Enum.TextYAlignment.Top
label.TextWrapped = true
label.Parent = gui

local currentMessage = "Entering the museum…"
ReplicatedStorage:WaitForChild("VaultbreakEvents"):WaitForChild("State").OnClientEvent:Connect(function(state)
	if state.message then
		currentMessage = state.message
	end
	local alarm = math.floor((state.alarm or 0) / 2.4 * 100)
	label.Text = string.format("  VAULTBREAK   %03ds\n  FUSE KEYS  %d/%d    ALARM %d%%\n  %s", state.timeLeft, state.fuses, state.required, alarm, currentMessage)
	label.BackgroundColor3 = state.won and Color3.fromRGB(18, 105, 70) or (alarm > 65 and Color3.fromRGB(135, 35, 45) or Color3.fromRGB(12, 18, 27))
end)

local camera = workspace.CurrentCamera
RunService:BindToRenderStep("VaultbreakCamera", Enum.RenderPriority.Camera.Value + 1, function()
	if player.PlayerGui:FindFirstChild("ThrixelCameraTour") then
		return
	end
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root then
		camera.CameraType = Enum.CameraType.Scriptable
		camera.CFrame = CFrame.new(root.Position + Vector3.new(0, 28, 22), root.Position)
	end
end)
