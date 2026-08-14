#!/usr/bin/env python3
"""Validate a Goal to Game Roblox asset manifest using only the stdlib."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


MAX_MESH_TRIANGLES = 20_000
MAX_TEXTURE_SIZE = 4_096
ALLOWED_MAPS = {"color", "normal", "roughness", "metalness", "emissive"}


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_manifest(data: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["manifest must be a JSON object"]

    if data.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")

    scale = data.get("studsPerMeter")
    if not _number(scale) or scale <= 0:
        errors.append("studsPerMeter must be a positive number")

    assets = data.get("assets")
    if not isinstance(assets, list) or not assets:
        errors.append("assets must be a non-empty array")
        return errors

    asset_ids: set[str] = set()
    for asset_index, asset in enumerate(assets):
        prefix = f"assets[{asset_index}]"
        if not isinstance(asset, dict):
            errors.append(f"{prefix} must be an object")
            continue

        asset_id = asset.get("id")
        if not isinstance(asset_id, str) or not asset_id.strip():
            errors.append(f"{prefix}.id must be a non-empty string")
        elif asset_id in asset_ids:
            errors.append(f"{prefix}.id duplicates {asset_id!r}")
        else:
            asset_ids.add(asset_id)

        source = asset.get("source")
        if not isinstance(source, dict):
            errors.append(f"{prefix}.source must be an object")
        else:
            for key in ("submissionId", "file"):
                if not isinstance(source.get(key), str) or not source[key].strip():
                    errors.append(f"{prefix}.source.{key} must be a non-empty string")

        groups = asset.get("groups")
        if not isinstance(groups, list) or not groups:
            errors.append(f"{prefix}.groups must be a non-empty array")
            continue

        group_ids: set[str] = set()
        for group_index, group in enumerate(groups):
            group_prefix = f"{prefix}.groups[{group_index}]"
            if not isinstance(group, dict):
                errors.append(f"{group_prefix} must be an object")
                continue

            group_id = group.get("id")
            if not isinstance(group_id, str) or not group_id.strip():
                errors.append(f"{group_prefix}.id must be a non-empty string")
            elif group_id in group_ids:
                errors.append(f"{group_prefix}.id duplicates {group_id!r}")
            else:
                group_ids.add(group_id)

            triangles = group.get("triangles")
            if not isinstance(triangles, int) or isinstance(triangles, bool) or triangles < 0:
                errors.append(f"{group_prefix}.triangles must be a non-negative integer")
            elif triangles > MAX_MESH_TRIANGLES:
                errors.append(
                    f"{group_prefix}.triangles is {triangles}; Roblox limit is "
                    f"{MAX_MESH_TRIANGLES}"
                )

            if group.get("watertight") is not True:
                errors.append(f"{group_prefix}.watertight must be true")

            moving = group.get("moving", False)
            if not isinstance(moving, bool):
                errors.append(f"{group_prefix}.moving must be a boolean")
            if moving:
                pivot = group.get("pivot")
                if (
                    not isinstance(pivot, list)
                    or len(pivot) != 3
                    or not all(_number(value) for value in pivot)
                ):
                    errors.append(
                        f"{group_prefix}.pivot must contain three numbers for a moving group"
                    )

            appearance = group.get("appearance")
            if not isinstance(appearance, dict):
                errors.append(f"{group_prefix}.appearance must be an object")
                continue

            maps = appearance.get("maps")
            if not isinstance(maps, dict) or not maps:
                errors.append(f"{group_prefix}.appearance.maps must be a non-empty object")
                continue

            unknown_maps = sorted(set(maps) - ALLOWED_MAPS)
            if unknown_maps:
                errors.append(
                    f"{group_prefix}.appearance.maps has unsupported maps: "
                    + ", ".join(unknown_maps)
                )

            for map_name, texture in maps.items():
                texture_prefix = f"{group_prefix}.appearance.maps.{map_name}"
                if not isinstance(texture, dict):
                    errors.append(f"{texture_prefix} must be an object")
                    continue
                if not isinstance(texture.get("file"), str) or not texture["file"].strip():
                    errors.append(f"{texture_prefix}.file must be a non-empty string")
                size = texture.get("size")
                if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
                    errors.append(f"{texture_prefix}.size must be a positive integer")
                elif size > MAX_TEXTURE_SIZE:
                    errors.append(
                        f"{texture_prefix}.size is {size}; Roblox limit is {MAX_TEXTURE_SIZE}"
                    )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    try:
        data = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    errors = validate_manifest(data)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"OK: {args.manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
