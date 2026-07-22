#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/context-mode-skills-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/repository/plugins"
cp -a "$root/plugins/context-mode" "$tmp/repository/plugins/context-mode"

output=$(NO_COLOR=1 npx --yes skills@1.5.18 add "$tmp/repository" --list 2>&1)

python3 - "$output" <<'PY'
import collections
import re
import sys

expected = {
    "context-mode", "ctx-doctor", "ctx-index", "ctx-insight",
    "ctx-purge", "ctx-search", "ctx-stats", "ctx-upgrade",
}
clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", sys.argv[1])
names = re.findall(r"^│    ([a-z0-9][a-z0-9-]*)$", clean, re.MULTILINE)
counts = collections.Counter(names)
assert set(names) == expected, f"unexpected discovered skills: {names}"
assert all(count == 1 for count in counts.values()), f"duplicate discovered skills: {counts}"
PY

printf 'npx skills discovers context-mode skills\n'
