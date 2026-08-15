#!/usr/bin/env python3
"""Copy evidence scripts from a Rojo build into an imported Roblox place."""

from __future__ import annotations

import argparse
import copy
import uuid
from pathlib import Path

from lxml import etree


SCRIPT_TARGETS = {
    "ServerScriptService": ("Main", "ThrixelSelftest"),
    "StarterPlayerScripts": ("HUD", "ThrixelCameraTour", "ThrixelPerformance"),
}


def item_name(item: etree._Element) -> str | None:
    value = item.find("./Properties/string[@name='Name']")
    return value.text if value is not None else None


def find_item(root: etree._Element, class_name: str, name: str) -> etree._Element:
    for item in root.iter("Item"):
        if item.get("class") == class_name and item_name(item) == name:
            return item
    raise ValueError(f"missing {class_name} named {name}")


def refresh_identity(item: etree._Element) -> None:
    item.set("referent", f"RBX{uuid.uuid4().hex.upper()}")
    unique_id = item.find("./Properties/UniqueId[@name='UniqueId']")
    if unique_id is not None:
        unique_id.text = uuid.uuid4().hex
    script_guid = item.find("./Properties/string[@name='ScriptGuid']")
    if script_guid is not None:
        script_guid.text = "{" + str(uuid.uuid4()).upper() + "}"


def inject(template: Path, imported: Path) -> None:
    parser = etree.XMLParser(remove_blank_text=False, strip_cdata=False)
    template_tree = etree.parse(str(template), parser)
    imported_tree = etree.parse(str(imported), parser)

    for service_name, script_names in SCRIPT_TARGETS.items():
        service_class = service_name
        imported_service = find_item(imported_tree.getroot(), service_class, service_name)
        template_service = find_item(template_tree.getroot(), service_class, service_name)

        for script_name in script_names:
            for child in list(imported_service.findall("./Item")):
                if item_name(child) == script_name:
                    imported_service.remove(child)

            template_script = next(
                (
                    child
                    for child in template_service.findall("./Item")
                    if item_name(child) == script_name
                ),
                None,
            )
            if template_script is None:
                raise ValueError(f"template is missing {service_name}/{script_name}")

            inserted = copy.deepcopy(template_script)
            refresh_identity(inserted)
            imported_service.append(inserted)

    imported_tree.write(
        str(imported),
        encoding="utf-8",
        xml_declaration=True,
        pretty_print=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("template", type=Path, help="Rojo-built place containing evidence scripts")
    parser.add_argument("imported", type=Path, help="Imported place to update in place")
    args = parser.parse_args()
    inject(args.template, args.imported)
    print(f"Injected evidence scripts into {args.imported}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
