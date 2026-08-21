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
        self.evidence["studioVersion"] = "0.734.0.7340915"
        self.evidence["games"][0]["publicUrl"] = (
            "https://www.roblox.com/games/1234567890/stormwatch"
        )
        self.evidence["games"][0]["videoUrl"] = (
            "https://www.youtube.com/watch?v=stormwatch-demo"
        )
        self.evidence["games"][1]["publicUrl"] = (
            "https://www.roblox.com/games/2345678901/courier-circuit"
        )
        self.evidence["games"][1]["videoUrl"] = (
            "https://www.youtube.com/watch?v=courier-demo"
        )

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

    def test_rejects_template_placeholders(self):
        self.evidence["studioVersion"] = "replace-with-tested-version"
        self.evidence["games"][0]["publicUrl"] = (
            "https://www.roblox.com/games/replace-with-place-id/stormwatch"
        )
        errors = MODULE.validate_submission(self.evidence)
        self.assertIn("studioVersion must be recorded", errors)
        self.assertIn("games[0].publicUrl must be a public https URL", errors)

    def test_requires_all_camera_views(self):
        self.evidence["games"][0]["screenshots"].pop()
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("missing views: gameplay" in error for error in errors))

    def test_rejects_empty_screenshot_file(self):
        self.evidence["games"][0]["screenshots"][0]["file"] = ""
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("screenshots[front].file must be recorded" in error for error in errors))
        self.assertTrue(any("missing views: front" in error for error in errors))

    def test_rejects_duplicate_camera_views(self):
        duplicate = dict(self.evidence["games"][0]["screenshots"][0])
        self.evidence["games"][0]["screenshots"].append(duplicate)
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("duplicate views: front" in error for error in errors))

    def test_rejects_mobile_under_30_fps(self):
        self.evidence["games"][0]["performance"][1]["fps"] = 29.9
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("at least 30 FPS" in error for error in errors))

    def test_rejects_non_finite_fps(self):
        self.evidence["games"][0]["performance"][1]["fps"] = float("nan")
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("at least 30 FPS" in error for error in errors))

    def test_rejects_duplicate_performance_profiles(self):
        duplicate = dict(self.evidence["games"][0]["performance"][0])
        self.evidence["games"][0]["performance"].append(duplicate)
        errors = MODULE.validate_submission(self.evidence)
        self.assertTrue(any("duplicate profiles: desktop" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
