local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local SAMPLE_SECONDS = 10
local frameTimes = {}
local startedAt = os.clock()

local function percentile(values, ratio)
    local sorted = table.clone(values)
    table.sort(sorted)
    local index = math.clamp(math.ceil(#sorted * ratio), 1, #sorted)
    return sorted[index]
end

while os.clock() - startedAt < SAMPLE_SECONDS do
    local delta = RunService.RenderStepped:Wait()
    table.insert(frameTimes, delta)
end

local total = 0
for _, delta in frameTimes do
    total += delta
end

local averageDelta = total / #frameTimes
local profile = Workspace:GetAttribute("ThrixelPerformanceProfile")
if profile ~= "desktop" and profile ~= "mobile" then
    profile = UserInputService.TouchEnabled and "mobile" or "desktop"
end

local instances = Workspace:GetDescendants()
local meshPartCount = 0
for _, instance in instances do
    if instance:IsA("MeshPart") then
        meshPartCount += 1
    end
end

local result = {
    profile = profile,
    durationSeconds = SAMPLE_SECONDS,
    sampleCount = #frameTimes,
    averageFps = math.round((1 / averageDelta) * 10) / 10,
    minimumFps = math.round((1 / math.max(table.unpack(frameTimes))) * 10) / 10,
    p95FrameTimeMs = math.round(percentile(frameTimes, 0.95) * 10000) / 10,
    viewport = {
        width = Workspace.CurrentCamera.ViewportSize.X,
        height = Workspace.CurrentCamera.ViewportSize.Y,
    },
    instanceCount = #instances,
    meshPartCount = meshPartCount,
}

print("THRIXEL_PERFORMANCE_JSON=" .. HttpService:JSONEncode(result))
