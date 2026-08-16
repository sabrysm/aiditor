#!/usr/bin/env sh
# Installed by the "AIditor" VS Code extension.
# AIDITOR_HOOK_MARKER — do not remove this line, the extension uses it to
# detect that this hook belongs to it (e.g. before overwriting/uninstalling).
#
# This blocks `git commit` until the running VS Code extension confirms the
# developer passed a comprehension quiz on the staged diff. It works no matter
# how the commit was triggered (terminal, VS Code, another GUI) because it's a
# real git hook — but like any client-side hook it can be bypassed with
# `git commit --no-verify`. That's a git limitation, not specific to this tool.

REPO_ROOT="$(git rev-parse --show-toplevel)"
PORT_FILE="$REPO_ROOT/.git/aiditor.port"

if [ ! -f "$PORT_FILE" ]; then
  echo "AIditor: VS Code isn't running with this repo open (no port file found)."
  echo "Open this repo in VS Code with the AIditor extension active, then commit again."
  echo "To skip this check once: git commit --no-verify"
  exit 1
fi

PORT="$(cat "$PORT_FILE")"

# Escape backslashes and quotes for embedding REPO_ROOT in a JSON string.
CWD_JSON=$(printf '%s' "$REPO_ROOT" | sed 's/\\/\\\\/g; s/"/\\"/g')

RESPONSE=$(curl -s -m 300 -X POST "http://127.0.0.1:$PORT/review" \
  -H "Content-Type: application/json" \
  -d "{\"cwd\": \"$CWD_JSON\"}")

if [ -z "$RESPONSE" ]; then
  echo "AIditor: could not reach the VS Code extension on port $PORT."
  echo "Open this repo in VS Code with the AIditor extension active, then commit again."
  echo "To skip this check once: git commit --no-verify"
  exit 1
fi

PASSED=$(printf '%s' "$RESPONSE" | grep -o '"passed":[a-z]*' | head -1 | cut -d: -f2)

if [ "$PASSED" = "true" ]; then
  exit 0
else
  echo "AIditor: review check failed. Commit blocked."
  echo "$RESPONSE"
  exit 1
fi
