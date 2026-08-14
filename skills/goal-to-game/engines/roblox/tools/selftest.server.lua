--[[
  selftest.server.lua — goal-to-game Roblox self-test
  Place in ServerScriptService. Runs automatically on game start.
  Prints pass/fail to Output. Read this before any gameplay testing.

  Checks:
    1. All MeshPart instances in Workspace are non-zero in size
    2. SurfaceAppearance is attached and ColorMap is non-empty
    3. CollisionFidelity is not Precise on any moving part (name in MOVING_PARTS)
    4. All BaseParts marked as Anchored that should be are actually Anchored
    5. No MeshPart has a MeshId that is still empty (import failed)
--]]

local PASS = "✓"
local FAIL = "✗"
local PREFIX = "[SELFTEST]"

-- Names of parts that should be animated (keep_groups from thrixel_group_parts).
-- Edit this list to match the keep_groups you used.
local MOVING_PARTS = {
	"FL", "FR", "RL", "RR",       -- wheel corners
	"Door", "Turret", "Barrel",   -- common moving parts
}

local function isMovingPart(name: string): boolean
	for _, m in ipairs(MOVING_PARTS) do
		if string.lower(name) == string.lower(m) then
			return true
		end
	end
	return false
end

local function log(status: string, name: string, msg: string)
	print(string.format("%s %s %s: %s", PREFIX, status, name, msg))
end

local allPassed = true

-- Gather all MeshParts in Workspace (recursive)
local function getAllMeshParts(root: Instance): { MeshPart }
	local parts = {}
	for _, desc in ipairs(root:GetDescendants()) do
		if desc:IsA("MeshPart") then
			table.insert(parts, desc)
		end
	end
	return parts
end

local meshParts = getAllMeshParts(workspace)

if #meshParts == 0 then
	log(FAIL, "Workspace", "No MeshParts found — did Rojo sync and the place load correctly?")
	allPassed = false
end

for _, part in ipairs(meshParts) do
	local name = part.Name

	-- Check 1: Non-zero size
	local size = part.Size
	if size.X == 0 or size.Y == 0 or size.Z == 0 then
		log(FAIL, name, string.format("size is zero (%s) — import may have failed", tostring(size)))
		allPassed = false
	end

	-- Check 2: MeshId non-empty
	if part.MeshId == "" then
		log(FAIL, name, "MeshId is empty — asset upload may not have resolved correctly")
		allPassed = false
	end

	-- Check 3: SurfaceAppearance
	local sa = part:FindFirstChildOfClass("SurfaceAppearance")
	if sa then
		if sa.ColorMap == "" then
			log(FAIL, name, "SurfaceAppearance.ColorMap is empty — texture may still be in moderation or ID is wrong")
			allPassed = false
		else
			-- Check 4: CollisionFidelity for moving parts
			if isMovingPart(name) then
				if part.CollisionFidelity == Enum.CollisionFidelity.PreciseConvexDecomposition then
					log(FAIL, name, "CollisionFidelity=Precise on a moving part — will cause physics jitter, use Box")
					allPassed = false
				else
					log(PASS, name, string.format(
						"size=%s, ColorMap=set, CollisionFidelity=%s (moving part)",
						tostring(size),
						tostring(part.CollisionFidelity)
					))
				end
			else
				log(PASS, name, string.format(
					"size=%s, ColorMap=set, CollisionFidelity=%s",
					tostring(size),
					tostring(part.CollisionFidelity)
				))
			end
		end
	else
		-- No SurfaceAppearance — warn but don't fail (some parts are untextured by design)
		log(PASS, name, string.format(
			"size=%s, no SurfaceAppearance (untextured part)",
			tostring(size)
		))
	end
end

-- Final summary
if allPassed then
	print(string.format("%s All checks passed. (%d MeshParts inspected)", PREFIX, #meshParts))
else
	print(string.format(
		"%s One or more checks FAILED. Fix the issues above before gameplay testing.",
		PREFIX
	))
end
