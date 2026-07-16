#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 - "$root" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
plugin = root / "plugins" / "org-plan"
skill = plugin / "skills" / "org-plan"

assert not (root / "skills" / "org-plan").exists(), "root skill copy must not exist"
assert (skill / "SKILL.md").is_file(), "nested skill is missing"

plugin_manifest = json.loads((plugin / ".codex-plugin" / "plugin.json").read_text())
assert plugin_manifest["name"] == "org-plan"
assert plugin_manifest["version"] == "0.1.0"
assert plugin_manifest["skills"] == "./skills/"
assert plugin_manifest["repository"] == "https://github.com/dyne/agent-plugins"

marketplace = json.loads((root / ".agents" / "plugins" / "marketplace.json").read_text())
assert marketplace["name"] == "dyne-agent-plugins"
entry = next(item for item in marketplace["plugins"] if item["name"] == "org-plan")
assert entry["source"] == {"source": "local", "path": "./plugins/org-plan"}
assert entry["policy"] == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}

frontmatter = (skill / "SKILL.md").read_text().split("---", 2)[1]
assert "name: org-plan" in frontmatter
PY

printf 'plugin layout is valid\n'
