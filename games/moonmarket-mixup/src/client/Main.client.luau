local Players = game:GetService("Players")
local ContextActionService = game:GetService("ContextActionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local state = ReplicatedStorage:WaitForChild("GameState")

local arrowState: { [string]: boolean } = {
	Left = false,
	Right = false,
	Up = false,
	Down = false,
}

local arrowForKey: { [Enum.KeyCode]: string } = {
	[Enum.KeyCode.Left] = "Left",
	[Enum.KeyCode.Right] = "Right",
	[Enum.KeyCode.Up] = "Up",
	[Enum.KeyCode.Down] = "Down",
}

local function handleArrowMovement(_actionName: string, inputState: Enum.UserInputState, input: InputObject)
	local arrow = arrowForKey[input.KeyCode]
	if arrow then
		arrowState[arrow] = inputState == Enum.UserInputState.Begin or inputState == Enum.UserInputState.Change
	end
	return Enum.ContextActionResult.Sink
end

ContextActionService:BindActionAtPriority(
	"MoonmarketArrowMovement",
	handleArrowMovement,
	false,
	Enum.ContextActionPriority.High.Value + 1,
	Enum.KeyCode.Left,
	Enum.KeyCode.Right,
	Enum.KeyCode.Up,
	Enum.KeyCode.Down
)

RunService:BindToRenderStep("MoonmarketArrowMotion", Enum.RenderPriority.Input.Value + 2, function()
	local horizontal = (arrowState.Right and 1 or 0) - (arrowState.Left and 1 or 0)
	local vertical = (arrowState.Up and 1 or 0) - (arrowState.Down and 1 or 0)
	if horizontal == 0 and vertical == 0 then
		return
	end

	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end

	camera = workspace.CurrentCamera
	local right = Vector3.new(camera.CFrame.RightVector.X, 0, camera.CFrame.RightVector.Z).Unit
	local forward = Vector3.new(camera.CFrame.LookVector.X, 0, camera.CFrame.LookVector.Z).Unit
	local direction = right * horizontal + forward * vertical
	if direction.Magnitude > 0 then
		humanoid:Move(direction.Unit, false)
	end
end)

RunService:BindToRenderStep("MoonmarketCamera", Enum.RenderPriority.Camera.Value + 1, function()
	camera = workspace.CurrentCamera
	local focus = Vector3.new(0, 2, 0)
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = 50
	camera.CFrame = CFrame.lookAt(Vector3.new(38, 65, 50), focus)
	camera.Focus = CFrame.new(focus)
end)

local gui = Instance.new("ScreenGui")
gui.Name = "MoonmarketHUD"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local loading = Instance.new("Frame")
loading.Name = "LoadingCover"
loading.Size = UDim2.fromScale(1, 1)
loading.BackgroundColor3 = Color3.fromRGB(14, 8, 24)
loading.BorderSizePixel = 0
loading.ZIndex = 100
loading.Parent = gui

local loadingText = Instance.new("TextLabel")
loadingText.AnchorPoint = Vector2.new(0.5, 0.5)
loadingText.Position = UDim2.fromScale(0.5, 0.5)
loadingText.Size = UDim2.fromOffset(520, 90)
loadingText.BackgroundTransparency = 1
loadingText.Font = Enum.Font.GothamBold
loadingText.Text = "OPENING THE MOONMARKET…"
loadingText.TextColor3 = Color3.fromRGB(255, 220, 145)
loadingText.TextScaled = true
loadingText.ZIndex = 101
loadingText.Parent = loading

local function refreshLoading()
	loading.Visible = workspace:GetAttribute("BuildReady") ~= true
end

workspace:GetAttributeChangedSignal("BuildReady"):Connect(refreshLoading)
refreshLoading()

local panel = Instance.new("Frame")
panel.Position = UDim2.fromOffset(20, 20)
panel.Size = UDim2.fromOffset(470, 235)
panel.BackgroundColor3 = Color3.fromRGB(35, 17, 54)
panel.BackgroundTransparency = 0.08
panel.BorderSizePixel = 0
panel.Parent = gui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 18)
corner.Parent = panel

local label = Instance.new("TextLabel")
label.Size = UDim2.new(1, -28, 1, -24)
label.Position = UDim2.fromOffset(14, 12)
label.BackgroundTransparency = 1
label.Font = Enum.Font.GothamBold
label.TextColor3 = Color3.fromRGB(255, 220, 145)
label.TextScaled = true
label.TextWrapped = true
label.TextXAlignment = Enum.TextXAlignment.Left
label.Parent = panel

local function refresh()
	local seconds = state:GetAttribute("SecondsLeft") or 0
	local order = player:GetAttribute("Order") or "Waiting for the next round"
	local inventory = player:GetAttribute("Inventory") or ""
	local score = player:GetAttribute("Score") or 0
	local roundBrews = player:GetAttribute("RoundBrews") or 0
	local targetBrews = state:GetAttribute("TargetBrews") or 2
	local status = state:GetAttribute("Status") or "Market open"
	local result = player:GetAttribute("LastResult") or "Collect the current recipe"
	label.Text = `MOONMARKET  •  {seconds}s  •  Score {score}  •  Brews {roundBrews}/{targetBrews}\n{status}\nYour recipe: {order}\nCollect every listed item, then press E at the center cauldron to brew.\n{result}\nBag: {inventory}`
end

state.AttributeChanged:Connect(refresh)
player.AttributeChanged:Connect(refresh)
refresh()
