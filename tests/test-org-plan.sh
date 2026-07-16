#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
helper="$root/plugins/org-plan/skills/org-plan/scripts/org-plan"
fixtures="$root/tests/fixtures"
skill="$root/plugins/org-plan/skills/org-plan/SKILL.md"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/org-plan-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
passes=0 failures=0

pass() { passes=$((passes + 1)); }
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }
expect_ok() { if "$@" >"$tmp/out" 2>"$tmp/err"; then pass; else fail "$* (expected success): $(<"$tmp/err")"; fi; }
expect_fail() { if "$@" >"$tmp/out" 2>"$tmp/err"; then fail "$* (expected failure)"; else pass; fi; }
expect_contains() { if grep -F -- "$2" "$1" >/dev/null; then pass; else fail "missing $2 in $1"; fi; }
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
chmod 640 "$tmp/state.org"
expect_ok "$helper" set "$tmp/state.org" first-outcome WIP
expect_ok "$helper" set "$tmp/state.org" first-task WIP
expect_ok "$helper" set "$tmp/state.org" first-task DONE
expect_ok "$helper" set "$tmp/state.org" first-outcome DONE
expect_fail "$helper" set "$tmp/state.org" first-outcome TODO
expect_fail "$helper" set "$tmp/state.org" missing TODO
test "$(stat -c '%a' "$tmp/state.org" 2>/dev/null || stat -f '%Lp' "$tmp/state.org")" = 640 && pass || fail 'set preserves mode'
copy valid-minimal.org forced.org
expect_ok "$helper" set "$tmp/forced.org" first-outcome WIP
expect_ok "$helper" set "$tmp/forced.org" first-outcome TODO --force
expect_fail "$helper" set "$tmp/forced.org" first-task WIP --force

agents_dir="$tmp/org-plan-test-agents"
profile="$agents_dir/org-plan-test-executor.toml"
expect_ok "$helper" prepare-executor --model gpt-5.4-mini --agents-dir "$agents_dir" --profile-name org-plan-test-executor
test -f "$profile" && pass || fail 'default executor profile exists'
expect_contains "$profile" 'name = "org-plan-test-executor"'
expect_contains "$profile" 'model = "gpt-5.4-mini"'
expect_contains "$profile" 'developer_instructions ='
test "$(stat -c '%a' "$profile" 2>/dev/null || stat -f '%Lp' "$profile")" = 600 && pass || fail 'new executor profile mode is 600'
chmod 640 "$profile"
expect_ok "$helper" prepare-executor --model gpt-5.6-terra --agents-dir "$agents_dir" --profile-name org-plan-test-executor
expect_contains "$profile" 'model = "gpt-5.6-terra"'
test "$(stat -c '%a' "$profile" 2>/dev/null || stat -f '%Lp' "$profile")" = 640 && pass || fail 'existing executor profile mode is preserved'
python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$profile" && pass || fail 'executor profile is parseable TOML'
before=$(cksum "$profile")
expect_fail "$helper" prepare-executor --model 'bad"value' --agents-dir "$agents_dir" --profile-name org-plan-test-executor
test "$before" = "$(cksum "$profile")" && pass || fail 'invalid model does not mutate profile'
expect_fail "$helper" prepare-executor --model gpt-5.6-terra --agents-dir "$agents_dir" --profile-name 'Bad_Profile'
test "$before" = "$(cksum "$profile")" && pass || fail 'invalid profile name does not mutate profile'
test -z "$(find "$agents_dir" -name '.*.??????' -print -quit)" && pass || fail 'profile writer leaves no temporary files'
failure_bin="$tmp/failure-bin"
mkdir -p "$failure_bin"
printf '#!/bin/sh\nexit 1\n' > "$failure_bin/chmod"
chmod +x "$failure_bin/chmod"
write_failure_dir="$tmp/write-failure-agents"
expect_fail env PATH="$failure_bin:$PATH" "$helper" prepare-executor --agents-dir "$write_failure_dir"
test -z "$(find "$write_failure_dir" -type f -name '.*.??????' -print -quit)" && pass || fail 'profile writer cleans current temporary file on chmod failure'
expect_fail "$helper" prepare-executor --model
test ! -e "$tmp/.codex/agents/org-plan-executor.toml" && pass || fail 'tests avoid the default agents directory'

supervision_dir="$tmp/supervision-agents"
expect_ok "$helper" prepare-supervision --agents-dir "$supervision_dir"
expect_contains "$tmp/out" 'supervisor=org-plan-supervisor supervisor_model=gpt-5.6-luna'
expect_contains "$tmp/out" 'executor=org-plan-executor executor_model=gpt-5.6-terra'
expect_contains "$tmp/out" 'reviewer=org-plan-reviewer reviewer_model=gpt-5.6-sol'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'model = "gpt-5.6-luna"'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'mechanical evidence gates'
expect_contains "$supervision_dir/org-plan-executor.toml" 'model = "gpt-5.6-terra"'
expect_contains "$supervision_dir/org-plan-executor.toml" 'exactly one conventional commit'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'model = "gpt-5.6-sol"'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'sandbox_mode = "read-only"'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'explicit ACCEPT or REJECT verdict'
for role in supervisor executor reviewer; do
  python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$supervision_dir/org-plan-$role.toml" && pass || fail "$role profile is parseable TOML"
done
first_output=$(cat "$tmp/out")
expect_ok "$helper" prepare-supervision --agents-dir "$supervision_dir"
test "$first_output" = "$(cat "$tmp/out")" && pass || fail 'prepare-supervision is idempotent'

