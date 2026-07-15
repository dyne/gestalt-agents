#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
helper="$root/skills/org-plan/scripts/org-plan"
fixtures="$root/tests/fixtures"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/org-plan-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
passes=0 failures=0

pass() { passes=$((passes + 1)); }
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }
expect_ok() { if "$@" >"$tmp/out" 2>"$tmp/err"; then pass; else fail "$* (expected success): $(<"$tmp/err")"; fi; }
expect_fail() { if "$@" >"$tmp/out" 2>"$tmp/err"; then fail "$* (expected failure)"; else pass; fi; }
expect_contains() { if rg -F -- "$2" "$1" >/dev/null; then pass; else fail "missing $2 in $1"; fi; }
copy() { cp "$fixtures/$1" "$tmp/$2"; }

copy valid-minimal.org plan.org
expect_ok "$helper" validate "$tmp/plan.org"
copy valid-multi.org multi.org
expect_ok "$helper" validate "$tmp/multi.org"

for mutation in \
  '1d' \
  '1a#+TITLE: Duplicate' \
  's/^\*\* TODO/\*\*\* TODO/' \
  's/^\* TODO/\* WAIT/' \
  's/\[#A\] //' \
  's/:ID: first-task/:ID: bad_id/' \
  '/- Goal ::/d' \
  '/- Done when ::/d' \
  's/:ID: first-task/:ID: first-outcome/'; do
  copy valid-minimal.org invalid.org
  sed "$mutation" "$tmp/invalid.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/invalid.org"
  expect_fail "$helper" validate "$tmp/invalid.org"
done

copy valid-multi.org invalid.org
sed 's/^\* TODO \[#B\]/\* WIP [#B]/' "$tmp/invalid.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/invalid.org"
expect_fail "$helper" validate "$tmp/invalid.org"
copy valid-multi.org invalid.org
sed 's/^\* TODO \[#B\]/\* DONE [#B]/' "$tmp/invalid.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/invalid.org"
expect_fail "$helper" validate "$tmp/invalid.org"

expect_ok "$helper" next "$tmp/multi.org" l1
expect_contains "$tmp/out" 'first-outcome'
expect_ok "$helper" next "$tmp/multi.org" l2
expect_contains "$tmp/out" 'second-task'
expect_ok "$helper" summary "$tmp/multi.org"
expect_contains "$tmp/out" 'L1 WIP=1'
expect_ok "$helper" l2 "$tmp/multi.org" 'Second task|Run tests'
expect_contains "$tmp/out" 'second-task'
expect_fail "$helper" l2 "$tmp/multi.org" '['
expect_fail "$helper" l2 "$tmp/multi.org" 'no-such-text'

copy valid-minimal.org state.org
expect_ok "$helper" set "$tmp/state.org" first-outcome WIP
expect_ok "$helper" set "$tmp/state.org" first-task WIP
expect_ok "$helper" set "$tmp/state.org" first-task DONE
expect_ok "$helper" set "$tmp/state.org" first-outcome DONE
expect_fail "$helper" set "$tmp/state.org" first-outcome TODO
expect_fail "$helper" set "$tmp/state.org" missing TODO

if [ "$failures" -ne 0 ]; then printf '%s passed, %s failed\n' "$passes" "$failures"; exit 1; fi
printf '%s passed\n' "$passes"
