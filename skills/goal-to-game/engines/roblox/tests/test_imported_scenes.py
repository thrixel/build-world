from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ASSET_ID = re.compile(r"rbxassetid://[1-9][0-9]+$")

EXPECTED_MESHES = {
    "stormwatch/Stormwatch-Imported.rbxlx": {
        "Lantern_Group",
        "LighthouseStatic",
    },
    "courier-circuit/CourierCircuit-Imported.rbxlx": {
        "CartBody",
        "WheelFrontLeft",
        "WheelFrontRight",
        "WheelRearLeft",
        "WheelRearRight",
    },
}


def property_text(item: ET.Element, tag: str, name: str) -> str:
    node = item.find(f"./Properties/{tag}[@name='{name}']")
    if node is None:
        return ""
    url = node.find("url")
    return (url.text if url is not None else node.text) or ""


class ImportedSceneTests(unittest.TestCase):
    def test_imported_scenes_contain_collision_ready_textured_meshes(self):
        for relative_path, expected_names in EXPECTED_MESHES.items():
            with self.subTest(scene=relative_path):
                scene = ROOT / "examples" / relative_path
                root = ET.parse(scene).getroot()
                meshes = root.findall(".//Item[@class='MeshPart']")
                names = {property_text(mesh, "string", "Name") for mesh in meshes}

                self.assertEqual(names, expected_names)
                for mesh in meshes:
                    self.assertRegex(property_text(mesh, "Content", "MeshId"), ASSET_ID)
                    self.assertRegex(property_text(mesh, "Content", "TextureID"), ASSET_ID)
                    self.assertEqual(property_text(mesh, "bool", "CanCollide"), "true")
                    self.assertEqual(property_text(mesh, "bool", "Anchored"), "false")


if __name__ == "__main__":
    unittest.main()
