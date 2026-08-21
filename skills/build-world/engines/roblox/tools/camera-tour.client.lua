local CollectionService = game:GetService("CollectionService")
local ContextActionService = game:GetService("ContextActionService")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

-- Keep the published experience on Roblox's normal player camera. Evidence
-- capture opts in explicitly from Studio by setting this Workspace attribute.
if not RunService:IsStudio() or Workspace:GetAttribute("ThrixelEvidenceMode") ~= true then
    return
end

local expectedName = Workspace:FindFirstChild("delivery-cart-grouped")
    and "ThrixelDeliveryCart"
    or "ThrixelLighthouse"
local preferredTarget = Workspace:WaitForChild(expectedName, 5)
local targets = preferredTarget and {preferredTarget} or CollectionService:GetTagged("ThrixelAsset")
if #targets == 0 then
    for _, instance in Workspace:GetDescendants() do
        if instance:IsA("Model") then
            local normalizedName = string.lower(instance.Name)
            if normalizedName == "lighthouse-grouped"
                or normalizedName == "delivery-cart-grouped" then
                table.insert(targets, instance)
            end
        end
    end
end
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
local desiredCFrame

local function showView()
    local view = views[index]
    desiredCFrame = CFrame.lookAt(focus + view.offset, focus)
    print(string.format("THRIXEL_CAMERA_VIEW=%s", view.name))
end

showView()

RunService:BindToRenderStep("ThrixelCameraTour", Enum.RenderPriority.Last.Value, function()
    local activeCamera = Workspace.CurrentCamera
    activeCamera.CameraType = Enum.CameraType.Scriptable
    activeCamera.CFrame = desiredCFrame
end)

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
