-- Copy into src/client. F8 runs named review cameras; F9 restarts the frame-time sample.
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local REQUIRED_SHOTS = {
	"Establishing",
	"PlayerScale",
	"HeroClose",
	"MovingPart",
	"Collision",
	"LightingDark",
	"Gameplay",
}
local SETTLE_SECONDS = 1.5
local HOLD_SECONDS = 2.5
local sampling = true
local frameTimes = {}

RunService.RenderStepped:Connect(function(delta)
	if sampling then
		table.insert(frameTimes, delta * 1000)
	end
end)

local function percentile(values, fraction)
	if #values == 0 then
		return 0
	end
	local copy = table.clone(values)
	table.sort(copy)
	local index = math.clamp(math.ceil(#copy * fraction), 1, #copy)
	return copy[index]
end

local function printPerformance()
	local result = {
		frames = #frameTimes,
		p50Ms = percentile(frameTimes, 0.50),
		p95Ms = percentile(frameTimes, 0.95),
		worstMs = percentile(frameTimes, 1.0),
	}
	result.pass = result.frames >= 1800 and result.p95Ms <= 33.3 and result.worstMs <= 100
	print("THRIXEL_PERF_JSON=" .. HttpService:JSONEncode(result))
end

local function makeLabel()
	local player = game:GetService("Players").LocalPlayer
	local gui = Instance.new("ScreenGui")
	gui.Name = "ThrixelCameraTour"
	gui.ResetOnSpawn = false
	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0.5, 0)
	label.Position = UDim2.fromScale(0.5, 0.02)
	label.Size = UDim2.fromOffset(360, 44)
	label.BackgroundColor3 = Color3.fromRGB(8, 15, 28)
	label.BackgroundTransparency = 0.12
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Font = Enum.Font.GothamBold
	label.TextSize = 16
	label.Parent = gui
	gui.Parent = player:WaitForChild("PlayerGui")
	return gui, label
end

local running = false
local function runTour()
	if running then
		return
	end
	running = true
	local shots = Workspace:FindFirstChild("ReviewShots")
	if not shots then
		warn("THRIXEL_CAMERA_TOUR: Workspace/ReviewShots is missing")
		running = false
		return
	end
	local camera = Workspace.CurrentCamera
	local priorType = camera.CameraType
	local priorSubject = camera.CameraSubject
	local gui, label = makeLabel()
	camera.CameraType = Enum.CameraType.Scriptable
	for index, name in REQUIRED_SHOTS do
		local marker = shots:FindFirstChild(name)
		if not marker or not marker:IsA("BasePart") then
			warn("THRIXEL_CAMERA_TOUR: missing shot " .. name)
			continue
		end
		camera.CFrame = marker.CFrame
		label.Text = string.format("SHOT %02d/%02d — %s", index, #REQUIRED_SHOTS, name)
		task.wait(SETTLE_SECONDS)
		print("THRIXEL_SHOT_READY=" .. name)
		task.wait(HOLD_SECONDS)
	end
	gui:Destroy()
	camera.CameraType = priorType
	camera.CameraSubject = priorSubject
	running = false
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.F8 then
		task.spawn(runTour)
	elseif input.KeyCode == Enum.KeyCode.F9 then
		printPerformance()
		frameTimes = {}
		sampling = true
	end
end)

task.delay(60, printPerformance)
