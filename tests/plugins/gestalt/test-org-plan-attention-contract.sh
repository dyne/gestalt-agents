#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
helper="$root/plugins/gestalt/skills/org-plan/scripts/org-plan"
fixture="$root/tests/plugins/gestalt/fixtures/org-plan-attention-contract.json"
skill="$root/plugins/gestalt/skills/org-plan/SKILL.md"
attention_reference="$root/plugins/gestalt/skills/org-plan/references/attention-protocol.md"
supervision_reference="$root/plugins/gestalt/skills/org-plan/references/supervised-execution.md"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/org-plan-attention-test.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM

python3 - "$fixture" <<'PY'
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
validate(fixture)

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

python3 - "$fixture" "$agents_dir/org-plan-reviewer.toml" "$agents_dir/org-plan-executor.toml" \
    "$skill" "$attention_reference" "$supervision_reference" <<'PY'
import json
import sys
from pathlib import Path

fixture = json.loads(Path(sys.argv[1]).read_text())
for profile_path in sys.argv[2:4]:
    profile = Path(profile_path).read_text()
    assert profile.count(fixture["toolName"]) == 1, profile_path
    assert "optional" in profile
    assert "skill decision table" in profile
    assert "A successful call ends the root turn" in profile
    assert "recoverable failures" in profile
    assert "with only the mapped reason and resumeCondition" in profile
    assert "requestedAction" not in profile

skill = Path(sys.argv[4]).read_text()
attention_reference = Path(sys.argv[5]).read_text()
supervision_reference = Path(sys.argv[6]).read_text()
assert "exact `reason` and `resumeCondition` only" in skill
assert "Calls contain only the mapped `reason`" in attention_reference
assert "once with only `kind: l2Completed`" in supervision_reference
assert "once with only `kind: l1Accepted`" in supervision_reference
for document in (skill, attention_reference, supervision_reference):
    assert "`requestedAction`" not in document
PY

"$helper" --help >"$tmp/help" 2>&1
grep -F 'prepare-executor|prepare-supervision' "$tmp/help" >/dev/null
printf 'org-plan attention contract is valid\n'
