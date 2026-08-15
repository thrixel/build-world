from __future__ import annotations

import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


inspect_glb = load_module("inspect_glb", ROOT / "tools" / "inspect_glb.py")
validate_manifest = load_module("validate_manifest", ROOT / "tools" / "validate_manifest.py")


def write_glb(path: Path, doc: dict) -> None:
    payload = json.dumps(doc, separators=(",", ":")).encode()
    payload += b" " * ((4 - len(payload) % 4) % 4)
    total = 12 + 8 + len(payload)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<II", len(payload), inspect_glb.JSON_CHUNK) + payload)


class InspectGlbTests(unittest.TestCase):
    def test_accepts_single_material_mesh_below_budget(self):
        doc = {
            "asset": {"version": "2.0"},
            "accessors": [{"count": 54000}],
            "materials": [{"name": "Paint"}],
            "meshes": [{"primitives": [{"indices": 0, "material": 0}]}],
            "nodes": [{"name": "Body_Paint", "mesh": 0}],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ok.glb"
            write_glb(path, doc)
            result = inspect_glb.inspect(inspect_glb.load_glb(path), 18000)
        self.assertTrue(result["ok"])
        self.assertEqual(result["summary"]["triangles"], 18000)

    def test_rejects_triangle_and_material_overflow(self):
        doc = {
            "asset": {"version": "2.0"},
            "accessors": [{"count": 60003}, {"count": 3}],
            "materials": [{"name": "Paint"}, {"name": "Glass"}],
            "meshes": [{"primitives": [{"indices": 0, "material": 0}, {"indices": 1, "material": 1}]}],
            "nodes": [{"name": "Body", "mesh": 0}],
        }
        result = inspect_glb.inspect(doc, 18000)
        self.assertFalse(result["ok"])
        self.assertTrue(any("triangles" in error for error in result["errors"]))
        self.assertTrue(any("materials" in error for error in result["errors"]))


class ManifestTests(unittest.TestCase):
    def test_example_manifests_are_valid(self):
        paths = sorted((ROOT / "examples").glob("*/thrixel-manifest.json"))
        self.assertEqual(len(paths), 2)
        for path in paths:
            with self.subTest(path=path):
                value = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(validate_manifest.validate(value), [])

    def test_rejects_unsafe_triangle_budget(self):
        value = json.loads((ROOT / "templates" / "asset-manifest.example.json").read_text())
        value["budgets"]["maxTrianglesPerMesh"] = 20001
        self.assertTrue(any("maxTrianglesPerMesh" in error for error in validate_manifest.validate(value)))


class ExampleProjectTests(unittest.TestCase):
    def test_rojo_paths_resolve(self):
        projects = sorted((ROOT / "examples").glob("*/default.project.json"))
        self.assertEqual(len(projects), 2)
        for project in projects:
            tree = json.loads(project.read_text(encoding="utf-8"))

            def walk(value):
                if isinstance(value, dict):
                    if "$path" in value:
                        self.assertTrue((project.parent / value["$path"]).resolve().exists(), value["$path"])
                    for child in value.values():
                        walk(child)
                elif isinstance(value, list):
                    for child in value:
                        walk(child)

            walk(tree)

    def test_every_game_has_server_client_and_readme(self):
        for game in sorted(path for path in (ROOT / "examples").iterdir() if path.is_dir()):
            with self.subTest(game=game.name):
                self.assertTrue((game / "README.md").is_file())
                self.assertTrue(any((game / "src" / "server").glob("*.lua")))
                self.assertTrue(any((game / "src" / "client").glob("*.lua")))


if __name__ == "__main__":
    unittest.main()

