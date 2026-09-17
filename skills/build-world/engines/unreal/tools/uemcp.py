#!/usr/bin/env python3
"""Minimal command-line client for Epic's Unreal MCP server (Streamable HTTP).

Lets an agent drive the editor from a shell when the `unreal-mcp` server is not
(yet) registered in the agent harness - e.g. the editor was configured mid-session
and the harness only reads `.mcp.json` at startup. No third-party dependencies.

Usage:
  uemcp.py toolsets                         # list_toolsets
  uemcp.py describe <Toolset>               # describe_toolset (full JSON schemas)
  uemcp.py sig <Toolset>                    # one line per tool: name(arg:type, ...) + first doc line
  uemcp.py call <Toolset> <tool> '<json>'   # call_tool (arguments as a JSON object)
  uemcp.py call <Toolset> <tool> @args.json # arguments read from a file
  uemcp.py raw <method> '<json params>'     # any JSON-RPC method (tools/list ...)

Environment:
  UEMCP_URL      default http://127.0.0.1:8000/mcp
  UEMCP_SESSION  file that caches the Mcp-Session-Id (default: /tmp/uemcp.session)
  UEMCP_TIMEOUT  seconds per request (default 600; tool calls run on the game thread
                 and a PIE start or shader compile can take a while)

Output: the tool's text content is printed verbatim. If a text block is JSON it is
pretty-printed. Image blocks (and inline {data,mimeType} images inside JSON results, e.g.
CaptureViewport / CaptureEditorImage / Screenshot) are written to /tmp/uemcp_<n>.png
and the path is printed in place of the base64.
Exit code 1 on isError / JSON-RPC error, so shell pipelines can branch on it.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get("UEMCP_URL", "http://127.0.0.1:8000/mcp")
SESSION_FILE = os.environ.get("UEMCP_SESSION", "/tmp/uemcp.session")
TIMEOUT = float(os.environ.get("UEMCP_TIMEOUT", "600"))
_id = [0]


def _post(payload, session=None):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session:
        headers["Mcp-Session-Id"] = session
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers=headers)
    resp = urllib.request.urlopen(req, timeout=TIMEOUT)
    body = resp.read().decode("utf-8", "replace")
    sid = resp.headers.get("Mcp-Session-Id")
    ctype = resp.headers.get("Content-Type", "")
    msg = None
    if "text/event-stream" in ctype:
        # take the last JSON-RPC message with a result/error
        for line in body.splitlines():
            if line.startswith("data:"):
                try:
                    m = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if "result" in m or "error" in m:
                    msg = m
    elif body.strip():
        msg = json.loads(body)
    return msg, sid


def _rpc(method, params=None, session=None):
    _id[0] += 1
    payload = {"jsonrpc": "2.0", "id": _id[0], "method": method}
    if params is not None:
        payload["params"] = params
    return _post(payload, session)


def _initialize():
    msg, sid = _rpc("initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "uemcp-cli", "version": "0.1"},
    })
    if msg is None or "error" in msg:
        raise SystemExit(f"initialize failed: {msg}")
    # notifications/initialized has no id
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if sid:
        headers["Mcp-Session-Id"] = sid
    req = urllib.request.Request(URL, data=json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}).encode(), headers=headers)
    try:
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except urllib.error.HTTPError:
        pass
    if sid:
        with open(SESSION_FILE, "w") as f:
            f.write(sid)
    return sid


def _session():
    if os.path.exists(SESSION_FILE):
        return open(SESSION_FILE).read().strip() or None
    return None


def rpc(method, params=None):
    """JSON-RPC call with automatic (re)initialisation of the session."""
    sid = _session()
    if sid is None:
        sid = _initialize()
    try:
        msg, _ = _rpc(method, params, sid)
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):  # unknown/expired session
            sid = _initialize()
            msg, _ = _rpc(method, params, sid)
        else:
            raise
    if msg is not None and "error" in msg and "session" in json.dumps(msg["error"]).lower():
        sid = _initialize()
        msg, _ = _rpc(method, params, sid)
    return msg


def print_result(msg):
    if msg is None:
        print("(no response)")
        return 1
    if "error" in msg:
        print("JSON-RPC error:", json.dumps(msg["error"], indent=1))
        return 1
    res = msg["result"]
    rc = 1 if res.get("isError") else 0
    content = res.get("content")
    if content is None:
        print(json.dumps(res, indent=1))
        return rc
    n = 0
    for block in content:
        t = block.get("type")
        if t == "text":
            txt = block.get("text", "")
            try:
                obj = json.loads(txt)
            except (json.JSONDecodeError, TypeError):
                print(txt)
                continue
            # Inline images: {returnValue:{data,mimeType}} or {returnValue:{image:{data,mimeType}}}
            def _extract(o):
                nonlocal n
                if isinstance(o, dict):
                    if isinstance(o.get("data"), str) and str(o.get("mimeType", "")).startswith("image/") and len(o["data"]) > 256:
                        n += 1
                        ext = "png" if "png" in o["mimeType"] else "jpg"
                        path = f"/tmp/uemcp_{n}.{ext}"
                        with open(path, "wb") as f:
                            f.write(base64.b64decode(o["data"]))
                        o["data"] = f"<{len(o['data'])} b64 chars written to {path}>"
                    for v in o.values():
                        _extract(v)
                elif isinstance(o, list):
                    for v in o:
                        _extract(v)
            _extract(obj)
            print(json.dumps(obj, indent=1))
        elif t == "image":
            n += 1
            path = f"/tmp/uemcp_{n}.png"
            with open(path, "wb") as f:
                f.write(base64.b64decode(block["data"]))
            print(f"[image written to {path}]")
        else:
            print(json.dumps(block, indent=1))
    if rc:
        print("(isError=true)")
    return rc


def _typ(p):
    t = p.get("type")
    if t == "object" and "refPath" in p.get("properties", {}):
        return "ref<" + p.get("title", "obj").split(".")[-1] + ">"
    if t == "array":
        return "[" + _typ(p.get("items", {})) + "]"
    if t == "object" and p.get("properties"):
        return "{" + ",".join(f"{k}:{_typ(v)}" for k, v in p["properties"].items()) + "}"
    if "enum" in p:
        return "|".join(map(str, p["enum"]))
    return t or p.get("title", "any")


def print_signatures(msg):
    if msg is None or "error" in msg:
        return print_result(msg)
    res = msg["result"]
    for block in res.get("content", []):
        if block.get("type") != "text":
            continue
        try:
            d = json.loads(block["text"])
        except json.JSONDecodeError:
            print(block["text"])
            continue
        print(f"# {d.get('name')}: {(d.get('description') or '').strip().splitlines()[0] if d.get('description') else ''}")
        for t in d.get("tools", []):
            schema = t.get("inputSchema", {})
            req = set(schema.get("required", []))
            args = []
            for k, v in schema.get("properties", {}).items():
                args.append(f"{k}{'' if k in req else '?'}:{_typ(v)}")
            out = t.get("outputSchema", {}).get("properties", {}).get("returnValue")
            doc = (t.get("description") or "").strip().splitlines()
            doc = doc[0] if doc else ""
            short = t["name"].split(".")[-1]
            print(f"{short}({', '.join(args)}) -> {_typ(out) if out else 'None'}\n    {doc}")
    return 0


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "toolsets":
        msg = rpc("tools/call", {"name": "list_toolsets", "arguments": {}})
    elif cmd == "describe":
        msg = rpc("tools/call", {"name": "describe_toolset", "arguments": {"toolset_name": argv[2]}})
    elif cmd == "sig":
        msg = rpc("tools/call", {"name": "describe_toolset", "arguments": {"toolset_name": argv[2]}})
        return print_signatures(msg)
    elif cmd == "call":
        toolset, tool = argv[2], argv[3]
        raw = argv[4] if len(argv) > 4 else "{}"
        if raw.startswith("@"):
            raw = open(raw[1:]).read()
        args = json.loads(raw) if raw.strip() else {}
        msg = rpc("tools/call", {"name": "call_tool", "arguments": {"toolset_name": toolset, "tool_name": tool, "arguments": args}})
    elif cmd == "raw":
        params = json.loads(argv[3]) if len(argv) > 3 else None
        msg = rpc(argv[2], params)
    else:
        print(__doc__)
        return 2
    return print_result(msg)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
