#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
codex_home=$(mktemp -d "$root/.codex-marketplace-smoke.XXXXXX")
trap 'rm -rf "$codex_home"' EXIT HUP INT TERM

CODEX_HOME="$codex_home" codex plugin marketplace add "$root" >/dev/null
mkdir -p "$codex_home/agents"
printf 'legacy supervisor\n' >"$codex_home/agents/org-plan-supervisor.toml"
printf 'approval_policy = "never"\n' >"$codex_home/config.toml"
CODEX_HOME="$codex_home" bash "$root/gestalt-setup.sh" >/dev/null
CODEX_HOME="$codex_home" codex plugin list \
  --marketplace dyne-gestalt-agents --json >"$codex_home/plugins.json"

python3 - "$codex_home/plugins.json" "$codex_home" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
installed = {item["name"]: item for item in payload["installed"]}
assert set(installed) == {"gestalt", "context-mode"}, installed
assert all(item["installed"] and item["enabled"] for item in installed.values())
assert all(item["marketplaceName"] == "dyne-gestalt-agents" for item in installed.values())

codex_home = Path(sys.argv[2])
gestalt = codex_home / "plugins/cache/dyne-gestalt-agents/gestalt" / installed["gestalt"]["version"]
context_mode = codex_home / "plugins/cache/dyne-gestalt-agents/context-mode" / installed["context-mode"]["version"]
assert (gestalt / "skills/org-plan/SKILL.md").is_file()
assert (context_mode / "hooks/hooks.json").is_file()
assert (context_mode / ".mcp.json").is_file()
assert (context_mode / ".context-mode-prepared.json").is_file()
assert (codex_home / "agents/org-plan-reviewer.toml").is_file()
assert (codex_home / "agents/org-plan-executor.toml").is_file()
assert not (codex_home / "agents/org-plan-supervisor.toml").exists()
assert 'approval_policy = "never"' in (codex_home / "config.toml").read_text()
PY

printf 'Codex marketplace installation smoke test passed\n'
