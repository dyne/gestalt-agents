#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
helper="$root/plugins/gestalt/skills/org-plan/scripts/org-plan"
fixture="$root/tests/plugins/gestalt/fixtures/org-plan-attention-contract.json"
skill="$root/plugins/gestalt/skills/org-plan/SKILL.md"
supervised="$root/plugins/gestalt/skills/org-plan/references/supervised-execution.md"
protocol="$root/plugins/gestalt/skills/org-plan/references/attention-protocol.md"
agents="$root/AGENTS.md"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/org-plan-attention-test.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM

python3 - "$fixture" "$skill" "$supervised" "$protocol" "$agents" <<'PY'
import json
import sys
from pathlib import Path

fixture = json.loads(Path(sys.argv[1]).read_text())
skill, supervised, protocol, agents = (Path(path).read_text() for path in sys.argv[2:])
normalised_skill = " ".join(skill.split())
assert fixture["schemaVersion"] == 1
assert fixture["toolName"] == "gestalt_org_plan_attention"
assert len(fixture["reasons"]) == len(fixture["resumeConditions"]) == 6
for reason, resume in zip(fixture["reasons"], fixture["resumeConditions"]):
    for text in (skill, supervised):
        assert f"`{reason}`" in text and f"`{resume}`" in text
for scenario in fixture["scenarios"]:
    assert scenario["reason"] in fixture["reasons"]
    assert scenario["positive"] in normalised_skill
    assert scenario["negative"] in normalised_skill
for text in (skill, supervised, protocol, agents):
    assert fixture["toolName"] in text
assert "fail closed" in protocol
assert "optional" in protocol
PY

agents_dir="$tmp/agents"
output=$("$helper" prepare-supervision --agents-dir "$agents_dir")
[[ $output == *"executor_profile="* && $output == *"root_reviewer_profile="* ]]

python3 - "$fixture" "$agents_dir/org-plan-reviewer.toml" "$agents_dir/org-plan-executor.toml" <<'PY'
import json
import sys
from pathlib import Path

fixture = json.loads(Path(sys.argv[1]).read_text())
for profile_path in sys.argv[2:]:
    profile = Path(profile_path).read_text()
    assert profile.count(fixture["toolName"]) == 1, profile_path
    assert "schema version is 1" in profile
    assert "synthetic control input" in profile
    assert "waiting on a live child" in profile
    assert "diagnosable or recoverable test failures" in profile
    for reason, resume in zip(fixture["reasons"], fixture["resumeConditions"]):
        assert f"{reason}/{resume}" in profile
PY

"$helper" --help >"$tmp/help" 2>&1
grep -F 'prepare-executor|prepare-supervision' "$tmp/help" >/dev/null
printf 'org-plan attention contract is valid\n'
