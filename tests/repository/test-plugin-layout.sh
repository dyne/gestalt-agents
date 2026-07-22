#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
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

manifests = {
    path.parent.parent.name: json.loads(path.read_text())
    for path in sorted((root / "plugins").glob("*/.codex-plugin/plugin.json"))
}
assert set(manifests) == {"gestalt", "context-mode"}, f"unexpected plugin manifests: {sorted(manifests)}"
assert all(manifest["name"] == name for name, manifest in manifests.items())
for name, manifest in manifests.items():
    assert re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", manifest["version"]), (
        f"{name} version is not strict SemVer: {manifest['version']}"
    )

actual_skills = {
    path.parent.name
    for path in (plugin / "skills").glob("*/SKILL.md")
}
assert actual_skills == expected_skills

marketplace = json.loads((root / ".agents" / "plugins" / "marketplace.json").read_text())
assert marketplace["name"] == "dyne-gestalt-agents"
assert marketplace["interface"]["displayName"] == "Dyne.org Gestalt"
assert marketplace["plugins"] == [
    {
        "name": "gestalt",
        "source": {"source": "local", "path": "./plugins/gestalt"},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "category": "Developer Tools",
    },
    {
        "name": "context-mode",
        "source": {"source": "local", "path": "./plugins/context-mode"},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "category": "Productivity",
    },
]
for entry in marketplace["plugins"]:
    manifest = manifests[entry["name"]]
    assert Path(entry["source"]["path"]).parts == ("plugins", entry["name"])
    for value in (manifest.get("skills", ""), manifest.get("hooks", ""), manifest.get("mcpServers", "")):
        if isinstance(value, str) and value.startswith("./"):
            assert (root / "plugins" / entry["name"] / value[2:]).exists(), value

frontmatter = (plugin / "skills" / "org-plan" / "SKILL.md").read_text().split("---", 2)[1]
assert "name: org-plan" in frontmatter
PY

printf 'plugin layout is valid\n'
