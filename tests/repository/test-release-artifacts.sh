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
    ".codex-plugin/plugin.json", "LICENSE", "skills/org-plan/SKILL.md",
    "skills/org-plan/agents/openai.yaml", "skills/org-plan/plan-template.org",
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
        assert bundle.read(f"skills/org-plan/{target}") == (desktop_source / source).read_bytes()
    manifest = json.loads(bundle.read(".codex-plugin/plugin.json"))
    expected_manifest = json.loads((desktop_source / "plugin.json.in").read_text())
    expected_manifest["version"] = tag.removeprefix("v")
    assert manifest == expected_manifest
    assert manifest["name"] == "org-plan"
    assert manifest["version"] == tag.removeprefix("v")
    assert manifest["skills"] == "./skills/"
    assert manifest["author"] == {"name": "Dyne.org foundation", "url": "https://dyne.org/gestalt"}
    assert manifest["homepage"] == "https://dyne.org/gestalt"
    assert manifest["repository"] == "https://github.com/dyne/gestalt-agents"
    assert manifest["license"] == "MIT"
    assert manifest["interface"]["developerName"] == "Dyne.org foundation"
    assert manifest["interface"]["websiteURL"] == "https://dyne.org/gestalt"
    assert "Copyright (c) 2026 Dyne.org foundation" in manifest["interface"]["longDescription"]
    assert bundle.read("LICENSE") == (desktop_source / "LICENSE").read_bytes()
    assert b"Copyright (c) 2026 Dyne.org foundation" in bundle.read("LICENSE")
    assert b"Copyright (c) 2025 Jesse Vincent" in bundle.read("LICENSE")
    instructions = bundle.read("skills/org-plan/SKILL.md").decode()
    assert instructions.startswith("---\nname: org-plan\ndescription: ")
    assert len(instructions.split("---", 2)) == 3
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", instructions):
        assert f"skills/org-plan/{target}" in skill_entries, target
    bundle.extractall(artifacts / "standalone")

# Validate the plugin that will be imported, including the declared skill path
# and UI metadata. A plain skill directory must no longer satisfy this check.
subprocess.run([
    "ruby", str(root / "scripts/validate-codex-packages.rb"), str(artifacts / "standalone"),
], check=True, capture_output=True)
assert {path.name for path in (artifacts / "standalone/skills").iterdir()} == {"org-plan"}

# Validate the delivered template using the production parser, without a
# Gestalt installation or any lifecycle mutation. Placeholder skill names are
# syntactically valid but explicitly do not establish execution readiness.
subprocess.run([
    "bash", str(root / "plugins/gestalt/skills/org-plan/scripts/org-plan"),
    "validate", str(artifacts / "standalone/skills/org-plan/plan-template.org"),
], check=True, capture_output=True)

bundle_entries = regular_entries(artifacts / f"gestalt-agents-{tag}.zip")
assert ".agents/plugins/marketplace.json" in bundle_entries
assert "gestalt-setup.sh" in bundle_entries
assert "scripts/install-managed-commands.mjs" in bundle_entries
assert "scripts/install-org-plan.mjs" in bundle_entries
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
    "plugins/gestalt/gestalt-startup-contract.json",
    "plugins/gestalt/startup/bootstrap.md",
    "plugins/gestalt/startup/README.md",
    "plugins/gestalt/startup/delivery-scenarios.json",
    "plugins/gestalt/scripts/startup-contract.mjs",
    "scripts/install-org-plan.mjs",
    "plugins/context-mode/scripts/runtime-lock.mjs",
    "plugins/context-mode/scripts/install-runtime.mjs",
    "plugins/context-mode/scripts/prepare-runtime.mjs",
    "plugins/context-mode/scripts/runtime-preflight.mjs",
    "plugins/gestalt/skills/org-plan/SKILL.md",
    "plugins/gestalt/skills/org-plan/references/supervised-execution.md",
    "plugins/gestalt/skills/org-plan/references/evidence-report.md",
    "plugins/gestalt/skills/org-plan/references/continuity-ledger.md",
    "plugins/gestalt/skills/org-plan/references/plan-format.md",
    "plugins/gestalt/skills/context-mode/SKILL.md",
    "plugins/gestalt/skills/context-mode/references/bounded-retrieval.md",
    "plugins/gestalt/skills/ctx-search/SKILL.md",
    "plugins/gestalt/LICENSE",
) + tuple(str(path.relative_to(root)) for path in
          sorted((root / "plugins/gestalt/skills/org-plan/scripts").iterdir()))
