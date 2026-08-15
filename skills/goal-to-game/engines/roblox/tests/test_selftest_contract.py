from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class SelftestContractTests(unittest.TestCase):
    def test_script_emits_machine_readable_result_and_enforces_failures(self):
        script = (ROOT / "tools" / "selftest.server.lua").read_text(encoding="utf-8")

        for token in (
            "THRIXEL_SELFTEST_JSON=",
            "ThrixelAsset",
            "ThrixelMovingPart",
            "ThrixelPivotVerified",
            "EMPTY_MESH_ID",
            "NO_MESH_PARTS",
            "error(",
        ):
            self.assertIn(token, script)

    def test_engine_guide_wires_the_script_into_the_evidence_flow(self):
        guide = (ROOT.parent / "roblox.md").read_text(encoding="utf-8")

        self.assertIn("tools/selftest.server.lua", guide)
        self.assertIn("evidence/validation.json", guide)
        self.assertIn("passed: false", guide)

    def test_camera_tour_covers_required_submission_views(self):
        script = (ROOT / "tools" / "camera-tour.client.lua").read_text(encoding="utf-8")

        for token in (
            'name = "front"',
            'name = "rear"',
            'name = "left"',
            'name = "right"',
            'name = "top"',
            'name = "gameplay"',
            "THRIXEL_CAMERA_VIEW=",
            'GetTagged("ThrixelAsset")',
        ):
            self.assertIn(token, script)

    def test_performance_sampler_emits_required_metrics(self):
        script = (ROOT / "tools" / "performance.client.lua").read_text(encoding="utf-8")

        for token in (
            "THRIXEL_PERFORMANCE_JSON=",
            "averageFps",
            "minimumFps",
            "p95FrameTimeMs",
            "instanceCount",
            "meshPartCount",
            "ThrixelPerformanceProfile",
            "RenderStepped",
        ):
            self.assertIn(token, script)


if __name__ == "__main__":
    unittest.main()
