local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

if not RunService:IsStudio() then
	return
end

local errors = {}
local warnings = {}
local assetCount = 0
local meshCount = 0

local function add(target: { string }, message: string)
	table.insert(target, message)
end

local function finite(value: number): boolean
	return value == value and value > -math.huge and value < math.huge
end

for _, root in CollectionService:GetTagged("ThrixelAsset") do
	assetCount += 1
	local rootMeshes = 0
	for _, descendant in root:GetDescendants() do
		if descendant:IsA("MeshPart") then
			rootMeshes += 1
			meshCount += 1
			if descendant.MeshId == "" then
				add(errors, `{descendant:GetFullName()}: empty MeshId`)
			end
			local size = descendant.Size
			if not finite(size.X) or not finite(size.Y) or not finite(size.Z) or size.X <= 0 or size.Y <= 0 or size.Z <= 0 then
				add(errors, `{descendant:GetFullName()}: invalid Size {size}`)
			end
			if not descendant.Anchored and not descendant:GetAttribute("AllowUnanchored") then
				add(errors, `{descendant:GetFullName()}: rigid imported mesh is not anchored`)
			end
		end
	end
	if rootMeshes == 0 then
		add(errors, `{root:GetFullName()}: tagged asset contains no MeshParts`)
	end
end

for _, moving in CollectionService:GetTagged("ThrixelMovingPart") do
	local pivot = if moving:IsA("Model") then moving:GetPivot() else (moving :: BasePart).CFrame
	local boxCFrame, boxSize
	if moving:IsA("Model") then
		boxCFrame, boxSize = moving:GetBoundingBox()
	elseif moving:IsA("BasePart") then
		boxCFrame, boxSize = moving.CFrame, moving.Size
	else
		add(errors, `{moving:GetFullName()}: moving tag must be on Model or BasePart`)
		continue
	end
	local tolerance = math.max(boxSize.Magnitude * 0.35, 1)
	if (pivot.Position - boxCFrame.Position).Magnitude > tolerance and not moving:GetAttribute("AllowOffsetPivot") then
		add(errors, `{moving:GetFullName()}: pivot is far from its own bounds; set AllowOffsetPivot only for an intentional hinge`)
	end
	for _, descendant in moving:GetDescendants() do
		if descendant:IsA("MeshPart") and descendant.CollisionFidelity == Enum.CollisionFidelity.PreciseConvexDecomposition then
			add(warnings, `{descendant:GetFullName()}: moving visual uses PreciseConvexDecomposition`)
		end
	end
end

if assetCount == 0 then
	add(errors, "no instances tagged ThrixelAsset")
end

local report = {
	schemaVersion = 1,
	passed = #errors == 0,
	assetCount = assetCount,
	meshCount = meshCount,
	errors = errors,
	warnings = warnings,
}
local encoded = HttpService:JSONEncode(report)
local value = ReplicatedStorage:FindFirstChild("GoalToGameReport") or Instance.new("StringValue")
value.Name = "GoalToGameReport"
value.Value = encoded
value:SetAttribute("Passed", report.passed)
value.Parent = ReplicatedStorage
print(`[GOAL_TO_GAME_REPORT] {encoded}`)
