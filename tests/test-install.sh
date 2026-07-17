#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
installer="$root/install.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/org-plan-install-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
passes=0 failures=0

pass() { passes=$((passes + 1)); }
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }
expect_ok() { if "$@" >"$tmp/out" 2>"$tmp/err"; then pass; else fail "$* (expected success): $(<"$tmp/err")"; fi; }
expect_fail() { if "$@" >"$tmp/out" 2>"$tmp/err"; then fail "$* (expected failure)"; else pass; fi; }

remote="$tmp/org-plan.git"
seed="$tmp/seed"
git init --bare -q "$remote"
git init -q -b main "$seed"
git -C "$seed" config user.name Test
git -C "$seed" config user.email test@example.invalid
printf 'main\n' >"$seed/marker"
git -C "$seed" add marker
git -C "$seed" commit -qm initial
git -C "$seed" tag v-test
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -q origin main --tags

home="$tmp/home"
expect_ok env HOME="$home" GESTALT_REPOSITORY="$remote" "$installer"
target="$home/.agents/plugins/gestalt"
test "$(git -C "$target" branch --show-current)" = main && pass || fail 'default checkout is main'
python3 - "$home/.agents/plugins/marketplace.json" <<'PY' && pass || fail 'marketplace entry is valid'
import json, sys
data = json.load(open(sys.argv[1]))
entry = next(item for item in data["plugins"] if item["name"] == "gestalt")
assert data["name"] == "personal"
assert entry["source"] == {"source": "local", "path": "./plugins/gestalt"}
assert entry["policy"] == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}
assert entry["category"] == "Developer Tools"
PY
expect_ok env HOME="$home" GESTALT_REPOSITORY="$remote" "$installer"
expect_ok env HOME="$home" GESTALT_REPOSITORY="$remote" GESTALT_REF=v-test "$installer"
test "$(git -C "$target" describe --tags --exact-match)" = v-test && pass || fail 'reference override is checked out'
expect_fail env HOME="$tmp/invalid-home" GESTALT_REPOSITORY="$tmp/missing.git" "$installer"
test ! -e "$home/.codex/agents/org-plan-executor.toml" && pass || fail 'installer does not create executor profile'

if [ "$failures" -ne 0 ]; then printf '%s passed, %s failed\n' "$passes" "$failures"; exit 1; fi
printf '%s passed\n' "$passes"
