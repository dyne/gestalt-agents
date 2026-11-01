#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
script="$root/gestalt-setup.sh"

assert_contains() {
  local actual=$1 expected=$2 contract=$3
  if [[ $actual != *"$expected"* ]]; then
    printf 'FAIL: %s\nexpected output to contain: %s\nactual output:\n%s\n' \
      "$contract" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_absent() {
  local path=$1 contract=$2
  if [[ -e $path ]]; then
    printf 'FAIL: %s\nunexpected path exists: %s\n' "$contract" "$path" >&2
    exit 1
  fi
}

bash -n "$script"
help=$(bash "$script" --help)
assert_contains "$help" "--prepare-only" "help documents prepare-only"
assert_contains "$help" "--dry-run" "help documents dry-run"
assert_contains "$help" "--extra-skills" "help documents optional extra skills"
assert_contains "$help" "--extra-skills-only" "help documents standalone extra skills"
output=$(bash "$script" --prepare-only --dry-run)
assert_contains "$output" "install-runtime.mjs" "prepare-only invokes the external runtime installer"
assert_contains "$output" "context-mode external runtime is prepared" "prepare-only reports success"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/gestalt-setup-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
tmp_real=$(CDPATH='' cd -- "$tmp" && pwd -P)
output=$(env -u CODEX_HOME HOME="$tmp" bash "$script" --dry-run)
assert_contains "$output" "$tmp/.codex-gestalt" "dry-run uses the isolated default Codex home"
assert_contains "$output" "prepare-supervision" "dry-run prepares supervision profiles"
assert_contains "$output" "$tmp/.codex-gestalt/bin/org-plan" \
  "dry-run installs the stable Org Plan helper"
assert_contains "$output" "$root/scripts/install-org-plan.mjs" \
  "dry-run schedules the complete validated Org Plan bundle publisher"
assert_contains "$output" "org-plan-supervisor.toml" "dry-run removes the retired supervisor profile"
assert_contains "$output" "configure context-mode MCP and hooks" \
  "dry-run schedules native context-mode registration"
assert_contains "$output" "install-managed-commands.mjs" \
  "dry-run schedules stable public commands"
assert_absent "$tmp/.codex-gestalt" "dry-run does not create the Codex home"

# Exercise the exact publisher command emitted by setup, including normal Org
# commands through the uninstrumented public launcher on fresh and flat homes.
bundle_home="$tmp/bundle-home"
CODEX_HOME="$bundle_home" GESTALT_HOME="$tmp/bundle-gestalt" \
  bash "$script" --dry-run >"$tmp/bundle-install.out"
python3 - "$tmp/bundle-install.out" "$bundle_home" "$root" <<'PY_BUNDLE'
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tomllib
from pathlib import Path

output, home, root = map(Path, sys.argv[1:])
source_scripts = root / "plugins/gestalt/skills/org-plan/scripts"
publication_commands = []
for line in output.read_text().splitlines():
    if not line.startswith("DRY-RUN:"):
        continue
    args = shlex.split(line.removeprefix("DRY-RUN:"))
    if len(args) < 2 or args[1] != str(root / "scripts/install-org-plan.mjs"):
        continue
    assert args == ["node", str(root / "scripts/install-org-plan.mjs"), str(root), str(home)]
    publication_commands.append(args)
assert len(publication_commands) == 1
expected = {
    "org-plan", "org-plan-cli.mjs", "org-plan-core.mjs", "org-plan-files.mjs",
    "org-plan-parser.mjs", "org-plan-publication.mjs", "org-plan-transitions.mjs",
    "org-plan-model-policy.mjs", "org-plan-model-schema.mjs",
    "org-plan-executor-launch.mjs",
    "org-plan-effective-settings.mjs",
    "org-plan-model-comparison.mjs",
}
assert {path.name for path in source_scripts.iterdir()} == expected

# Same distribution has colocated plugin modules and a private stable bundle.
fixture = (root / "tests/plugins/gestalt/fixtures/valid-minimal.org").read_text()
first = fixture.replace("* TODO", "* DONE").replace("** TODO", "** DONE")
first = first.replace(":REVIEW_STATUS: UNREVIEWED", ":REVIEW_STATUS: REVIEWED")
second = first[first.index("\n* DONE"):].replace("DONE", "WIP")
second = second.replace("REVIEWED", "UNREVIEWED").replace("first-outcome", "dependent").replace("first-task", "dependent-task")
probe_env = dict(os.environ)
for key in list(probe_env):
    if key.startswith("GESTALT_MOBILE_ORG_PLAN_"):
        probe_env.pop(key)

for kind in ("fresh", "legacy-upgrade"):
    selected_home = home if kind == "fresh" else home.with_name("legacy-home")
    selected_home.mkdir()
    launcher = selected_home / "bin/org-plan"
    flat = selected_home / "lib/gestalt-org-plan"
    user_home = selected_home / "isolated-user-home"
    user_home.mkdir()
    probe_env.update(HOME=str(user_home), CODEX_HOME=str(selected_home), GESTALT_HOME=str(selected_home / "gestalt"))
    if kind == "legacy-upgrade":
        launcher.parent.mkdir()
        flat.mkdir(parents=True)
        shutil.copy2(source_scripts / "org-plan", launcher)
        for path in source_scripts.glob("*.mjs"):
            shutil.copy2(path, flat)
        before = {p.name: p.read_bytes() for p in flat.iterdir()}
    args = [*publication_commands[0][:-1], str(selected_home)]
    subprocess.run(args, check=True, env=probe_env, stdout=subprocess.DEVNULL)
    if kind == "legacy-upgrade":
        assert all((flat / name).read_bytes() == content for name, content in before.items())
    token = re.search(r"bundles/([0-9a-f-]{36})", launcher.read_text()).group(1)
    bundle = flat / "bundles" / token
    assert {p.name for p in bundle.iterdir()} == expected | {"LICENSE", ".publication.json"}
    assert stat.S_IMODE(launcher.stat().st_mode) == 0o755
    for name in expected | {"LICENSE"}:
        target = bundle / name
        source = root / "plugins/gestalt/LICENSE" if name == "LICENSE" else source_scripts / name
        assert target.is_file() and not target.is_symlink()
        assert target.read_bytes() == source.read_bytes(), name
        assert stat.S_IMODE(target.stat().st_mode) == (0o755 if name == "org-plan" else 0o644)

    def run(*args):
        output = subprocess.check_output([str(launcher), *args], text=True, env=probe_env)
        return json.loads(output) if output.startswith("{") else output

    assert "usage: org-plan" in run("--help")
    invalid = subprocess.run([str(launcher), "unknown-command"], env=probe_env, capture_output=True)
    assert invalid.returncode == 2 and b"usage: org-plan" in invalid.stderr
    profiles = selected_home / "public-profiles"
    run("prepare-supervision", "--agents-dir", str(profiles),
        "--executor-model", "fixture-executor", "--reviewer-model", "fixture-reviewer",
        "--executor-reasoning-effort", "high")
    executor = tomllib.loads((profiles / "org-plan-executor.toml").read_text())
    reviewer = tomllib.loads((profiles / "org-plan-reviewer.toml").read_text())
    assert executor["model"] == "fixture-executor" and executor["model_reasoning_effort"] == "high"
    assert reviewer["model"] == "fixture-reviewer" and reviewer["sandbox_mode"] == "read-only"
    plan = selected_home / "probe with spaces.org"
    plan.write_text(first + second)
    subprocess.run([str(launcher), "validate", str(plan)], check=True, stdout=subprocess.DEVNULL, env=probe_env)
    assert run("describe", str(plan), "dependent") == "L1 2/2 First outcome\nGoal: Test the helper.\nSkills: $make\n"
    assert run("suspend-reopen", str(plan), "dependent", "first-outcome")["after"][0]["state"] == "SUSPENDED"
    assert sum(x["status"] == "in_progress" for x in run("projection", str(plan))["plan"]) == 1
    run("set", str(plan), "first-outcome", "DONE")
    run("review", str(plan), "first-outcome", "REVIEWED")
    assert run("resume", str(plan), "dependent")["after"][0]["state"] == "WIP"
    assert plan.read_text() == first + second
    print(f"uninstrumented public helper compatibility: {kind} passed")
PY_BUNDLE

extra_output=$(env -u CODEX_HOME HOME="$tmp" bash "$script" --dry-run --extra-skills)
assert_contains "$extra_output" "install_extra_skills" \
  "extra-skills opt-in schedules the integrated installer"
assert_absent "$tmp/.gestalt" "dry-run does not install extra skills"

standalone_output=$(env -u CODEX_HOME HOME="$tmp" \
  bash "$script" --dry-run --extra-skills-only)
assert_contains "$standalone_output" "install_extra_skills" \
  "standalone mode schedules the integrated installer"
assert_contains "$standalone_output" "standalone curated extra-skills operation complete" \
  "standalone mode reports completion"
if [[ $standalone_output == *"install-runtime.mjs"* ||
      $standalone_output == *"codex plugin"* ||
      $standalone_output == *"prepare-supervision"* ]]; then
  printf 'FAIL: standalone extra-skills mode scheduled normal setup\n%s\n' \
    "$standalone_output" >&2
  exit 1
fi

if bash "$script" --prepare-only --extra-skills >"$tmp/incompatible.out" 2>&1; then
  printf 'FAIL: prepare-only accepted the extra-skills installation option\n' >&2
  exit 1
fi
if bash "$script" --force --extra-skills-only >"$tmp/only-incompatible.out" 2>&1; then
  printf 'FAIL: extra-skills-only accepted a normal setup option\n' >&2
  exit 1
fi

configured="$tmp/configured marketplace"
mkdir -p "$configured" "$tmp/bin"
cat >"$configured/gestalt-setup.sh" <<'SH'
#!/usr/bin/env bash
printf 'delegated home=%s args=' "$CODEX_HOME"
printf '<%s>' "$@"
printf '\n'
SH
cat >"$tmp/bin/codex" <<SH
#!/usr/bin/env bash
if [[ \$* == 'plugin marketplace list' ]]; then
  printf 'Marketplace  Path\n'
  printf 'dyne-gestalt-agents  %s\n' '$configured'
  exit 0
fi
exit 99
SH
chmod +x "$configured/gestalt-setup.sh" "$tmp/bin/codex"
configured_real=$(CDPATH='' cd -- "$configured" && pwd -P)
delegated=$(CODEX_HOME="$tmp/delegated-home" PATH="$tmp/bin:$PATH" \
  bash "$script" --force --extra-skills)
assert_contains "$delegated" "continuing from configured marketplace $configured_real" \
  "setup delegates to the canonical configured marketplace"
assert_contains "$delegated" \
  "delegated home=$tmp_real/delegated-home args=<--force><--extra-skills>" \
  "setup preserves Codex home and arguments while delegating"

printf 'gestalt setup script is valid\n'
