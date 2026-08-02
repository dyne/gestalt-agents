#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
validator="$root/scripts/validate-codex-packages.rb"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/codex-validation-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

ruby -c "$validator" >/dev/null
ruby "$validator" "$root/plugins/gestalt" "$root/plugins/context-mode"

mkdir -p "$tmp/context-mode/.codex-plugin"
cp "$root/plugins/context-mode/.codex-plugin/plugin.json" "$tmp/context-mode/.codex-plugin/plugin.json"
cp "$root/plugins/context-mode/.mcp.json" "$tmp/context-mode/.mcp.json"
python3 - "$tmp/context-mode/.codex-plugin/plugin.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = json.loads(path.read_text())
payload["hooks"] = "./hooks/hooks.json"
path.write_text(json.dumps(payload))
PY
if ruby "$validator" "$tmp/context-mode" >"$tmp/out" 2>"$tmp/err"; then
  printf 'validator accepted unsupported hooks field\n' >&2
  exit 1
fi
grep -F 'field `hooks` is not accepted' "$tmp/err" >/dev/null

mkdir -p "$tmp/gestalt/.codex-plugin" "$tmp/gestalt/skills/wrong-name"
cp "$root/plugins/gestalt/.codex-plugin/plugin.json" "$tmp/gestalt/.codex-plugin/plugin.json"
printf '%s\n' '---' 'name: another-name' 'description: Invalid fixture.' '---' '# Fixture' >"$tmp/gestalt/skills/wrong-name/SKILL.md"
if ruby "$validator" "$tmp/gestalt" >"$tmp/out" 2>"$tmp/err"; then
  printf 'validator accepted a skill whose name differs from its directory\n' >&2
  exit 1
fi
grep -F 'frontmatter name must match its directory' "$tmp/err" >/dev/null

printf 'Codex plugin and skill validator is valid\n'
