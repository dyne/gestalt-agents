#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/release-workflow-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
ruby -ryaml -rjson -e 'File.write(ARGV[1], JSON.generate(YAML.safe_load_file(ARGV[0], aliases: false)))' \
  "$root/.github/workflows/release.yml" "$tmp/workflow.json"
python3 - "$root/.github/workflows/release.yml" "$tmp/workflow.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()
workflow = json.loads(Path(sys.argv[2]).read_text())
trigger = workflow.get("on", workflow.get("true"))

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
assert semver["with"]["majorList"] == ""
assert semver["with"]["minorList"] == "feat, feature"
assert semver["with"]["patchList"] == "fix, bugfix, perf, refactor, test, tests"
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

synchronize = next(
    step for step in steps if step.get("name") == "Synchronize plugin manifests"
)
commit = next(
    step for step in steps if step.get("name") == "Commit synchronized plugin versions"
)
publish = next(
    step for step in steps if step.get("name") == "Tag and atomically publish release"
)
release_guard = "steps.release.outputs.should_release == 'true'"
assert synchronize["if"] == release_guard
assert commit["if"] == release_guard
assert publish["if"] == release_guard
assert 'scripts/set-plugin-version.py "$VERSION"' in synchronize["run"]
assert 'json.loads(manifest.read_text())["version"] == version' in synchronize["run"]
assert "git config user.name github-actions[bot]" in commit["run"]
assert "git diff --quiet -- plugins/*/.codex-plugin/plugin.json" in commit["run"]
assert 'git commit -m "chore(release): $TAG [skip ci]"' in commit["run"]
assert 'git tag "$TAG" HEAD' in publish["run"]
assert 'git push --atomic origin HEAD:main "refs/tags/$TAG"' in publish["run"]
assert steps.index(synchronize) < steps.index(commit) < steps.index(publish)
assert source.count(release_guard) == 3
assert "chore" not in semver["with"]["minorList"]
assert "chore" not in semver["with"]["patchList"]
assert "GITHUB_TOKEN pushes do not recursively trigger" in source
assert "Protected main" in source
PY

printf 'release workflow contract is valid\n'
