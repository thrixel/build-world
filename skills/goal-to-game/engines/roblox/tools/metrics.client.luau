local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

if not RunService:IsStudio() then
	return
end

local samples = {}
local sampleSeconds = 15
local started = os.clock()
while os.clock() - started < sampleSeconds do
	table.insert(samples, RunService.RenderStepped:Wait())
end
table.sort(samples)

local function percentile(ratio: number): number
	local index = math.clamp(math.ceil(#samples * ratio), 1, #samples)
	return samples[index]
end

local partCount = 0
local meshCount = 0
for _, descendant in workspace:GetDescendants() do
	if descendant:IsA("BasePart") then
		partCount += 1
	end
	if descendant:IsA("MeshPart") then
		meshCount += 1
	end
end

local report = {
	schemaVersion = 1,
	sampleSeconds = sampleSeconds,
	frameCount = #samples,
	fpsP50 = 1 / percentile(0.50),
	fpsP95FrameTime = 1 / percentile(0.95),
	fpsP99FrameTime = 1 / percentile(0.99),
	worstFps = 1 / samples[#samples],
	basePartCount = partCount,
	meshPartCount = meshCount,
}
local encoded = HttpService:JSONEncode(report)
local value = ReplicatedStorage:FindFirstChild("GoalToGameMetrics") or Instance.new("StringValue")
value.Name = "GoalToGameMetrics"
value.Value = encoded
value.Parent = ReplicatedStorage
print(`[GOAL_TO_GAME_METRICS] {encoded}`)
