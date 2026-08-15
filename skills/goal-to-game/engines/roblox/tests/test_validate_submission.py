import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "validate_submission", ROOT / "tools" / "validate_submission.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ValidateSubmissionTests(unittest.TestCase):
    def setUp(self):
        path = ROOT / "templates" / "submission-evidence.example.json"
        self.evidence = json.loads(path.read_text(encoding="utf-8"))

    def test_example_is_valid(self):
        self.assertEqual(MODULE.validate_submission(self.evidence), [])

    def test_requires_two_genres(self):
        self.evidence["games"][1]["genre"] = "survival"
        errors = MODULE.validate_submission(self.evidence)
        self.assertIn("the submission must contain at least two different genres", errors)

    def test_requires_public_https_url(self):
        self.evidence["games"][0]["publicUrl"] = "file:///stormwatch.rbxl"
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("public https URL" in error for error in errors))

    def test_requires_public_video_url(self):
        self.evidence["games"][0]["videoUrl"] = ""
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("videoUrl must be a public https URL" in error for error in errors))

    def test_requires_all_camera_views(self):
        self.evidence["games"][0]["screenshots"].pop()
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("missing views: gameplay" in error for error in errors))

    def test_rejects_mobile_under_30_fps(self):
        self.evidence["games"][0]["performance"][1]["fps"] = 29.9
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("at least 30 FPS" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
