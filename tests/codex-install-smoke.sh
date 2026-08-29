#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
codex_home=$(mktemp -d "$root/.codex-marketplace-smoke.XXXXXX")
gestalt_home=$(mktemp -d "$root/.gestalt-runtime-smoke.XXXXXX")
workspace=$(mktemp -d "$root/.context-mode-workspace-smoke.XXXXXX")
trap 'rm -rf "$codex_home" "$gestalt_home" "$workspace"' EXIT HUP INT TERM

CODEX_HOME="$codex_home" codex plugin marketplace add "$root" >/dev/null
mkdir -p "$codex_home/agents"
printf 'developer_instructions = "legacy supervisor"\n' >"$codex_home/agents/org-plan-supervisor.toml"
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
assert all(item["installed"] for item in installed.values())
assert installed["gestalt"]["enabled"]
assert not installed["context-mode"]["enabled"]
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
assert (codex_home / "bin/org-plan").is_file()
config = (codex_home / "config.toml").read_text()
assert 'approval_policy = "never"' in config
assert "[features]\nhooks = true" in config
assert "[mcp_servers.context-mode]" in config
assert "required = true" in config
assert '[plugins."context-mode@dyne-gestalt-agents"]\nenabled = false' in config
assert (codex_home / "bin/context-mode-mcp.mjs").is_file()
assert (codex_home / "bin/context-mode-hook.mjs").is_file()
hooks = json.loads((codex_home / "hooks.json").read_text())
assert set(hooks["hooks"]) == {
    "PreToolUse", "PostToolUse", "SessionStart", "PreCompact", "UserPromptSubmit", "Stop"
}
for entries in hooks["hooks"].values():
    assert any("context-mode-hook.mjs" in hook["command"] for entry in entries for hook in entry["hooks"])
PY

CODEX_HOME="$codex_home" node "$root/scripts/verify-gestalt-skill-catalog.mjs" "$root" \
  >"$codex_home/skills-catalog.out"
grep -F 'verified 13 enabled Gestalt skills in skills/list' "$codex_home/skills-catalog.out" >/dev/null

context_version=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).installed.find(x => x.name === 'context-mode').version" "$codex_home/plugins.json")
context_cache="$codex_home/plugins/cache/dyne-gestalt-agents/context-mode/$context_version"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"codex-install-smoke","version":"1"}}}' |
  timeout 20s env CODEX_HOME="$codex_home" GESTALT_HOME="$gestalt_home" CONTEXT_MODE_WORKSPACE="$workspace" \
    node "$context_cache/start.mjs" >"$codex_home/mcp.out"
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

CODEX_HOME="$codex_home" GESTALT_HOME="$gestalt_home" \
  node "$root/tests/helpers/assert-codex-mcp-tools.mjs" "$workspace" \
    ctx_execute ctx_execute_file ctx_batch_execute ctx_index ctx_search

before=$(sha256sum \
  "$codex_home/config.toml" \
  "$codex_home/hooks.json" \
  "$codex_home/bin/context-mode-mcp.mjs" \
  "$codex_home/bin/context-mode-hook.mjs")
CODEX_HOME="$codex_home" GESTALT_HOME="$gestalt_home" CONTEXT_MODE_PACKAGE_MANAGER=npm \
  bash "$root/gestalt-setup.sh" >/dev/null
after=$(sha256sum \
  "$codex_home/config.toml" \
  "$codex_home/hooks.json" \
  "$codex_home/bin/context-mode-mcp.mjs" \
  "$codex_home/bin/context-mode-hook.mjs")
test "$before" = "$after"

printf 'Codex marketplace installation smoke test passed\n'
