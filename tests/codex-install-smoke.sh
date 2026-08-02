#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
codex_home=$(mktemp -d "$root/.codex-marketplace-smoke.XXXXXX")
gestalt_home=$(mktemp -d "$root/.gestalt-runtime-smoke.XXXXXX")
trap 'rm -rf "$codex_home" "$gestalt_home"' EXIT HUP INT TERM

CODEX_HOME="$codex_home" codex plugin marketplace add "$root" >/dev/null
mkdir -p "$codex_home/agents"
printf 'legacy supervisor\n' >"$codex_home/agents/org-plan-supervisor.toml"
printf 'approval_policy = "never"\n' >"$codex_home/config.toml"
CODEX_HOME="$codex_home" GESTALT_HOME="$gestalt_home" CONTEXT_MODE_PACKAGE_MANAGER=npm \
  bash "$root/gestalt-setup.sh" >/dev/null
CODEX_HOME="$codex_home" codex plugin list \
  --marketplace dyne-gestalt-agents --json >"$codex_home/plugins.json"

python3 - "$codex_home/plugins.json" "$codex_home" "$gestalt_home" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
installed = {item["name"]: item for item in payload["installed"]}
assert set(installed) == {"gestalt", "context-mode"}, installed
assert all(item["installed"] and item["enabled"] for item in installed.values())
assert all(item["marketplaceName"] == "dyne-gestalt-agents" for item in installed.values())

codex_home = Path(sys.argv[2])
gestalt_home = Path(sys.argv[3])
gestalt = codex_home / "plugins/cache/dyne-gestalt-agents/gestalt" / installed["gestalt"]["version"]
context_mode = codex_home / "plugins/cache/dyne-gestalt-agents/context-mode" / installed["context-mode"]["version"]
assert (gestalt / "skills/org-plan/SKILL.md").is_file()
assert (context_mode / "hooks/hooks.json").is_file()
assert (context_mode / ".mcp.json").is_file()
runtime_candidates = list((gestalt_home / "runtime/context-mode" / installed["context-mode"]["version"]).glob("*-node-*"))
assert len(runtime_candidates) == 1, runtime_candidates
runtime = runtime_candidates[0]
assert (runtime / ".context-mode-prepared.json").is_file()
assert (runtime / "node_modules/better-sqlite3/build/Release/better_sqlite3.node").is_file()
# Simulate Codex rematerializing its cache after setup.
import shutil
for relative in ("node_modules", ".context-mode-prepared.json", "server.bundle.mjs"):
    path = context_mode / relative
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()
assert (codex_home / "agents/org-plan-reviewer.toml").is_file()
assert (codex_home / "agents/org-plan-executor.toml").is_file()
assert not (codex_home / "agents/org-plan-supervisor.toml").exists()
assert 'approval_policy = "never"' in (codex_home / "config.toml").read_text()
PY

context_version=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).installed.find(x => x.name === 'context-mode').version" "$codex_home/plugins.json")
context_cache="$codex_home/plugins/cache/dyne-gestalt-agents/context-mode/$context_version"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"codex-install-smoke","version":"1"}}}' |
  timeout 20s env CODEX_HOME="$codex_home" GESTALT_HOME="$gestalt_home" node "$context_cache/start.mjs" >"$codex_home/mcp.out"
python3 - "$codex_home/mcp.out" <<'PY'
import json
import sys

messages = [json.loads(line) for line in open(sys.argv[1]) if line.startswith("{")]
assert any(
    item.get("id") == 1
    and item.get("result", {}).get("serverInfo", {}).get("name") == "context-mode"
    for item in messages
), messages
PY

printf 'Codex marketplace installation smoke test passed\n'
