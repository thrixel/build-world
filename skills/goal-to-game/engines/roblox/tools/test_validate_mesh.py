#!/usr/bin/env python3
"""Regression tests for validate_mesh.py using generated fixtures."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile

import trimesh


def run_validator(path: Path, *arguments: str) -> tuple[int, dict | None, str]:
    script = Path(__file__).with_name("validate_mesh.py")
    completed = subprocess.run(
        [sys.executable, str(script), str(path), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    report = json.loads(completed.stdout) if completed.stdout else None
    return completed.returncode, report, completed.stderr


def main() -> int:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        valid = root / "valid.glb"
        open_mesh = root / "open.glb"
        inward = root / "inward.glb"
        thin = root / "thin.glb"
        oversized = root / "oversized.glb"
        fake = root / "queued.glb"
        trimesh.creation.box().export(valid)
        trimesh.Trimesh(
            vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            faces=[[0, 1, 2]],
            process=False,
        ).export(open_mesh)

        inward_mesh = trimesh.creation.box()
        inward_mesh.invert()
        inward_mesh.export(inward)
        trimesh.creation.box(extents=[1, 1, 1e-6]).export(thin)
        # A low override makes the fixture small while exercising the same limit branch.
        trimesh.creation.icosphere(subdivisions=2).export(oversized)
        fake.write_text('{"status":"queued"}', encoding="utf-8")

        valid_code, valid_report, _ = run_validator(valid)
        open_code, open_report, _ = run_validator(open_mesh)
        inward_code, inward_report, _ = run_validator(inward)
        thin_code, thin_report, _ = run_validator(thin)
        oversized_code, oversized_report, _ = run_validator(
            oversized, "--max-triangles", "10"
        )
        fake_code, fake_report, fake_error = run_validator(fake)

        assert valid_code == 0 and valid_report["passed"], valid_report
        assert open_code == 1 and open_report and not open_report["passed"], open_report
        assert any("watertight" in message for message in open_report["errors"])
        assert inward_code == 1 and inward_report and not inward_report["passed"], inward_report
        assert any("inward-facing" in message for message in inward_report["errors"])
        assert thin_code == 1 and thin_report and not thin_report["passed"], thin_report
        assert any("thickness" in message for message in thin_report["errors"])
        assert oversized_code == 1 and oversized_report and not oversized_report["passed"], oversized_report
        assert any("limit 10" in message for message in oversized_report["errors"])
        assert fake_code == 2 and fake_report is None and "not a binary glTF" in fake_error
        print("validate_mesh regression tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
