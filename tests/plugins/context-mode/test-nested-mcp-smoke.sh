#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/context-mode-nested-smoke.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
version=$(node -p "require('$root/plugins/context-mode/package.json').version")
plugin="$tmp/cache/dyne-gestalt-agents/context-mode/$version"
gestalt_home="$tmp/gestalt-home"
mkdir -p "$(dirname -- "$plugin")" "$tmp/codex-home"
mkdir -p "$plugin"
tar -C "$root/plugins/context-mode" \
  --exclude=node_modules \
  --exclude=build \
  --exclude=.context-mode-prepared.json \
  --exclude='.context-mode-prepare*' \
  --exclude='*.bundle.mjs' \
  -cf - . | tar -C "$plugin" -xf -

test ! -e "$plugin/node_modules"
test ! -e "$plugin/server.bundle.mjs"
GESTALT_HOME="$gestalt_home" node "$plugin/scripts/install-runtime.mjs" &
builder_one=$!
GESTALT_HOME="$gestalt_home" node "$plugin/scripts/install-runtime.mjs" &
builder_two=$!
wait "$builder_one"
wait "$builder_two"
runtime=$(GESTALT_HOME="$gestalt_home" node -e "import('./plugins/context-mode/scripts/runtime-location.mjs').then(({getRuntimeRoot}) => process.stdout.write(getRuntimeRoot(process.argv[1])))" "$plugin")
test -f "$runtime/server.bundle.mjs"
test -f "$runtime/hooks/security.bundle.mjs"
test -f "$runtime/hooks/session-attribution.bundle.mjs"
test -f "$runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
test ! -e "$runtime.install.lock"

# Recreate the replaceable plugin cache after preparation. Startup must still
# use the external runtime and require no generated cache files.
rm -rf "$plugin"
mkdir -p "$plugin"
tar -C "$root/plugins/context-mode" \
  --exclude=node_modules \
  --exclude=build \
  --exclude=.context-mode-prepared.json \
  --exclude='.context-mode-prepare*' \
  --exclude='*.bundle.mjs' \
  -cf - . | tar -C "$plugin" -xf -

output=$(timeout 20s bash -c 'cd "$2"
  printf "%s\n%s\n" \
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"nested-smoke\",\"version\":\"1\"}}}" \
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" | \
  CONTEXT_MODE_PLATFORM=codex CODEX_HOME="$1" GESTALT_HOME="$3" node start.mjs' _ "$tmp/codex-home" "$plugin" "$gestalt_home" 2>&1 || true)

python3 - "$output" "$plugin" <<'PY'
import json
import sys
from pathlib import Path

raw = sys.argv[1]
messages = [json.loads(line) for line in raw.splitlines() if line.startswith("{")]
assert any(item.get("id") == 1 and item.get("result", {}).get("serverInfo", {}).get("name") == "context-mode" for item in messages), raw
tools = next(item["result"]["tools"] for item in messages if item.get("id") == 2)
assert {"ctx_execute", "ctx_search", "ctx_doctor"} <= {tool["name"] for tool in tools}
plugin = Path(sys.argv[2])
assert (plugin / "hooks/codex/pretooluse.mjs").is_file()
assert (plugin / "hooks/codex/sessionstart.mjs").is_file()
assert not (plugin / ".context-mode-prepared.json").exists()
assert not (plugin / "node_modules").exists()
PY

hook_output=$(printf '%s\n' '{"source":"startup","session_id":"nested-smoke","cwd":"/tmp"}' |
  CODEX_HOME="$tmp/codex-home" GESTALT_HOME="$gestalt_home" node "$plugin/hooks/runtime-hook.mjs" sessionstart)
python3 - "$hook_output" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["hookSpecificOutput"]["hookEventName"] == "SessionStart", payload
PY

test -z "$(find "$tmp/codex-home" -mindepth 1 -maxdepth 1 -name 'hooks.json' -print -quit)"
printf 'nested context-mode MCP smoke test is valid\n'
