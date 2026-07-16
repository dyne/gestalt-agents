#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 - "$root" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
plugin = root / "plugins" / "org-plan"
skill = plugin / "skills" / "org-plan"
superpowers = root / "plugins" / "superpowers"
selected_skills = {
    "systematic-debugging",
    "development-testing",
    "verification-before-completion",
    "writing-skills",
}

assert not (root / "skills" / "org-plan").exists(), "root skill copy must not exist"
assert (skill / "SKILL.md").is_file(), "nested skill is missing"

plugin_manifest = json.loads((plugin / ".codex-plugin" / "plugin.json").read_text())
assert plugin_manifest["name"] == "org-plan"
assert plugin_manifest["interface"]["displayName"] == "Dyne Org Plan"
assert plugin_manifest["skills"] == "./skills/"
assert plugin_manifest["repository"] == "https://github.com/dyne/agent-plugins"

superpowers_manifest = json.loads(
    (superpowers / ".codex-plugin" / "plugin.json").read_text()
)
assert superpowers_manifest["name"] == "superpowers"
assert superpowers_manifest["interface"]["displayName"] == "Dyne Superpowers"
assert superpowers_manifest["skills"] == "./skills/"
assert superpowers_manifest["repository"] == "https://github.com/dyne/agent-plugins"
assert superpowers_manifest["license"] == "MIT"

manifests = [
    json.loads(path.read_text())
    for path in sorted((root / "plugins").glob("*/.codex-plugin/plugin.json"))
]
versions = {manifest["version"] for manifest in manifests}
assert len(versions) == 1, f"plugin versions differ: {sorted(versions)}"
version = versions.pop()
assert re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version), (
    f"plugin version is not strict SemVer: {version}"
)

actual_skills = {
    path.parent.name
    for path in (superpowers / "skills").glob("*/SKILL.md")
}
assert actual_skills == selected_skills

marketplace = json.loads((root / ".agents" / "plugins" / "marketplace.json").read_text())
assert marketplace["name"] == "dyne-agent-plugins"
entry = next(item for item in marketplace["plugins"] if item["name"] == "org-plan")
assert entry["source"] == {"source": "local", "path": "./plugins/org-plan"}
assert entry["policy"] == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}

superpowers_entry = next(
    item for item in marketplace["plugins"] if item["name"] == "superpowers"
)
assert superpowers_entry["source"] == {
    "source": "local",
    "path": "./plugins/superpowers",
}
assert superpowers_entry["policy"] == {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL",
}
assert superpowers_entry["category"] == "Developer Tools"

frontmatter = (skill / "SKILL.md").read_text().split("---", 2)[1]
assert "name: org-plan" in frontmatter
PY

printf 'plugin layout is valid\n'
