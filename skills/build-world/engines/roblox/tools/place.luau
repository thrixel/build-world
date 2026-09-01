--!strict
--[[
	place — clone a Thrixel asset template, scale it to a real-world size, and
	set it down in the world. Copy this file to src/shared/Place.luau and
	`local place = require(ReplicatedStorage.Shared.Place)`.

	Scaling works by measuring: the clone's longest bounding-box axis is scaled
	to exactly targetStuds, so the FBX-vs-GLB arrival-size difference (FBX
	declares centimetres, GLB is read as 1 unit = 1 stud) never matters.

	place(template, x, z, rotationDeg, targetStuds, opts?) -> Model

	Args:
		template: Model to clone, typically ReplicatedStorage.Assets.<Name>.
		x, z: World position.
		rotationDeg: Yaw in degrees.
		targetStuds: Final length of the longest bounding-box axis.
		opts.groundY: Height to place at (default 0).
		opts.bottomCenter: true (default) puts the bounding-box bottom-centre
			at (x, groundY, z) — inserted Models pivot at their bbox centre, so
			this is what "sit it on the ground" needs. false places the model's
			own pivot there instead (vehicles with rigs, mount-point props).
		opts.parent: Parent for the clone, if given.

	Returns:
		The placed clone.
]]

export type PlaceOpts = {
	groundY: number?,
	bottomCenter: boolean?,
	parent: Instance?,
}

local function place(template: Model, x: number, z: number, rotationDeg: number, targetStuds: number, opts: PlaceOpts?): Model
	local o: PlaceOpts = opts or {}
	local groundY = o.groundY or 0
	local bottomCenter = if o.bottomCenter == nil then true else o.bottomCenter

	local model = template:Clone()
	local size = model:GetExtentsSize()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 1e-3 then
		model:ScaleTo(model:GetScale() * targetStuds / longest)
	end

	model:PivotTo(CFrame.Angles(0, math.rad(rotationDeg), 0))
	if bottomCenter then
		local cf, bbox = model:GetBoundingBox()
		local corr = Vector3.new(x - cf.X, groundY + bbox.Y / 2 - cf.Y, z - cf.Z)
		model:PivotTo(model:GetPivot() + corr)
	else
		local rot = model:GetPivot() - model:GetPivot().Position
		model:PivotTo(CFrame.new(x, groundY, z) * rot)
	end

	if o.parent then
		model.Parent = o.parent
	end
	return model
end

return place
