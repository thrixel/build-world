local CollectionService = game:GetService("CollectionService")
local ContextActionService = game:GetService("ContextActionService")
local Workspace = game:GetService("Workspace")

local camera = Workspace.CurrentCamera
local targets = CollectionService:GetTagged("ThrixelAsset")
table.sort(targets, function(a, b)
    return a:GetFullName() < b:GetFullName()
end)

assert(#targets > 0, "Camera tour requires a model tagged ThrixelAsset")

local target = targets[1]
assert(target:IsA("Model"), "ThrixelAsset camera target must be a Model")

local center, size = target:GetBoundingBox()
local radius = math.max(size.X, size.Y, size.Z) * 1.8
local focus = center.Position

local views = {
    {name = "front", offset = Vector3.new(0, size.Y * 0.15, radius)},
    {name = "rear", offset = Vector3.new(0, size.Y * 0.15, -radius)},
    {name = "left", offset = Vector3.new(-radius, size.Y * 0.15, 0)},
    {name = "right", offset = Vector3.new(radius, size.Y * 0.15, 0)},
    {name = "top", offset = Vector3.new(0, radius, 0.01)},
    {name = "gameplay", offset = Vector3.new(radius * 0.8, radius * 0.55, radius * 0.8)},
}

local index = 1

local function showView()
    local view = views[index]
    camera.CameraType = Enum.CameraType.Scriptable
    camera.CFrame = CFrame.lookAt(focus + view.offset, focus)
    print(string.format("THRIXEL_CAMERA_VIEW=%s", view.name))
end

local function cycle(_, state, input)
    if state ~= Enum.UserInputState.Begin then
        return Enum.ContextActionResult.Pass
    end

    local direction = input.KeyCode == Enum.KeyCode.LeftBracket and -1 or 1
    index = ((index - 1 + direction) % #views) + 1
    showView()
    return Enum.ContextActionResult.Sink
end

ContextActionService:BindAction(
    "ThrixelCameraTour",
    cycle,
    false,
    Enum.KeyCode.LeftBracket,
    Enum.KeyCode.RightBracket
)

showView()
