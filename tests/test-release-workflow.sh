#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 - "$root/.github/workflows/release.yml" <<'PY'
import sys
from pathlib import Path

import yaml

path = Path(sys.argv[1])
source = path.read_text()
workflow = yaml.safe_load(source)
trigger = workflow.get("on", workflow.get(True))

assert workflow["name"] == "Release"
assert trigger == {"push": {"branches": ["main"]}}
assert workflow["permissions"] == {"contents": "write"}
assert workflow["concurrency"] == {
    "group": "release-${{ github.repository }}",
    "cancel-in-progress": False,
}

steps = workflow["jobs"]["release"]["steps"]
checkout = next(step for step in steps if step.get("uses") == "actions/checkout@v4")
assert checkout["with"]["fetch-depth"] == 0

baseline = next(step for step in steps if step.get("id") == "baseline")
assert "^v(0|[1-9][0-9]*)" in baseline["run"]
assert "has_tag=false" in baseline["run"]

semver = next(step for step in steps if step.get("id") == "semver")
assert semver["uses"] == "ietf-tools/semver-action@v1"
assert semver["if"] == "steps.baseline.outputs.has_tag == 'true'"
assert semver["with"]["token"] == "${{ github.token }}"
assert semver["with"]["branch"] == "main"
assert semver["with"]["skipInvalidTags"] is True
assert semver["with"]["noNewCommitBehavior"] == "current"
assert semver["with"]["noVersionBumpBehavior"] == "current"

release = next(step for step in steps if step.get("id") == "release")
assert release["env"]["NEXT_VERSION"] == "${{ steps.semver.outputs.nextStrict }}"
assert "tag=v0.1.0" in release["run"]
assert "version=0.1.0" in release["run"]
assert "major|minor|patch) should_release=true" in release["run"]
assert "none) should_release=false" in release["run"]
assert 'echo "tag=$tag" >>"$GITHUB_OUTPUT"' in release["run"]
assert 'echo "version=$version" >>"$GITHUB_OUTPUT"' in release["run"]
assert 'echo "should_release=$should_release" >>"$GITHUB_OUTPUT"' in release["run"]
PY

printf 'release workflow contract is valid\n'
