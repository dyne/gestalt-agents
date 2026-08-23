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
from copy import deepcopy
import sys
from pathlib import Path

def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"duplicate JSON key: {key}"
        result[key] = value
    return result

def validate(document):
    expected_mapping = {
        "planChange": "planRevision",
        "hardBlock": "externalStateChanged",
        "missingDependency": "dependencyInstalled",
        "permissionRequired": "permissionGranted",
        "externalState": "externalStateChanged",
        "materialAmbiguity": "userGuidance",
    }
    assert document["schemaVersion"] == 1
    assert document["toolName"] == "gestalt_org_plan_attention"
    assert document["reasons"] == list(expected_mapping)
    assert document["resumeConditions"] == [
        "userGuidance",
        "planRevision",
        "dependencyInstalled",
        "permissionGranted",
        "externalStateChanged",
    ]
    assert document["reasonResumeConditions"] == expected_mapping
    assert {scenario["reason"] for scenario in document["scenarios"]} == set(expected_mapping)
    return expected_mapping

fixture = json.loads(Path(sys.argv[1]).read_text(), object_pairs_hook=reject_duplicate_keys)
skill, supervised, protocol, agents = (Path(path).read_text() for path in sys.argv[2:])
normalised_skill = " ".join(skill.split())
mapping = validate(fixture)
for reason, resume in mapping.items():
    for text in (skill, supervised):
        assert f"`{reason}`" in text and f"`{resume}`" in text
    assert f"`{reason}/{resume}`" in protocol
for scenario in fixture["scenarios"]:
    assert scenario["positive"] in normalised_skill
    assert scenario["negative"] in normalised_skill
for text in (skill, supervised, protocol, agents):
    assert fixture["toolName"] in text
assert "fail closed" in protocol
assert "optional" in protocol

for mutation in ("missing", "extra", "mismatched"):
    invalid = deepcopy(fixture)
    if mutation == "missing":
        del invalid["reasonResumeConditions"]["planChange"]
    elif mutation == "extra":
        invalid["reasonResumeConditions"]["futureReason"] = "userGuidance"
    else:
        invalid["reasonResumeConditions"]["permissionRequired"] = "planRevision"
    try:
        validate(invalid)
    except AssertionError:
        pass
    else:
        raise AssertionError(f"accepted {mutation} reason/resume mapping")
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
    for reason, resume in fixture["reasonResumeConditions"].items():
        assert f"{reason}/{resume}" in profile
PY

if "$helper" --help >"$tmp/help" 2>&1; then
  printf 'expected helper help invocation to retain its usage failure\n' >&2
  exit 1
fi
grep -F 'prepare-executor|prepare-supervision' "$tmp/help" >/dev/null
printf 'org-plan attention contract is valid\n'
