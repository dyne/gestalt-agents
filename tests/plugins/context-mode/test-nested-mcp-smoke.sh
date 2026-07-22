#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/context-mode-nested-smoke.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
plugin="$tmp/cache/dyne-gestalt-agents/context-mode/1.0.169"
mkdir -p "$(dirname -- "$plugin")" "$tmp/codex-home"
mkdir -p "$plugin"
tar -C "$root/plugins/context-mode" \
  --exclude=node_modules \
  --exclude=build \
  --exclude='*.bundle.mjs' \
  -cf - . | tar -C "$plugin" -xf -

command -v bun >/dev/null
test ! -e "$plugin/node_modules"
test ! -e "$plugin/server.bundle.mjs"
(cd "$plugin" && node -e 'import("./scripts/ensure-source-build.mjs")') &
builder_one=$!
(cd "$plugin" && node -e 'import("./scripts/ensure-source-build.mjs")') &
builder_two=$!
wait "$builder_one"
wait "$builder_two"
test -f "$plugin/server.bundle.mjs"
test -f "$plugin/hooks/security.bundle.mjs"
test -f "$plugin/hooks/session-attribution.bundle.mjs"
test ! -e "$plugin/.context-mode-source-build.lock"

output=$(timeout 20s bash -c 'cd "$2"
  printf "%s\n%s\n" \
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"nested-smoke\",\"version\":\"1\"}}}" \
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" | \
  CONTEXT_MODE_PLATFORM=codex CODEX_HOME="$1" node start.mjs' _ "$tmp/codex-home" "$plugin" 2>&1 || true)

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
PY

test -z "$(find "$tmp/codex-home" -mindepth 1 -maxdepth 1 -name 'hooks.json' -print -quit)"
printf 'nested context-mode MCP smoke test is valid\n'
