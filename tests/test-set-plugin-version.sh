#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
updater="$root/scripts/set-plugin-version.py"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/set-plugin-version-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

make_repository() {
  repository=$1
  mkdir -p "$repository/plugins/alpha/.codex-plugin" "$repository/plugins/beta/.codex-plugin"
  printf '{"name":"alpha","version":"9.8.7","extra":{"kept":true}}\n' \
    >"$repository/plugins/alpha/.codex-plugin/plugin.json"
  printf '{"name":"beta","version":"1.2.3","skills":"./skills/"}\n' \
    >"$repository/plugins/beta/.codex-plugin/plugin.json"
}

repository="$tmp/success"
make_repository "$repository"
output=$(python3 "$updater" 2.4.6 "$repository")
case $output in
  *plugins/alpha/.codex-plugin/plugin.json*plugins/beta/.codex-plugin/plugin.json*version=2.4.6*) ;;
  *) printf 'unexpected updater output: %s\n' "$output" >&2; exit 1 ;;
esac
python3 - "$repository" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
alpha = json.loads((root / "plugins/alpha/.codex-plugin/plugin.json").read_text())
beta = json.loads((root / "plugins/beta/.codex-plugin/plugin.json").read_text())
assert alpha == {"name": "alpha", "version": "2.4.6", "extra": {"kept": True}}
assert beta == {"name": "beta", "version": "2.4.6", "skills": "./skills/"}
assert all(
    path.read_bytes().endswith(b"\n")
    for path in root.glob("plugins/*/.codex-plugin/plugin.json")
)
PY

for invalid in v1.2.3 1.2 01.2.3 1.2.3-rc.1; do
  if python3 "$updater" "$invalid" "$repository" >"$tmp/out" 2>"$tmp/err"; then
    printf 'invalid version unexpectedly succeeded: %s\n' "$invalid" >&2
    exit 1
  fi
done

repository="$tmp/malformed"
make_repository "$repository"
printf '{broken\n' >"$repository/plugins/beta/.codex-plugin/plugin.json"
before=$(sha256sum "$repository/plugins/alpha/.codex-plugin/plugin.json")
if python3 "$updater" 3.0.0 "$repository" >"$tmp/out" 2>"$tmp/err"; then
  printf 'malformed manifest unexpectedly succeeded\n' >&2
  exit 1
fi
test "$(sha256sum "$repository/plugins/alpha/.codex-plugin/plugin.json")" = "$before"

repository="$tmp/missing-version"
make_repository "$repository"
printf '{"name":"beta"}\n' >"$repository/plugins/beta/.codex-plugin/plugin.json"
before=$(sha256sum "$repository/plugins/alpha/.codex-plugin/plugin.json")
if python3 "$updater" 3.0.0 "$repository" >"$tmp/out" 2>"$tmp/err"; then
  printf 'missing version unexpectedly succeeded\n' >&2
  exit 1
fi
test "$(sha256sum "$repository/plugins/alpha/.codex-plugin/plugin.json")" = "$before"

mkdir "$tmp/empty"
if python3 "$updater" 3.0.0 "$tmp/empty" >"$tmp/out" 2>"$tmp/err"; then
  printf 'empty manifest set unexpectedly succeeded\n' >&2
  exit 1
fi

printf 'plugin version updater is valid\n'
