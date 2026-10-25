#!/usr/bin/env bash
set -euo pipefail

source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/release-artifacts-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
# Production archives HEAD. Test the current distributable content in an
# isolated Git fixture so newly authored skills are verified before acceptance,
# without staging or committing anything in the source repository.
root="$tmp/repository"
python3 - "$source_root" "$root" <<'PY'
import shutil
import subprocess
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:])
paths = subprocess.check_output(
    ["git", "-C", str(source), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
).decode().split("\0")
for name in paths:
    if not name or (".gestalt" in Path(name).parts and name.endswith(".org")):
        continue
    path = source / name
    if not path.is_file():
        continue
    destination = target / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination, follow_symlinks=False)
PY
git -C "$root" init -q
# Keep fixture cleanup deterministic: commits must not leave background Git
# maintenance writing into the disposable repository after validation finishes.
git -C "$root" config maintenance.auto false
git -C "$root" config gc.auto 0
git -C "$root" add -- .
git -C "$root" -c user.name='Release fixture' -c user.email='fixture@example.invalid' \
  -c commit.gpgsign=false commit -qm 'test: snapshot distributable fixture'

version=$(python3 - "$root/plugins/gestalt/.codex-plugin/plugin.json" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text())["version"])
PY
)
tag="v$version"
artifacts="$tmp/dist"

"$root/scripts/build-release-artifacts.sh" "$tag" "$artifacts"

python3 - "$root" "$artifacts" "$tag" <<'PY'
import hashlib
import json
import re
import stat
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path, PurePosixPath

root = Path(sys.argv[1])
artifacts = Path(sys.argv[2])
tag = sys.argv[3]
skills = sorted(path.parent.name for path in (root / "plugins/gestalt/skills").glob("*/SKILL.md"))
expected = {f"gestalt-agents-{tag}.zip", f"org-plan-{tag}.zip"}
actual = {path.name for path in artifacts.glob("*.zip")}
assert actual == expected, (actual, expected)

def regular_entries(archive: Path) -> set[str]:
    with zipfile.ZipFile(archive) as bundle:
        names = {entry.filename for entry in bundle.infolist() if not entry.is_dir()}
    for name in names:
        path = PurePosixPath(name)
        assert not path.is_absolute(), name
        assert ".." not in path.parts, name
    return names

skill_archive = artifacts / f"org-plan-{tag}.zip"
skill_entries = regular_entries(skill_archive)
assert skill_entries == {
    "org-plan/SKILL.md", "org-plan/agents/openai.yaml", "org-plan/plan-template.org",
}
desktop_source = root / "plugins/gestalt/skills/org-plan/assets/desktop"
with zipfile.ZipFile(skill_archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.infolist()) == len(skill_entries), "duplicate ZIP entries"
    for entry in bundle.infolist():
        assert stat.S_ISREG(entry.external_attr >> 16), entry.filename
    for source, target in (("SKILL.md.in", "SKILL.md"),
                           ("openai.yaml", "agents/openai.yaml"),
                           ("plan-template.org.in", "plan-template.org")):
        assert bundle.read(f"org-plan/{target}") == (desktop_source / source).read_bytes()
    instructions = bundle.read("org-plan/SKILL.md").decode()
    assert instructions.startswith("---\nname: org-plan\ndescription: ")
    assert len(instructions.split("---", 2)) == 3
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", instructions):
        assert f"org-plan/{target}" in skill_entries, target
    bundle.extractall(artifacts / "standalone")

# Validate the delivered template using the production parser, without a
# Gestalt installation or any lifecycle mutation. Placeholder skill names are
# syntactically valid but explicitly do not establish execution readiness.
subprocess.run([
    "bash", str(root / "plugins/gestalt/skills/org-plan/scripts/org-plan"),
    "validate", str(artifacts / "standalone/org-plan/plan-template.org"),
], check=True, capture_output=True)

