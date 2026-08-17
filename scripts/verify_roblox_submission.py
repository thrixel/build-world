#!/usr/bin/env python3
"""Run the portable, non-Studio checks for the Roblox issue #3 submission."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "skills/goal-to-game/engines/roblox/tools/validate_mesh.py"
VALIDATOR_TEST = VALIDATOR.with_name("test_validate_mesh.py")
MANIFESTS = (
    ROOT / "games/orrery-lock/assets.manifest.json",
    ROOT / "games/moonmarket-mixup/assets.manifest.json",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run(*args: str) -> None:
    print("+", " ".join(args))
    subprocess.run(args, cwd=ROOT, check=True)


def manifest_assets() -> list[tuple[dict, Path]]:
    resolved: list[tuple[dict, Path]] = []
    for manifest_path in MANIFESTS:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for asset in manifest.get("assets", []):
            source = (manifest_path.parent / asset.get("file", "")).resolve()
            resolved.append((asset, source))
    return resolved


def report_slug(asset_name: str) -> str:
    label = asset_name.removeprefix("Thrixel")
    descriptive = {
        "Lamp": "observatory-lamp",
        "Lantern": "hanging-lantern",
        "Stall": "market-stall",
    }
    if label in descriptive:
        return descriptive[label]
    return re.sub(r"(?<!^)(?=[A-Z])", "-", label).lower()


def check_json() -> None:
    paths = sorted(path for path in ROOT.rglob("*.json") if ".git" not in path.parts)
    for path in paths:
        json.loads(path.read_text(encoding="utf-8"))
    print(f"JSON: {len(paths)} files parsed")


def check_asset_hashes() -> None:
    checksum_file = ROOT / "thrixel_assets/checksums.sha256"
    checked: set[str] = set()
    for line in checksum_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        expected, relative = line.split(maxsplit=1)
        asset = checksum_file.parent / relative.strip().lstrip("*")
        require(asset.is_file(), f"checksum target is missing: {asset.relative_to(ROOT)}")
        actual = hashlib.sha256(asset.read_bytes()).hexdigest()
        require(actual == expected, f"checksum mismatch: {asset.relative_to(ROOT)}")
        checked.add(asset.relative_to(checksum_file.parent).as_posix())
    accepted = {
        source.relative_to(checksum_file.parent).as_posix()
        for _, source in manifest_assets()
    }
    require(checked == accepted, "checksums must cover exactly the manifest's accepted assets")
    require(len(checked) == 15, f"expected 15 accepted source assets, found {len(checked)}")
    print(f"Assets: {len(checked)} SHA-256 checks passed")


def check_game_manifests() -> None:
    submission_ids: set[str] = set()
    for manifest_path in MANIFESTS:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        require(manifest.get("projectId"), f"missing projectId: {manifest_path.relative_to(ROOT)}")
        require(manifest.get("assets"), f"empty asset list: {manifest_path.relative_to(ROOT)}")
        for asset in manifest["assets"]:
            require(asset.get("name"), f"asset has no name: {manifest_path.relative_to(ROOT)}")
            submission_id = asset.get("submissionId")
            require(submission_id, f"asset has no submissionId: {asset.get('name')}")
            require(submission_id not in submission_ids, f"duplicate submissionId: {submission_id}")
            submission_ids.add(submission_id)
            source = (manifest_path.parent / asset.get("file", "")).resolve()
            require(source.is_file(), f"manifest source is missing: {source}")
    require(len(submission_ids) == 15, f"expected 15 unique submission IDs, found {len(submission_ids)}")
    print("Manifests: two games and 15 unique source assets resolve")


def check_markdown_links() -> None:
    missing: list[str] = []
    pattern = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
    for document in sorted(ROOT.rglob("*.md")):
        if ".git" in document.parts:
            continue
        for raw_target in pattern.findall(document.read_text(encoding="utf-8")):
            target = raw_target.strip().split("#", 1)[0]
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            resolved = (document.parent / target).resolve()
            # Required videos have their own nonempty-file gate so a pending capture does
            # not mask earlier repository, build, or geometry results as a link failure.
            if "evidence/videos" in resolved.as_posix():
                continue
            if not resolved.exists():
                missing.append(f"{document.relative_to(ROOT)} -> {target}")
    require(not missing, "broken relative Markdown links:\n" + "\n".join(missing))
    print("Markdown: relative links resolve")


def check_submission_state() -> None:
    checklist = (ROOT / "docs/bounty-acceptance.md").read_text(encoding="utf-8")
    require("- [ ]" not in checklist, "acceptance checklist still has an unchecked item")
    for relative in (
        "evidence/videos/orrery-lock.mp4",
        "evidence/videos/moonmarket-mix-up.mp4",
    ):
        media = ROOT / relative
        require(media.is_file() and media.stat().st_size > 0, f"missing media: {relative}")
    print("Submission: checklist and required media present")


def check_rojo() -> None:
    require(shutil.which("rojo") is not None, "rojo is not on PATH; run `rokit install`")
    projects = (
        "games/orrery-lock/default.project.json",
        "games/moonmarket-mixup/default.project.json",
        "skills/goal-to-game/engines/roblox/templates/default.project.json",
        "skills/goal-to-game/engines/roblox/tools/test.project.json",
    )
    with tempfile.TemporaryDirectory() as directory:
        for index, project in enumerate(projects):
            run("rojo", "build", project, "-o", str(Path(directory) / f"build-{index}.rbxlx"))
    print(f"Rojo: {len(projects)} projects built")


def check_mesh_validator() -> None:
    run(sys.executable, str(VALIDATOR_TEST))
    stable_fields = (
        "sha256",
        "bytes",
        "maxTrianglesPerMesh",
        "meshCount",
        "triangleTotal",
        "meshes",
        "warnings",
        "errors",
        "passed",
    )
    checked = 0
    for asset, source in manifest_assets():
        completed = subprocess.run(
            [sys.executable, str(VALIDATOR), str(source)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        actual = json.loads(completed.stdout)
        report = ROOT / "evidence/reports" / f"{report_slug(asset['name'])}-validation.json"
        require(report.is_file(), f"missing validation report: {report.relative_to(ROOT)}")
        recorded = json.loads(report.read_text(encoding="utf-8"))
        require(actual["passed"], f"mesh validation failed: {source.relative_to(ROOT)}")
        require(
            all(actual[field] == recorded[field] for field in stable_fields),
            f"recorded validation report is stale: {report.relative_to(ROOT)}",
        )
        checked += 1
    require(checked == 15, f"expected 15 validated assets, found {checked}")
    print(f"Validator: regression fixtures and {checked} recorded asset reports passed")


def main() -> int:
    check_json()
    check_asset_hashes()
    check_game_manifests()
    check_markdown_links()
    check_rojo()
    check_mesh_validator()
    check_submission_state()
    print("Roblox issue #3 submission verification passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
