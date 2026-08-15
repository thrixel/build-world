#!/usr/bin/env python3
"""Validate end-to-end evidence for a Goal to Game Roblox submission."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


REQUIRED_VIEWS = {"front", "rear", "left", "right", "top", "gameplay"}
REQUIRED_PROFILES = {"desktop", "mobile"}


def _public_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if "replace-with" in value.casefold():
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def _recorded_value(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and "replace-with" not in value.casefold()
    )


def validate_submission(data: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["submission must be a JSON object"]
    if data.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    if not _recorded_value(data.get("studioVersion")):
        errors.append("studioVersion must be recorded")

    games = data.get("games")
    if not isinstance(games, list) or len(games) < 2:
        errors.append("games must contain at least two complete entries")
        return errors

    genres: set[str] = set()
    for index, game in enumerate(games):
        prefix = f"games[{index}]"
        if not isinstance(game, dict):
            errors.append(f"{prefix} must be an object")
            continue

        if not _recorded_value(game.get("name")):
            errors.append(f"{prefix}.name must be recorded")

        genre = game.get("genre")
        if not isinstance(genre, str) or not genre.strip():
            errors.append(f"{prefix}.genre must be recorded")
        else:
            genres.add(genre.strip().casefold())

        if not _public_url(game.get("publicUrl")):
            errors.append(f"{prefix}.publicUrl must be a public https URL")
        if not _public_url(game.get("videoUrl")):
            errors.append(f"{prefix}.videoUrl must be a public https URL")

        asset_ids = game.get("thrixelAssetIds")
        if not isinstance(asset_ids, list) or not asset_ids or not all(
            isinstance(value, str) and value.strip() for value in asset_ids
        ):
            errors.append(f"{prefix}.thrixelAssetIds must list at least one asset")

        if game.get("movingPartVerified") is not True:
            errors.append(f"{prefix}.movingPartVerified must be true")

        screenshots = game.get("screenshots")
        if not isinstance(screenshots, list):
            errors.append(f"{prefix}.screenshots must be an array")
        else:
            views: set[str] = set()
            duplicate_views: set[str] = set()
            for screenshot in screenshots:
                if not isinstance(screenshot, dict):
                    continue
                view = screenshot.get("view")
                file = screenshot.get("file")
                if not isinstance(view, str) or view not in REQUIRED_VIEWS:
                    continue
                if not _recorded_value(file):
                    errors.append(f"{prefix}.screenshots[{view}].file must be recorded")
                    continue
                if view in views:
                    duplicate_views.add(view)
                views.add(view)
            if duplicate_views:
                errors.append(
                    f"{prefix}.screenshots duplicate views: "
                    f"{', '.join(sorted(duplicate_views))}"
                )
            missing = sorted(REQUIRED_VIEWS - views)
            if missing:
                errors.append(f"{prefix}.screenshots missing views: {', '.join(missing)}")

        performance = game.get("performance")
        if not isinstance(performance, list):
            errors.append(f"{prefix}.performance must be an array")
        else:
            profiles: set[str] = set()
            duplicate_profiles: set[str] = set()
            for measurement in performance:
                if not isinstance(measurement, dict):
                    continue
                profile = measurement.get("profile")
                fps = measurement.get("fps")
                if isinstance(profile, str) and profile in REQUIRED_PROFILES:
                    if profile in profiles:
                        duplicate_profiles.add(profile)
                    profiles.add(profile)
                if (
                    not isinstance(fps, (int, float))
                    or isinstance(fps, bool)
                    or not math.isfinite(fps)
                    or fps < 30
                ):
                    errors.append(
                        f"{prefix}.performance requires at least 30 FPS for every profile"
                    )
            if duplicate_profiles:
                errors.append(
                    f"{prefix}.performance duplicate profiles: "
                    f"{', '.join(sorted(duplicate_profiles))}"
                )
            missing_profiles = sorted(REQUIRED_PROFILES - profiles)
            if missing_profiles:
                errors.append(
                    f"{prefix}.performance missing profiles: {', '.join(missing_profiles)}"
                )

    if len(genres) < 2:
        errors.append("the submission must contain at least two different genres")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.evidence.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    errors = validate_submission(data)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"OK: {args.evidence}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
