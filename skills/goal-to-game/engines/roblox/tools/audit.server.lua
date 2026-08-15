-- Copy into src/server. Audits imported Thrixel assets once per Play session.
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local root = Workspace:FindFirstChild("ThrixelAssets")
local report = {
	ok = true,
	errors = {},
	warnings = {},
	assets = {},
}

local function addError(message)
	report.ok = false
	table.insert(report.errors, message)
end

local function finite(value)
	return value == value and value > -math.huge and value < math.huge
end

local function auditAsset(asset)
	local row = {
		assetId = asset.Name,
		meshParts = 0,
		surfaceAppearances = 0,
		movingGroups = {},
	}
	local meshes = {}
	for _, instance in asset:GetDescendants() do
		if instance:IsA("MeshPart") then
			table.insert(meshes, instance)
			row.meshParts += 1
			if instance.MeshId == "" then
				addError(asset.Name .. "/" .. instance.Name .. " has an empty MeshId")
			end
			if not finite(instance.Size.X) or not finite(instance.Size.Y) or not finite(instance.Size.Z)
				or instance.Size.X <= 0 or instance.Size.Y <= 0 or instance.Size.Z <= 0 then
				addError(asset.Name .. "/" .. instance.Name .. " has invalid size")
			end
			local appearances = 0
			for _, child in instance:GetChildren() do
				if child:IsA("SurfaceAppearance") then
					appearances += 1
				end
			end
			row.surfaceAppearances += appearances
			if appearances > 1 then
				addError(asset.Name .. "/" .. instance.Name .. " has multiple SurfaceAppearances")
			end
		end
	end
	if #meshes == 0 then
		addError(asset.Name .. " contains no MeshPart")
	end

	local expected = asset:GetAttribute("ThrixelExpectedMovingGroups")
	if typeof(expected) == "string" and expected ~= "" then
		for token in string.gmatch(expected, "[^,]+") do
			local name = string.gsub(token, "^%s*(.-)%s*$", "%1")
			local matches = 0
			for _, instance in asset:GetDescendants() do
				if string.find(string.lower(instance.Name), string.lower(name), 1, true) then
					matches += 1
				end
			end
			row.movingGroups[name] = matches
			if matches == 0 then
				addError(asset.Name .. " is missing moving group " .. name)
			end
		end
	end

	local target = asset:GetAttribute("ThrixelTargetLongestAxis")
	if typeof(target) == "number" and asset:IsA("Model") then
		local size = asset:GetExtentsSize()
		local actual = math.max(size.X, size.Y, size.Z)
		row.targetLongestAxis = target
		row.actualLongestAxis = actual
		if math.abs(actual - target) / target > 0.05 then
			addError(string.format("%s scale is %.2f studs; target is %.2f", asset.Name, actual, target))
		end
	end
	table.insert(report.assets, row)
end

if not root then
	addError("Workspace/ThrixelAssets is missing")
else
	for _, asset in root:GetChildren() do
		auditAsset(asset)
	end
	if #root:GetChildren() == 0 then
		addError("Workspace/ThrixelAssets is empty")
	end
end

local encoded = HttpService:JSONEncode(report)
print("THRIXEL_AUDIT_JSON=" .. encoded)

local function show(player)
	local gui = Instance.new("ScreenGui")
	gui.Name = "ThrixelAudit"
	gui.ResetOnSpawn = false
	local panel = Instance.new("TextLabel")
	panel.Name = "Status"
	panel.AnchorPoint = Vector2.new(1, 0)
	panel.Position = UDim2.fromScale(0.985, 0.02)
	panel.Size = UDim2.fromOffset(340, 48)
	panel.BackgroundColor3 = report.ok and Color3.fromRGB(20, 110, 72) or Color3.fromRGB(155, 45, 45)
	panel.BackgroundTransparency = 0.08
	panel.TextColor3 = Color3.new(1, 1, 1)
	panel.Font = Enum.Font.GothamBold
	panel.TextSize = 15
	panel.Text = report.ok and "THRIXEL AUDIT: PASS" or ("THRIXEL AUDIT: " .. #report.errors .. " ERROR(S)")
	panel.Parent = gui
	gui.Parent = player:WaitForChild("PlayerGui")
end

for _, player in Players:GetPlayers() do
	task.spawn(show, player)
end
Players.PlayerAdded:Connect(show)
