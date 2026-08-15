-- Deterministic Studio-side validation for imported Thrixel assets.
-- Tag imported roots with "ThrixelAsset" and moving parts with "ThrixelMovingPart".

local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")

task.wait(1)

local failures = {}
local warnings = {}
local stats = {
	assets = 0,
	instances = 0,
	meshParts = 0,
	movingParts = 0,
	surfaceAppearances = 0,
}

local function add(list, code, instance, message)
	table.insert(list, {
		code = code,
		path = instance and instance:GetFullName() or "Workspace",
		message = message,
	})
end

local function hasAssetAncestor(instance, roots)
	local current = instance
	while current and current ~= Workspace do
		if roots[current] then
			return true
		end
		current = current.Parent
	end
	return false
end

local roots = {}
local function addRoot(root)
	if root:IsA("Model") and root:IsDescendantOf(Workspace) and not roots[root] then
		roots[root] = true
		stats.assets += 1
	end
end

for _, root in CollectionService:GetTagged("ThrixelAsset") do
	addRoot(root)
end

for _, instance in Workspace:GetDescendants() do
	if instance:IsA("Model") then
		local normalizedName = string.lower(instance.Name)
		if instance:GetAttribute("ThrixelAsset") == true
			or normalizedName == "lighthouse-grouped"
			or normalizedName == "delivery-cart-grouped" then
			addRoot(instance)
		end
	end
end

if stats.assets == 0 then
	add(failures, "NO_TAGGED_ASSETS", Workspace,
		"Tag every imported Thrixel model root with CollectionService tag ThrixelAsset")
end

for _, instance in Workspace:GetDescendants() do
	stats.instances += 1
	if instance:IsA("MeshPart") and hasAssetAncestor(instance, roots) then
		stats.meshParts += 1

		if instance.MeshId == "" then
			add(failures, "EMPTY_MESH_ID", instance, "MeshId is empty")
		end
		if instance.Size.X <= 0.01 or instance.Size.Y <= 0.01 or instance.Size.Z <= 0.01 then
			add(failures, "ZERO_THICKNESS", instance, "One or more dimensions are at or below 0.01 studs")
		end
		if not instance.Anchored and not CollectionService:HasTag(instance, "ThrixelMovingPart") then
			add(warnings, "UNANCHORED_STATIC", instance,
				"Static imported parts should be anchored or intentionally constrained")
		end

		local appearance = instance:FindFirstChildOfClass("SurfaceAppearance")
		if appearance then
			stats.surfaceAppearances += 1
			if appearance.ColorMap == "" then
				add(warnings, "EMPTY_COLOR_MAP", appearance, "SurfaceAppearance has no ColorMap")
			end
		end

		if CollectionService:HasTag(instance, "ThrixelMovingPart") then
			stats.movingParts += 1
			if instance:GetAttribute("ThrixelPivotVerified") ~= true then
				add(failures, "PIVOT_NOT_VERIFIED", instance,
					"Set ThrixelPivotVerified=true only after exercising the part around its intended axis")
			end
			if instance.CollisionFidelity == Enum.CollisionFidelity.PreciseConvexDecomposition then
				add(warnings, "EXPENSIVE_MOVING_COLLISION", instance,
					"Use Box or Hull collision for moving gameplay pieces unless precise collision is required")
			end
		end
	end
end

if stats.meshParts == 0 then
	add(failures, "NO_MESH_PARTS", Workspace, "No MeshParts were found below tagged Thrixel assets")
end

local result = {
	schemaVersion = 1,
	passed = #failures == 0,
	placeId = game.PlaceId,
	jobId = game.JobId,
	stats = stats,
	failures = failures,
	warnings = warnings,
}

print("THRIXEL_SELFTEST_JSON=" .. HttpService:JSONEncode(result))
if not result.passed then
	error(string.format("Thrixel self-test failed with %d error(s)", #failures))
end