override_dir="$tmp/override-agents"
expect_ok "$helper" prepare-supervision --agents-dir "$override_dir" \
  --supervisor-model luna-test --executor-model terra-test --reviewer-model sol-test \
  --supervisor-profile-name test-supervisor --executor-profile-name test-executor --reviewer-profile-name test-reviewer
expect_contains "$override_dir/test-supervisor.toml" 'model = "luna-test"'
expect_contains "$override_dir/test-executor.toml" 'model = "terra-test"'
expect_contains "$override_dir/test-reviewer.toml" 'model = "sol-test"'
expect_contains "$tmp/out" 'supervisor=test-supervisor supervisor_model=luna-test'
expect_contains "$tmp/out" 'executor=test-executor executor_model=terra-test'
expect_contains "$tmp/out" 'reviewer=test-reviewer reviewer_model=sol-test'
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --supervisor-model
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --reviewer-model 'bad"model'
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --executor-profile-name Bad_Name
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --executor-profile-name same --reviewer-profile-name same

failure_dir="$tmp/failure-agents"
mkdir -p "$failure_dir/org-plan-reviewer.toml"
expect_fail "$helper" prepare-supervision --agents-dir "$failure_dir"
test ! -e "$failure_dir/org-plan-supervisor.toml" && pass || fail 'failed preparation does not install supervisor'
test ! -e "$failure_dir/org-plan-executor.toml" && pass || fail 'failed preparation does not install executor'
test -z "$(find "$failure_dir" -type f -name '.*.??????' -print -quit)" && pass || fail 'failed preparation cleans staged files'
test ! -s "$tmp/out" && pass || fail 'failed preparation prints no success result'
expect_contains "$skill" '`org-plan-supervisor` defaults to `gpt-5.6-luna`'
expect_contains "$skill" '`org-plan-executor` defaults to `gpt-5.6-terra`'
expect_contains "$skill" '`org-plan-reviewer` defaults to `gpt-5.6-sol`'
expect_contains "$skill" 'Luna alone performs routine'
expect_contains "$skill" 'Terra is the only role that'
expect_contains "$skill" 'Sol must'
expect_contains "$skill" 'never implement, modify the plan, commit, or supervise routine steps'
expect_contains "$skill" 'Manual execution remains the fallback.'
expect_contains "$skill" '`[agents] max_depth = 2` is required'
expect_contains "$skill" 'never edit the user'
expect_contains "$skill" 'configuration automatically'
expect_contains "$skill" 'planner spawns Luna with `fork_turns=none`'
expect_contains "$skill" 'Luna spawns Terra with `fork_turns=none`'
expect_contains "$skill" 'every Sol review with'
expect_contains "$skill" '`fork_turns=none` and a fresh, complete, explicit assignment'
expect_contains "$skill" 'only one write-capable child active'
expect_contains "$skill" 'waits for Terra to finish'
expect_contains "$skill" 'follow-up assignments'
expect_contains "$skill" 'without inherited conversation context'
expect_contains "$skill" 'exactly one conventional implementation commit'
expect_contains "$skill" 'no unintended dirty paths'
expect_contains "$skill" 'current touched-test evidence'
expect_contains "$skill" 'audit the L1 commit'
expect_contains "$skill" "plan's Goal, Tests, and Done-when criteria"
expect_contains "$skill" 'explicit ACCEPT verdict with evidence'
expect_contains "$skill" 'complete branch against its base'
expect_contains "$skill" 'current full-suite pass and clean intended scope'
expect_contains "$skill" 'Sol REJECT verdict must contain actionable findings'
expect_contains "$skill" 'returns the affected'
expect_contains "$skill" 'item to Terra for correction'
expect_contains "$skill" 'viewport sizes, and font-scale combinations'
expect_contains "$skill" 'Non-UI work does not'
expect_contains "$skill" 'Each Luna assignment states the plan path, target branch and base branch'
expect_contains "$skill" 'all'
expect_contains "$skill" 'prepared profile and model names'
expect_contains "$skill" 'complete L1/L2 loop, evidence gates'
expect_contains "$skill" 'preserved paths, the `[agents] max_depth = 2` nesting requirement'
expect_contains "$skill" 'Each Terra assignment states the active L1 and complete L2 block'
expect_contains "$skill" 'exact allowed change scope, required tests'
expect_contains "$skill" 'exactly-one-commit'
expect_contains "$skill" 'Each Sol assignment states the read-only commit range or diff'
expect_contains "$skill" 'evidence locations'
expect_contains "$skill" 'named UI screenshot/component/viewport/font-scale matrix'
expect_contains "$skill" 'required structured findings with evidence plus an explicit ACCEPT or'
expect_contains "$skill" 'Never use'
expect_contains "$skill" 'parent-context references such as "continue above", including for nested agents'
expect_contains "$skill" 'Luna classifies every failure'
expect_contains "$skill" 'Routine mechanical failures return to Terra with the exact failing evidence'
expect_contains "$skill" 'acceptance conditions'
expect_contains "$skill" 'Sol findings return to Terra unchanged in substance'
expect_contains "$skill" 'adds only the'
expect_contains "$skill" 'execution scope and does not conceal or reinterpret failed checks'
expect_contains "$skill" 'Material ambiguity invokes Sol for a read-only options audit'
expect_contains "$skill" 'stops and asks the user'
expect_contains "$skill" 'unresolved material requirement'
expect_contains "$skill" 'reruns the applicable L2 or L1 gate'
expect_contains "$skill" 'requests a new Sol verdict'

if [ "$failures" -ne 0 ]; then printf '%s passed, %s failed\n' "$passes" "$failures"; exit 1; fi
printf '%s passed\n' "$passes"
