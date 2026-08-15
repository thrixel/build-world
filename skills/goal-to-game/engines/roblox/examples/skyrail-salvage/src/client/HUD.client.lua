local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local events = ReplicatedStorage:WaitForChild("SkyrailEvents")
local laneEvent = events:WaitForChild("Lane")
local stateEvent = events:WaitForChild("State")

local gui = Instance.new("ScreenGui")
gui.Name = "SkyrailHUD"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")
local label = Instance.new("TextLabel")
label.Position = UDim2.fromOffset(24, 24)
label.Size = UDim2.fromOffset(430, 86)
label.BackgroundColor3 = Color3.fromRGB(11, 28, 43)
label.BackgroundTransparency = 0.08
label.TextColor3 = Color3.fromRGB(240, 247, 250)
label.Font = Enum.Font.GothamBold
label.TextSize = 17
label.TextXAlignment = Enum.TextXAlignment.Left
label.TextYAlignment = Enum.TextYAlignment.Top
label.Parent = gui

local message = "Launching…"
local function move(actionName, inputState, _input)
	if inputState ~= Enum.UserInputState.Begin then
		return Enum.ContextActionResult.Pass
	end
	local direction = actionName == "SkyrailLeft" and -1 or 1
	laneEvent:FireServer(direction)
	return Enum.ContextActionResult.Sink
end
ContextActionService:BindAction("SkyrailLeft", move, true, Enum.KeyCode.A, Enum.KeyCode.Left, Enum.KeyCode.ButtonL1)
ContextActionService:SetTitle("SkyrailLeft", "◀")
ContextActionService:SetPosition("SkyrailLeft", UDim2.fromScale(0.08, 0.78))
ContextActionService:BindAction("SkyrailRight", move, true, Enum.KeyCode.D, Enum.KeyCode.Right, Enum.KeyCode.ButtonR1)
ContextActionService:SetTitle("SkyrailRight", "▶")
ContextActionService:SetPosition("SkyrailRight", UDim2.fromScale(0.2, 0.78))

stateEvent.OnClientEvent:Connect(function(state)
	if state.message then message = state.message end
	label.Text = string.format("  SKYRAIL SALVAGE    ROUTE %3d%%\n  CHARGE %d/%d    HULL %d/3    LANE %d\n  %s", math.floor(state.progress * 100), state.cogs, state.required, state.hull, state.lane, message)
	label.BackgroundColor3 = state.status == "won" and Color3.fromRGB(20, 112, 75) or (state.hull <= 1 and Color3.fromRGB(140, 42, 52) or Color3.fromRGB(11, 28, 43))
end)

local camera = workspace.CurrentCamera
RunService:BindToRenderStep("SkyrailCamera", Enum.RenderPriority.Camera.Value + 1, function()
	if player.PlayerGui:FindFirstChild("ThrixelCameraTour") then
		return
	end
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root then
		camera.CameraType = Enum.CameraType.Scriptable
		camera.CFrame = CFrame.new(root.Position + Vector3.new(18, 12, 24), root.Position + Vector3.new(0, 1, -14))
	end
end)
