#!/usr/bin/env python3
"""
wait_for_asset.py — Roblox Open Cloud asset upload helper for goal-to-game.

Polls an operation ID until an asset finishes processing, then optionally
resolves the child MeshPart + texture IDs for use in Luau scripts.

Usage:
  # Wait for an upload operation to complete:
  python3 wait_for_asset.py --api-key $RBXCLOUD_API_KEY --operation-id <op_id>

  # Additionally resolve child mesh/texture IDs from a completed model:
  python3 wait_for_asset.py --api-key $RBXCLOUD_API_KEY --asset-id <asset_id> --resolve

  # Full flow (upload + wait + resolve):
  python3 wait_for_asset.py --api-key $RBXCLOUD_API_KEY --operation-id <op_id> --resolve
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from typing import Optional

BASE = "https://apis.roblox.com"
POLL_INTERVAL = 3      # seconds between polls
MAX_WAIT = 120         # seconds before giving up on operation poll


def get(url: str, api_key: str) -> dict:
    req = urllib.request.Request(url, headers={"x-api-key": api_key})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def poll_operation(api_key: str, operation_id: str) -> Optional[str]:
    """Poll an Open Cloud long-running operation until done. Returns assetId or None."""
    url = f"{BASE}/assets/v1/operations/{operation_id}"
    deadline = time.time() + MAX_WAIT
    print(f"Polling operation {operation_id} (max {MAX_WAIT}s)...", file=sys.stderr)
    while time.time() < deadline:
        try:
            data = get(url, api_key)
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
            sys.exit(1)

        done = data.get("done", False)
        if done:
            error = data.get("error")
            if error:
                print(f"Operation failed: {json.dumps(error, indent=2)}", file=sys.stderr)
                sys.exit(1)
            response = data.get("response", {})
            asset_id = (
                response.get("assetId")
                or response.get("asset", {}).get("assetId")
            )
            if asset_id:
                print(f"  Operation complete. assetId={asset_id}", file=sys.stderr)
                return str(asset_id)
            # Some endpoints put it at the top level
            asset_id = data.get("assetId")
            if asset_id:
                print(f"  Operation complete. assetId={asset_id}", file=sys.stderr)
                return str(asset_id)
            print(f"  Done=true but no assetId in response:\n{json.dumps(data, indent=2)}", file=sys.stderr)
            sys.exit(1)
        else:
            meta = data.get("metadata", {})
            state = meta.get("moderationState") or data.get("status", "PENDING")
            print(f"  status={state}, waiting {POLL_INTERVAL}s...", file=sys.stderr)
            time.sleep(POLL_INTERVAL)

    print(f"Timed out after {MAX_WAIT}s. The asset may still be processing or in moderation.", file=sys.stderr)
    print("Check https://create.roblox.com/dashboard/assets for its status.", file=sys.stderr)
    sys.exit(1)


def resolve_children(api_key: str, model_asset_id: str) -> dict:
    """
    Enumerate child assets of a Model asset (meshes + textures).
    Returns a manifest dict with rbxassetid:// strings.
    """
    url = f"{BASE}/assets/v1/assets?assetType=Model&limit=10&filter=assetId={model_asset_id}"
    print(f"Resolving children of model assetId={model_asset_id}...", file=sys.stderr)

    # First get the model metadata to find its children via the inventory/asset details
    # Roblox Open Cloud v2 endpoint for asset details
    detail_url = f"{BASE}/cloud/v2/assets/{model_asset_id}"
    try:
        data = get(detail_url, api_key)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  HTTP {e.code} on detail endpoint: {body}", file=sys.stderr)
        print("  Falling back to list endpoint...", file=sys.stderr)
        data = {}

    # Try to get child asset IDs from the model's content
    # The Open Cloud v2 API returns asset contents for models
    content_url = f"{BASE}/cloud/v2/assets/{model_asset_id}/content"
    try:
        content = get(content_url, api_key)
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code} getting content: {e.read().decode()}", file=sys.stderr)
        content = {}

    # Build the manifest from available data
    manifest = {
        "model_asset_id": model_asset_id,
        "import_method": "open_cloud",
        "meshes": {},
        "textures": {},
        "_raw_content": content,
        "_raw_detail": data,
        "_note": (
            "If meshes/textures are empty, the child IDs are embedded in the RBXM "
            "format, not exposed via the Open Cloud API. Use the Studio fallback: "
            "insert the model via rbxassetid, inspect in Explorer, copy each MeshId. "
            "See PITFALLS.md."
        )
    }

    # Parse any children the API did return
    children = (
        content.get("children", [])
        or data.get("children", [])
        or content.get("assets", [])
    )
    for child in children:
        name = child.get("name", "")
        child_id = str(child.get("assetId") or child.get("id", ""))
        asset_type = child.get("assetType", "").lower()
        if not child_id:
            continue
        rbx_id = f"rbxassetid://{child_id}"
        if "texture" in asset_type or "image" in asset_type:
            manifest["textures"][name] = rbx_id
        else:
            manifest["meshes"][name] = rbx_id

    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Poll Roblox Open Cloud operation and resolve asset IDs."
    )
    parser.add_argument("--api-key", required=True, help="Open Cloud API key")
    parser.add_argument("--operation-id", help="Operation ID from asset upload")
    parser.add_argument("--asset-id", help="Already-known model asset ID (skip polling)")
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="Resolve child MeshPart/texture IDs after getting assetId",
    )
    parser.add_argument(
        "--out",
        help="Write manifest JSON to this file (default: stdout)",
    )
    args = parser.parse_args()

    if not args.operation_id and not args.asset_id:
        parser.error("Provide --operation-id and/or --asset-id")

    asset_id = args.asset_id
    if args.operation_id:
        asset_id = poll_operation(args.api_key, args.operation_id)

    if args.resolve:
        manifest = resolve_children(args.api_key, asset_id)
    else:
        manifest = {"model_asset_id": asset_id}

    out_json = json.dumps(manifest, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out_json)
        print(f"Manifest written to {args.out}", file=sys.stderr)
    else:
        print(out_json)


if __name__ == "__main__":
    main()
