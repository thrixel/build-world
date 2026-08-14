import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "validate_manifest", ROOT / "tools" / "validate_manifest.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ValidateManifestTests(unittest.TestCase):
    def setUp(self):
        example = ROOT / "templates" / "asset-manifest.example.json"
        self.manifest = json.loads(example.read_text(encoding="utf-8"))

    def test_example_is_valid(self):
        self.assertEqual(MODULE.validate_manifest(self.manifest), [])

    def test_rejects_mesh_over_triangle_limit(self):
        self.manifest["assets"][0]["groups"][0]["triangles"] = 20_001
        errors = MODULE.validate_manifest(self.manifest)
        self.assertTrue(any("Roblox limit is 20000" in error for error in errors))

    def test_moving_group_requires_numeric_pivot(self):
        del self.manifest["assets"][0]["groups"][1]["pivot"]
        errors = MODULE.validate_manifest(self.manifest)
        self.assertTrue(any("pivot must contain three numbers" in error for error in errors))

    def test_rejects_oversized_texture(self):
        maps = self.manifest["assets"][0]["groups"][0]["appearance"]["maps"]
        maps["color"]["size"] = 8192
        errors = MODULE.validate_manifest(self.manifest)
        self.assertTrue(any("Roblox limit is 4096" in error for error in errors))

    def test_rejects_duplicate_group_ids(self):
        groups = self.manifest["assets"][0]["groups"]
        groups[1]["id"] = groups[0]["id"]
        errors = MODULE.validate_manifest(self.manifest)
        self.assertTrue(any("duplicates 'Body'" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