bundle_entries = regular_entries(artifacts / f"gestalt-agents-{tag}.zip")
assert ".agents/plugins/marketplace.json" in bundle_entries
assert "gestalt-setup.sh" in bundle_entries
assert "scripts/install-managed-commands.mjs" in bundle_entries
assert "scripts/verify-gestalt-skill-catalog.mjs" in bundle_entries
assert "README.md" in bundle_entries
assert "USAGE.md" in bundle_entries
assert "plugins/gestalt/.codex-plugin/plugin.json" in bundle_entries
assert "plugins/gestalt/.mcp.json" in bundle_entries
assert "plugins/context-mode/.codex-plugin/plugin.json" in bundle_entries
assert "plugins/context-mode/.mcp.json" in bundle_entries
assert "plugins/context-mode/package.json" in bundle_entries
assert {f"plugins/gestalt/skills/{skill}/SKILL.md" for skill in skills} <= bundle_entries

# Check delivered bytes, not only filenames. Generate profiles from the actual
# archive helper in isolation so a stale bootstrap cannot pass source tests.
instruction_paths = (
    "plugins/gestalt/skills/org-plan/SKILL.md",
    "plugins/gestalt/skills/org-plan/references/supervised-execution.md",
    "plugins/gestalt/skills/org-plan/references/evidence-report.md",
    "plugins/gestalt/skills/org-plan/references/continuity-ledger.md",
    "plugins/gestalt/skills/org-plan/references/plan-format.md",
    "plugins/gestalt/skills/context-mode/SKILL.md",
    "plugins/gestalt/skills/context-mode/references/bounded-retrieval.md",
    "plugins/gestalt/skills/ctx-search/SKILL.md",
    "plugins/gestalt/skills/org-plan/scripts/org-plan",
)
delivered = artifacts / "instruction-delivery"
delivered.mkdir()
with zipfile.ZipFile(artifacts / f"gestalt-agents-{tag}.zip") as bundle:
    for relative in instruction_paths:
        assert bundle.read(relative) == (root / relative).read_bytes(), relative
        bundle.extract(relative, delivered)
    gestalt = json.loads(bundle.read("plugins/gestalt/.codex-plugin/plugin.json"))
    context = json.loads(bundle.read("plugins/context-mode/.codex-plugin/plugin.json"))
    assert gestalt["skills"] == "./skills/"
    assert "skills" not in context, "duplicate active routing-skill provider"

helper = "plugins/gestalt/skills/org-plan/scripts/org-plan"
for source, destination in ((root, artifacts / "source-profiles"),
                            (delivered, artifacts / "delivered-profiles")):
    subprocess.run(["bash", str(source / helper), "prepare-supervision",
                    "--agents-dir", str(destination)], check=True, capture_output=True)
for role in ("reviewer", "executor"):
    relative = f"org-plan-{role}.toml"
    source = (artifacts / "source-profiles" / relative).read_bytes()
    actual = (artifacts / "delivered-profiles" / relative).read_bytes()
    assert actual == source, f"stale delivered profile: {role}"
    profile = tomllib.loads(actual.decode())
    assert "supervised-execution reference" in profile["developer_instructions"]

checksum_lines = (artifacts / "SHA256SUMS").read_text().splitlines()
assert len(checksum_lines) == len(expected)
for line in checksum_lines:
    digest, name = line.split("  ", 1)
    payload = (artifacts / name).read_bytes()
    assert name in expected
    assert hashlib.sha256(payload).hexdigest() == digest

tracked = subprocess.check_output(
    [
        "git", "-C", str(root), "ls-tree", "-r", "--name-only", "HEAD", "--",
        ".agents/plugins/marketplace.json", "README.md", "USAGE.md", "gestalt-setup.sh",
        "scripts/install-managed-commands.mjs", "scripts/verify-gestalt-skill-catalog.mjs",
        "plugins/gestalt", "plugins/context-mode",
    ],
    text=True,
).splitlines()
assert set(tracked) == bundle_entries
PY

if "$root/scripts/build-release-artifacts.sh" "$tag" "$artifacts" 2>/dev/null; then
  printf 'packager unexpectedly accepted an existing output path\n' >&2
  exit 1
fi
if "$root/scripts/build-release-artifacts.sh" latest "$tmp/latest" 2>/dev/null; then
  printf 'packager unexpectedly accepted an invalid release tag\n' >&2
  exit 1
fi
if "$root/scripts/build-release-artifacts.sh" v1.0.0 "$tmp/v1" 2>/dev/null; then
  printf 'packager unexpectedly accepted a pre-v2 release tag\n' >&2
  exit 1
fi

printf 'release marketplace and standalone skill bundles are complete\n'
