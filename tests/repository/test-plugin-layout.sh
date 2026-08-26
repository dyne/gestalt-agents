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
    "context-mode",
    "ctx-doctor",
    "ctx-index",
    "ctx-insight",
    "ctx-purge",
    "ctx-search",
    "ctx-stats",
    "ctx-upgrade",
    "org-plan",
    "systematic-debugging",
    "development-testing",
    "verification-before-completion",
    "writing-skills",
}

assert not (root / "skills" / "org-plan").exists(), "root skill copy must not exist"
assert not (root / "plugins" / "org-plan").exists(), "legacy org-plan plugin must not exist"

plugin_manifest = json.loads((plugin / ".codex-plugin" / "plugin.json").read_text())
assert plugin_manifest["name"] == "gestalt"
assert plugin_manifest["interface"]["displayName"] == "org-plan"
assert plugin_manifest["skills"] == "./skills/"
assert plugin_manifest["repository"] == "https://github.com/dyne/gestalt-agents"
assert plugin_manifest["license"] == "MIT"

manifests = {
    path.parent.parent.name: json.loads(path.read_text())
    for path in sorted((root / "plugins").glob("*/.codex-plugin/plugin.json"))
}
assert set(manifests) == {"gestalt", "context-mode"}, f"unexpected plugin manifests: {sorted(manifests)}"
assert all(manifest["name"] == name for name, manifest in manifests.items())
assert manifests["gestalt"]["version"] == manifests["context-mode"]["version"], (
    "marketplace plugin versions must stay synchronized"
)
context_package = json.loads((root / "plugins/context-mode/package.json").read_text())
assert context_package["version"] == manifests["gestalt"]["version"], (
    "context-mode runtime and marketplace versions must stay synchronized"
)
assert "skills" not in manifests["context-mode"], "context-mode skills must be owned by Gestalt"
for name, manifest in manifests.items():
    assert re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?", manifest["version"]), (
        f"{name} version is not SemVer: {manifest['version']}"
    )
context_interface = manifests["context-mode"]["interface"]
assert "hooks" not in manifests["context-mode"], "default hook discovery needs no override"
for key in ("longDescription", "capabilities", "defaultPrompt"):
    assert context_interface.get(key), f"context-mode interface metadata is missing: {key}"
assert (root / "plugins" / "context-mode" / "hooks" / "hooks.json").is_file(), (
    "context-mode default hooks manifest is missing"
)

actual_skills = {
    path.parent.name
    for path in (plugin / "skills").glob("*/SKILL.md")
}
assert actual_skills == expected_skills
assert not (root / "plugins" / "context-mode" / "skills").exists(), (
    "context-mode must not carry a second skill provider"
)
assert (root / "scripts" / "verify-gestalt-skill-catalog.mjs").is_file(), (
    "real app-server skill catalog verifier is missing"
)

context_package = json.loads((root / "plugins" / "context-mode" / "package.json").read_text())
assert context_package.get("private") is True, "context-mode must not be publishable to npm"
for key in ("bin", "exports", "files"):
    assert key not in context_package, f"npm publication field remains: {key}"
assert "prepublishOnly" not in context_package.get("scripts", {}), (
    "npm publication lifecycle remains"
)
assert not (root / "plugins" / "context-mode" / ".npmignore").exists(), (
    "npm publication ignore file remains"
)

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
assert "Do not use for ordinary bounded single-session tasks." in frontmatter

org_plan_skill = (plugin / "skills" / "org-plan" / "SKILL.md").read_text()
for routing_contract in (
    "Use Codex's native planning surfaces when useful for small",
    "Straightforward implementation tasks do",
    "not require a persisted plan.",
    "Select Org Plan only when the user explicitly requests it",
    "execution across sessions or context compaction;",
    "inspectable workspace-local durability;",
    "L1/L2 milestone hierarchy or explicit skill assignment;",
    "supervised subagent ownership;",
    "review, accept, or reject transitions and evidence gates;",
    "one commit per accepted milestone;",
    "mobile attention or supervision.",
):
    assert routing_contract in org_plan_skill, f"org-plan skill lacks routing contract: {routing_contract}"
for contract in (
    "<workspace-root>/.gestalt/<topic>.org",
    "A Git repository root never redefines the supplied",
    "Never stage, commit, or otherwise introduce one into",
    "This absolute prohibition cannot be overridden by",
    "Do not mention that the local `.gestalt` Org",
    "git diff --cached --name-only",
):
    assert contract in org_plan_skill, f"org-plan skill lacks workspace-local contract: {contract}"
assert "Do not commit Org plan files unless the governing repository or user" not in org_plan_skill, (
    "org-plan skill retains the permissive plan-commit exception"
)

readme = (root / "README.md").read_text()
for contract in (
    "Node.js 22.5",
    "gestalt-setup.sh",
    "CONTEXT_MODE_NOT_PREPARED",
    "side-effect free",
    "codex plugin list --marketplace dyne-gestalt-agents --json",
    "ctx-doctor",
    "Do not add duplicate MCP or hook configuration",
    "Context-mode transports evidence; it does not spawn agents",
):
    assert contract in readme, f"README lacks context-mode contract: {contract}"

for upgrade_contract in (
    "codex plugin marketplace upgrade dyne-gestalt-agents",
    'export CODEX_HOME="$HOME/.codex-gestalt"',
    "generates `org-plan-reviewer` and `org-plan-executor`",
    "~/.codex-gestalt/agents/org-plan-supervisor.toml",
    "agents.max_depth = 2",
    "does not create, validate, or",
    "features.plugin_hooks",
    "./gestalt-setup.sh --force",
):
    assert upgrade_contract in readme, f"README lacks upgrade contract: {upgrade_contract}"

context_skill = (plugin / "skills" / "context-mode" / "SKILL.md").read_text()
for contract in (
    "## Org Plan execution",
    "Context-mode transports evidence; it does not spawn agents",
    "In solo execution",
    "In supervised execution",
    "every agent session as an independent context",
    "Do not add `$gestalt:context-mode`",
):
    assert contract in context_skill, f"context-mode skill lacks Org Plan contract: {contract}"

fixture = root / "tests" / "plugins" / "context-mode" / "fixtures" / "context-mode-codex-hardening-4b1348d.sha256"
fixture_paths = {
    f"plugins/context-mode/{line.split('  ', 1)[1]}"
    for line in fixture.read_text().splitlines()
}
distributable_paths = set(subprocess.check_output(
    ["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "plugins/context-mode"],
    text=True,
).splitlines())
missing_paths = sorted(fixture_paths - distributable_paths)
assert not missing_paths, f"vendored fixture paths are missing or ignored: {missing_paths[:12]}"
PY

printf 'plugin layout is valid\n'
