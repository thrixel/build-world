local CaptureService = game:GetService("CaptureService")
local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

if not RunService:IsStudio() then
	return
end

local folder = workspace:WaitForChild("GoalToGameShots", 10)
if not folder then
	warn("[GOAL_TO_GAME_SHOTS] missing Workspace.GoalToGameShots")
	return
end

local shots = {}
for _, child in folder:GetChildren() do
	if child:IsA("CFrameValue") then
		table.insert(shots, child)
	end
end
table.sort(shots, function(a, b)
	return a.Name < b.Name
end)
if #shots == 0 then
	warn("[GOAL_TO_GAME_SHOTS] no CFrameValue shots")
	return
end

local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")
local gui = Instance.new("ScreenGui")
gui.Name = "GoalToGameShotHarness"
gui.ResetOnSpawn = false
gui.DisplayOrder = 1000
gui.Parent = playerGui

local label = Instance.new("TextLabel")
label.Size = UDim2.fromOffset(500, 44)
label.Position = UDim2.fromOffset(16, 16)
label.BackgroundColor3 = Color3.fromRGB(8, 12, 22)
label.BackgroundTransparency = 0.15
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui

local preview = Instance.new("ImageLabel")
preview.Size = UDim2.fromScale(1, 1)
preview.BackgroundColor3 = Color3.new(0, 0, 0)
preview.ScaleType = Enum.ScaleType.Fit
preview.Visible = false
preview.ZIndex = 10
preview.Parent = gui

local index = 1
local function showShot(nextIndex: number)
	index = ((nextIndex - 1) % #shots) + 1
	local shot = shots[index]
	local camera = workspace.CurrentCamera
	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = shot.Value
	label.Text = `{index}/{#shots}  {shot.Name}   [ / ] navigate   P preview capture   C clear`
	workspace:SetAttribute("GoalToGameCurrentShot", shot.Name)
	print(`[GOAL_TO_GAME_SHOT] {shot.Name}`)
end

local function onAction(action: string, state: Enum.UserInputState)
	if state ~= Enum.UserInputState.Begin then
		return Enum.ContextActionResult.Sink
	end
	if action == "GoalToGamePrevious" then
		showShot(index - 1)
	elseif action == "GoalToGameNext" then
		showShot(index + 1)
	elseif action == "GoalToGameCapture" then
		CaptureService:CaptureScreenshot(function(contentId)
			preview.Image = contentId
			preview.Visible = true
		end)
	elseif action == "GoalToGameClear" then
		preview.Visible = false
	end
	return Enum.ContextActionResult.Sink
end

ContextActionService:BindAction("GoalToGamePrevious", onAction, false, Enum.KeyCode.LeftBracket)
ContextActionService:BindAction("GoalToGameNext", onAction, false, Enum.KeyCode.RightBracket)
ContextActionService:BindAction("GoalToGameCapture", onAction, false, Enum.KeyCode.P)
ContextActionService:BindAction("GoalToGameClear", onAction, false, Enum.KeyCode.C)
showShot(1)