delivered = artifacts / "instruction-delivery"
delivered.mkdir()
with zipfile.ZipFile(artifacts / f"gestalt-agents-{tag}.zip") as bundle:
    for relative in instruction_paths:
        assert bundle.read(relative) == (root / relative).read_bytes(), relative
        entry = bundle.getinfo(relative)
        unix_mode = entry.external_attr >> 16
        assert not entry.is_dir() and stat.S_IFMT(unix_mode) in (0, stat.S_IFREG), relative
        # Git ZIP uses DOS metadata with no Unix mode for ordinary files;
        # executable entries carry a full POSIX regular-file mode instead.
        mode = stat.S_IMODE(unix_mode) if entry.create_system == 3 and unix_mode else 0o644
        expected_mode = 0o755 if (root / relative).stat().st_mode & 0o111 else 0o644
        assert mode == expected_mode, f"unexpected delivered mode: {relative}"
        bundle.extract(relative, delivered)
        (delivered / relative).chmod(mode)
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

# Install the delivered publisher and its delivered dependency/bundle bytes,
# then use the installed public command. This detects missing release inputs.
delivered_alias = artifacts / "delivery-alias"
delivered_alias.symlink_to(delivered.resolve(), target_is_directory=True)
alias_entry = delivered_alias / "scripts/install-org-plan.mjs"
assert alias_entry != alias_entry.resolve(), "CLI alias precondition was not established"
entries = (
    ("canonical", [], delivered.resolve() / "scripts/install-org-plan.mjs"),
    ("absolute-alias", [], alias_entry),
    ("relative-alias", [], alias_entry.relative_to(artifacts)),
    ("preserved-alias", ["--preserve-symlinks-main"], alias_entry),
)
for label, options, entry in entries:
    installed_home = artifacts / ("installed-delivery-" + label)
    installed_home.mkdir()
    installation = subprocess.run(["node", *options, str(entry),
                                   str(delivered), str(installed_home)],
                                  cwd=artifacts, capture_output=True, text=True)
    assert installation.returncode == 0, (
        f"delivered Org publisher {label} failed (exit {installation.returncode}): "
        f"{installation.stderr[-1500:]}"
    )
    public_helper = installed_home / "bin/org-plan"
    assert public_helper.is_file(), f"delivered Org publisher {label} silently skipped installation"
    assert "Org helper bundle installed:" in installation.stdout, label
    subprocess.run([str(public_helper), "validate",
                    str(artifacts / "standalone/skills/org-plan/plan-template.org")],
                   check=True, capture_output=True)
    installed_profiles = artifacts / ("installed-profiles-" + label)
    subprocess.run([str(public_helper), "prepare-supervision", "--agents-dir",
                    str(installed_profiles)], check=True, capture_output=True)
    for role in ("reviewer", "executor"):
        name = f"org-plan-{role}.toml"
        assert (installed_profiles / name).read_bytes() == (artifacts / "source-profiles" / name).read_bytes()

invalid_home = artifacts / "invalid-arity-home"
for arguments in ([], [str(delivered)], [str(delivered), str(invalid_home), "extra"]):
    invalid = subprocess.run(["node", str(alias_entry), *arguments],
                             cwd=artifacts, capture_output=True, text=True)
    assert invalid.returncode == 1 and "usage: install-org-plan.mjs" in invalid.stderr
    assert invalid.stdout == "" and not invalid_home.exists()

# Import the actual delivered module through Node's eval/stdin entry modes.
# Valid installation operands make an accidental CLI dispatch observable.
import_home = artifacts / "library-import-home"
import_home.mkdir()
unrelated_entry = artifacts / "unrelated-entry.mjs"
unrelated_entry.write_text("// Existing unrelated entry for the library import probe.\n")
missing_entry = artifacts / "missing-entry.mjs"
assert not missing_entry.exists()
for label, entry_args, expected_entry, operands in (
    ("eval", ["--eval"], None, []),
    ("stdin", ["-"], "-", [str(delivered), str(import_home)]),
    ("unrelated", ["--eval"], str(unrelated_entry), [str(unrelated_entry), str(delivered), str(import_home)]),
    ("nonexistent", ["--eval"], str(missing_entry), [str(missing_entry), str(delivered), str(import_home)]),
):
    code = (
        f"if ((process.argv[1] ?? null) !== {json.dumps(expected_entry)}) throw new Error('wrong import entry');\n"
        f"const module = await import({json.dumps(alias_entry.as_uri())});\n"
        "if (typeof module.installOrgPlan !== 'function') throw new Error('publisher import missing');\n"
    )
    command = ["node", "--input-type=module", *entry_args]
    if entry_args == ["--eval"]:
        command.append(code)
    imported = subprocess.run([*command, *operands], input=code if label == "stdin" else None,
                              cwd=artifacts, capture_output=True, text=True)
    assert imported.returncode == 0, (label, imported.stderr)
    assert imported.stdout == "" and imported.stderr == "", label
    assert list(import_home.iterdir()) == [], f"{label} import installed a helper"

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
        "scripts/install-org-plan.mjs",
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
