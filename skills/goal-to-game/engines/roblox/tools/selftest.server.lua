-- selftest.server.lua
--
-- In-Studio self-test for the Roblox path. Run this as a Script in
-- ServerScriptService (Rojo: `ServerScriptService/selftest.server.lua`), or
-- paste it into the Studio command bar and execute. It walks every MeshPart
-- in the Workspace and reports the import-boundary violations that survive
-- after import — the ones a screenshot cannot always show.
--
-- What it checks (all of which Roblox actually exposes at runtime):
--   1. non-empty, valid MeshId          (a part with no mesh is a mistake)
--   2. non-zero thickness               (a near-flat MeshPart is a thin sheet)
--   3. has a SurfaceAppearance/Texture  (otherwise it renders default grey)
--   4. anchored or welded to the world  (otherwise it falls on play)
--   5. orientation sanity               (a part rotated ~90° off its
--                                         neighbours is likely axis-flipped)
--
-- Output goes to the Output window (View -> Output). A failing check prints
-- `[SELFTEST FAIL]`; a clean run prints one summary line.

local Workspace = game:GetService("Workspace")

local MIN_THICKNESS = 0.01  -- studs; a part thinner than this is a sheet
local ORIENTATION_TOLERANCE_DEG = 45  -- flag parts tilted this far off axis

local failures = 0
local checked = 0

local function nearZero(v)
	return math.abs(v) < MIN_THICKNESS
end

local function checkMeshPart(part)
	checked = checked + 1
	local issues = {}

	-- 1. MeshId validity
	local meshId = tostring(part.MeshId or "")
	if meshId == "" or meshId == "rbxassetid://0" then
		table.insert(issues, "empty MeshId (no mesh assigned)")
	end

	-- 2. Non-zero thickness (thin-sheet check)
	local size = part.Size
	if nearZero(size.X) or nearZero(size.Y) or nearZero(size.Z) then
		table.insert(issues, string.format(
			"near-zero thickness (%.4f x %.4f x %.4f studs)",
			size.X, size.Y, size.Z))
	end

	-- 3. Has an appearance (otherwise renders default grey)
	if not part:FindFirstChildOfClass("SurfaceAppearance")
		and not part:FindFirstChildOfClass("Texture")
		and not part:FindFirstChildWhichIsA("SpecialMesh") then
		table.insert(issues, "no SurfaceAppearance/Texture (renders default grey)")
	end

	-- 4. Anchored (a non-anchored prop falls through the ground on play)
	if not part.Anchored then
		local welded = false
		for _, j in ipairs(part:GetJoints()) do
			welded = true
			break
		end
		if not welded then
			table.insert(issues, "not anchored or welded (falls on play)")
		end
	end

	-- 5. Orientation sanity: flag parts rotated far off the world axis grid.
	--    Thrixel's forward axis varies per asset; a part at a ~90 deg tilt was
	--    almost certainly imported with the wrong forward axis.
	local rx, ry, rz = part.Orientation.X, part.Orientation.Y, part.Orientation.Z
	local function offAxis(deg)
		deg = math.abs(deg) % 180
		if deg > 180 - ORIENTATION_TOLERANCE_DEG then deg = 180 - deg end
		return deg > ORIENTATION_TOLERANCE_DEG and deg < 180 - ORIENTATION_TOLERANCE_DEG
	end
	if offAxis(rx) or offAxis(ry) or offAxis(rz) then
		table.insert(issues, string.format(
			"tilted off axis (%.0f, %.0f, %.0f) — verify forward axis",
			rx, ry, rz))
	end

	if #issues > 0 then
		failures = failures + 1
		warn("[SELFTEST FAIL] " .. part:GetFullName())
		for _, msg in ipairs(issues) do
			warn("    - " .. msg)
		end
	end
end

local function walk(instance)
	for _, child in ipairs(instance:GetChildren()) do
		if child:IsA("MeshPart") then
			checkMeshPart(child)
		end
		walk(child)
	end
end

walk(Workspace)

if failures == 0 then
	print(string.format("[SELFTEST PASS] %d MeshParts checked, 0 violations.", checked))
else
	warn(string.format("[SELFTEST FAIL] %d violation(s) across %d MeshParts.", failures, checked))
end
