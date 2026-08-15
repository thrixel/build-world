#!/usr/bin/env python3
"""Validate the authored, pre-import side of a Roblox Thrixel asset manifest."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

AXES = {"+X", "-X", "+Y", "-Y", "+Z", "-Z"}
PURPOSES = {"hero", "repeated", "walkable", "decorative", "pickup", "obstacle"}


def validate(value: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if value.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    for field in ("assetId", "submissionId", "sourceFile", "purpose"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            errors.append(f"{field} must be a non-empty string")
    if value.get("purpose") not in PURPOSES:
        errors.append(f"purpose must be one of {sorted(PURPOSES)}")
    if value.get("format") != "glb":
        errors.append("format must be glb")
    if value.get("forwardAxis") not in AXES:
        errors.append(f"forwardAxis must be one of {sorted(AXES)}")
    bounds = value.get("targetBoundsStuds")
    if not isinstance(bounds, dict) or any(not isinstance(bounds.get(k), (int, float)) or bounds[k] <= 0 for k in ("x", "y", "z")):
        errors.append("targetBoundsStuds must contain positive x, y, and z numbers")
    groups = value.get("movingGroups")
    if not isinstance(groups, list):
        errors.append("movingGroups must be a list")
    else:
        names: set[str] = set()
        for index, group in enumerate(groups):
            if not isinstance(group, dict) or not str(group.get("name", "")).strip():
                errors.append(f"movingGroups[{index}].name is required")
                continue
            if group["name"] in names:
                errors.append(f"duplicate moving group {group['name']}")
            names.add(group["name"])
            if group.get("pivot") not in {"geometric-center", "explicit-mount"}:
                errors.append(f"movingGroups[{index}].pivot is invalid")
    budgets = value.get("budgets")
    if not isinstance(budgets, dict):
        errors.append("budgets object is required")
    else:
        triangles = budgets.get("maxTrianglesPerMesh")
        if not isinstance(triangles, int) or not 1 <= triangles <= 20_000:
            errors.append("budgets.maxTrianglesPerMesh must be an integer from 1 to 20000")
        instances = budgets.get("maxVisibleInstances")
        if not isinstance(instances, int) or instances < 1:
            errors.append("budgets.maxVisibleInstances must be a positive integer")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    try:
        value = json.loads(args.manifest.read_text(encoding="utf-8"))
        errors = validate(value)
    except (OSError, json.JSONDecodeError) as exc:
        errors = [str(exc)]
    result = {"ok": not errors, "errors": errors, "manifest": str(args.manifest)}
    print(json.dumps(result, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
