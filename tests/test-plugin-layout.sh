#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 - "$root" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
plugin = root / "plugins" / "gestalt"
expected_skills = {
    "org-plan",
    "systematic-debugging",
    "development-testing",
    "verification-before-completion",
    "writing-skills",
}

assert not (root / "skills" / "org-plan").exists(), "root skill copy must not exist"
assert not (root / "plugins" / "org-plan").exists(), "legacy org-plan plugin must not exist"
assert not (root / "plugins" / "superpowers").exists(), "legacy superpowers plugin must not exist"

plugin_manifest = json.loads((plugin / ".codex-plugin" / "plugin.json").read_text())
assert plugin_manifest["name"] == "gestalt"
assert plugin_manifest["interface"]["displayName"] == "Dyne.org Gestalt"
assert plugin_manifest["skills"] == "./skills/"
assert plugin_manifest["repository"] == "https://github.com/dyne/gestalt-agents"
assert plugin_manifest["license"] == "MIT"

manifests = [
    json.loads(path.read_text())
    for path in sorted((root / "plugins").glob("*/.codex-plugin/plugin.json"))
]
versions = {manifest["version"] for manifest in manifests}
assert len(manifests) == 1, "there must be exactly one plugin manifest"
assert len(versions) == 1, f"plugin versions differ: {sorted(versions)}"
version = versions.pop()
assert re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version), (
    f"plugin version is not strict SemVer: {version}"
)

actual_skills = {
    path.parent.name
    for path in (plugin / "skills").glob("*/SKILL.md")
}
assert actual_skills == expected_skills

marketplace = json.loads((root / ".agents" / "plugins" / "marketplace.json").read_text())
assert marketplace["name"] == "dyne-gestalt-agents"
assert marketplace["interface"]["displayName"] == "Dyne.org Gestalt"
assert len(marketplace["plugins"]) == 1
entry = marketplace["plugins"][0]
assert entry["name"] == "gestalt"
assert entry["source"] == {"source": "local", "path": "./plugins/gestalt"}
assert entry["policy"] == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}
assert entry["category"] == "Developer Tools"

frontmatter = (plugin / "skills" / "org-plan" / "SKILL.md").read_text().split("---", 2)[1]
assert "name: org-plan" in frontmatter
PY

printf 'plugin layout is valid\n'
