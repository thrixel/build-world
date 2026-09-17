#!/bin/bash
# Run an Unreal console command (e.g. a `py ...` line) through the editor's status-bar Cmd box,
# using SlateInspectorToolset, and retry until the editor log confirms it executed.
#
# usage: tools/ue_console.sh '<command>' [project log path]
# env:   UEMCP_CMDBOX_REF  (default tb2)  ref of the Cmd textbox from Snapshot("sp1")
#
# Quirks handled (UE 5.8.2): first typed character is duplicated (we prefix a space), submit
# only lands every other attempt (we press Escape and retry), text appends (a stray submit
# flushes leftovers). Python calls emit a unique completion/error marker. A Python
# error is never retried: earlier statements may already have changed the project.
# This targets the editor Cmd box and presses Escape. Do not use during PIE.
set -u
if [ "$#" -lt 1 ]; then echo "usage: $0 '<console command>' [project log]" >&2; exit 2; fi
CMD="$1"; LOG="${2:-}"
ORIGINAL_CMD="$CMD"
HERE="$(cd "$(dirname "$0")" && pwd)"
REF="${UEMCP_CMDBOX_REF:-}"
if [ -z "$REF" ]; then  # find the status-bar textbox (bottom of the main window, wide) from a fresh snapshot
  python3 "$HERE/uemcp.py" call SlateInspectorToolset.SlateInspectorToolset Observe '{"ref":"","maxDepth":40}' >/dev/null
  REF=$(python3 "$HERE/uemcp.py" call SlateInspectorToolset.SlateInspectorToolset Snapshot '{"ref":"","maxDepth":40}' | python3 -c '
import sys,json,re; t=json.load(sys.stdin)["returnValue"]; candidates=[]
for l in t.split("\n"):
    m=re.search(r"textbox \[pos=(\d+),(\d+) size=(\d+),\d+\] \[ref=(\w+)\]", l)
    if m and int(m.group(3))>150: candidates.append((int(m.group(2)),m.group(4)))
if candidates: print(max(candidates)[1])')
  REF="${REF:-tb2}"
fi
if [ -z "$LOG" ]; then LOG=$(ls -t "$HOME"/Unreal\ Projects/*/Saved/Logs/*.log 2>/dev/null | head -1); fi
if [ ! -r "$LOG" ]; then echo "Pass the running project's readable editor log as argument 2." >&2; exit 2; fi
BEFORE_BYTES=$(stat -c %s "$LOG")
# Slate may insert several leading spaces; Unreal preserves them after Cmd:.
# Compare complete commands after trimming only surrounding whitespace.
dispatched() {
  tail -c +$((BEFORE_BYTES + 1)) "$LOG" | python3 -c 'import sys
command=sys.argv[1].strip()
seen=any("Cmd:" in line and line.split("Cmd:",1)[1].strip()==command for line in sys.stdin)
sys.exit(0 if seen else 1)' "$CMD"
}
ACK="UE_CONSOLE_DONE_${$}_${RANDOM}"
IS_PYTHON=false
if [[ "$CMD" == "py "* ]]; then
  IS_PYTHON=true
  CMD=$(python3 -c 'import sys
source=sys.argv[1][3:]; marker=sys.argv[2]
wrapped="import traceback\ntry:\n    exec("+repr(source)+", globals())\nexcept BaseException:\n    traceback.print_exc()\n    print("+repr(marker+" ERROR")+")\nelse:\n    print("+repr(marker+" OK")+")"
print("py exec("+repr(wrapped)+")")' "$CMD" "$ACK")
fi
ARGS_FILE=$(mktemp "${TMPDIR:-/tmp}/ue-console.XXXXXX.json")
trap 'rm -f "$ARGS_FILE"' EXIT
for i in 1 2 3 4 5 6; do
  python3 "$HERE/uemcp.py" call SlateInspectorToolset.SlateInspectorToolset PressKey '{"key":"Escape"}' >/dev/null || exit 1
  python3 -c 'import json,sys; print(json.dumps({"ref":sys.argv[1],"text":" "+sys.argv[2],"submit":True}))' "$REF" "$CMD" > "$ARGS_FILE"
  if ! python3 "$HERE/uemcp.py" call SlateInspectorToolset.SlateInspectorToolset Type "@$ARGS_FILE" >/dev/null; then
    echo "Submission status uncertain; inspect the editor log before retrying." >&2; exit 1
  fi
  sleep 2
  if [ "$(stat -c %s "$LOG")" -lt "$BEFORE_BYTES" ]; then
    echo "Editor log was rotated/truncated; inspect it before retrying." >&2; exit 1
  fi
  if "$IS_PYTHON"; then
    # Match the emitted LogPython line, never the source echoed in a Cmd line.
    if tail -c +$((BEFORE_BYTES + 1)) "$LOG" | grep -a -F "LogPython: $ACK ERROR" >/dev/null; then
      echo "Python failed; partial changes may exist. See $LOG. Not retrying." >&2; exit 1
    fi
    if tail -c +$((BEFORE_BYTES + 1)) "$LOG" | grep -a -F "LogPython: $ACK OK" >/dev/null; then
      echo "completed (try $i): $ORIGINAL_CMD"; exit 0
    fi
    if dispatched || tail -c +$((BEFORE_BYTES + 1)) "$LOG" | grep -a -F 'LogPython: Error:' >/dev/null; then
      echo "Python dispatch/error seen without completion. Inspect $LOG; not retrying." >&2; exit 1
    fi
  elif dispatched; then
    echo "submitted (try $i): $ORIGINAL_CMD"; exit 0
  fi
done
echo "No completion acknowledgement. Inspect the editor log before retrying: $ORIGINAL_CMD" >&2; exit 1
