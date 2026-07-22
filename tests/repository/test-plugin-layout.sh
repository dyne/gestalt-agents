#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
python3 - "$root" <<'PY'
import json
import re
import subprocess
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

readme = (root / "README.md").read_text()
for contract in (
    "Node.js 22.5",
    "first MCP or Codex hook start",
    "atomic build lock",
    "codex plugin list --marketplace dyne-gestalt-agents --json",
    "ctx doctor",
    "do not add a duplicate",
    "Context-mode transports evidence; it does not spawn agents",
):
    assert contract in readme, f"README lacks context-mode contract: {contract}"

context_skill = (root / "plugins" / "context-mode" / "skills" / "context-mode" / "SKILL.md").read_text()
for contract in (
    "## Org Plan and agent execution",
    "Context-mode is an evidence transport for agents, not an orchestration system.",
    "Solo plans:",
    "Supervised plans:",
    "Session boundaries:",
    "does not silently add context-mode to an L1's",
):
    assert contract in context_skill, f"context-mode skill lacks Org Plan contract: {contract}"

fixture = root / "tests" / "plugins" / "context-mode" / "fixtures" / "context-mode-codex-hardening-4b1348d.sha256"
fixture_paths = {
    f"plugins/context-mode/{line.split('  ', 1)[1]}"
    for line in fixture.read_text().splitlines()
}
tracked_paths = set(subprocess.check_output(
    ["git", "-C", str(root), "ls-files", "plugins/context-mode"],
    text=True,
).splitlines())
missing_tracked = sorted(fixture_paths - tracked_paths)
assert not missing_tracked, f"vendored fixture paths are ignored or untracked: {missing_tracked[:12]}"
PY

printf 'plugin layout is valid\n'
