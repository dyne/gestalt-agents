#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
helper="$root/plugins/gestalt/skills/org-plan/scripts/org-plan"
fixtures="$root/tests/fixtures"
skill="$root/plugins/gestalt/skills/org-plan/SKILL.md"
manifest="$root/plugins/gestalt/.codex-plugin/plugin.json"
readme="$root/README.md"
agents="$root/AGENTS.md"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/org-plan-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
passes=0 failures=0

pass() { passes=$((passes + 1)); }
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }
expect_ok() { if "$@" >"$tmp/out" 2>"$tmp/err"; then pass; else fail "$* (expected success): $(<"$tmp/err")"; fi; }
expect_fail() { if "$@" >"$tmp/out" 2>"$tmp/err"; then fail "$* (expected failure)"; else pass; fi; }
expect_status() { local expected=$1 status; shift; if "$@" >"$tmp/out" 2>"$tmp/err"; then status=0; else status=$?; fi; test "$status" = "$expected" && pass || fail "$* (expected status $expected, got $status)"; }
expect_contains() { if grep -F -- "$2" "$1" >/dev/null; then pass; else fail "missing $2 in $1"; fi; }
expect_not_contains() { if grep -F -- "$2" "$1" >/dev/null; then fail "unexpected $2 in $1"; else pass; fi; }
copy() {
  cp "$fixtures/$1" "$tmp/$2"
}

copy valid-minimal.org plan.org
expect_ok "$helper" validate "$tmp/plan.org"
copy valid-multi.org multi.org
sed '0,/:REVIEW_STATUS: UNREVIEWED/s//:REVIEW_STATUS: REVIEWED/' "$tmp/multi.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/multi.org"
expect_ok "$helper" validate "$tmp/multi.org"

copy valid-multi.org migrated.org
sed \
  -e '0,/:REVIEW_STATUS: UNREVIEWED/s//:REVIEW_STATUS: REVIEWED/' \
  -e 's/^\* WIP \[#A\]/\* DONE [#A]/' \
  -e 's/^\*\* WIP \[#B\]/\*\* DONE [#B]/' \
  "$tmp/migrated.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/migrated.org"
expect_ok "$helper" validate "$tmp/migrated.org"

for review_mutation in \
  '/:REVIEW_STATUS: UNREVIEWED/d' \
  '/:REVIEW_STATUS: UNREVIEWED/a:REVIEW_STATUS: REVIEWED' \
  's/:REVIEW_STATUS: UNREVIEWED/:REVIEW_STATUS: PENDING/' \
  's/:REVIEW_STATUS: UNREVIEWED/:REVIEW_STATUS: unreviewed/' \
  '/:ID: first-task/a:REVIEW_STATUS: UNREVIEWED'; do
  copy valid-minimal.org invalid-review.org
  sed "$review_mutation" "$tmp/invalid-review.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/invalid-review.org"
  expect_fail "$helper" validate "$tmp/invalid-review.org"
done

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
expect_contains "$tmp/out" 'L1 REVIEWED=1'
expect_contains "$tmp/out" 'L1 UNREVIEWED=1'
printf '%s\n' \
  'L1 TODO=1' \
  'L1 WIP=1' \
  'L1 DONE=0' \
  'L2 TODO=1' \
  'L2 WIP=1' \
  'L2 DONE=1' \
  'current  first-outcome [#WIP] First outcome' \
  'L1 REVIEWED=1' \
  'L1 UNREVIEWED=1' >"$tmp/expected-summary"
cmp -s "$tmp/expected-summary" "$tmp/out" && pass || fail 'summary preserves execution-state line order before review counts'
expect_ok "$helper" l2 "$tmp/multi.org" 'Second task|Run tests'
expect_contains "$tmp/out" 'second-task'
expect_fail "$helper" l2 "$tmp/multi.org" '['
expect_fail "$helper" l2 "$tmp/multi.org" 'no-such-text'

copy valid-multi.org review-order.org
sed \
  -e 's/^\* WIP \[#A\]/\* DONE [#A]/' \
  -e 's/^\*\* WIP \[#B\]/\*\* DONE [#B]/' \
  -e 's/^\* TODO \[#B\]/\* DONE [#B]/' \
  -e 's/^\*\* TODO \[#A\]/\*\* DONE [#A]/' \
  "$tmp/review-order.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/review-order.org"
expect_ok "$helper" next "$tmp/review-order.org" review
test "$(<"$tmp/out")" = ' first-outcome [#DONE] First outcome' && pass || fail 'next review selects the first completed unreviewed L1'
expect_ok "$helper" review "$tmp/review-order.org" first-outcome REVIEWED
expect_ok "$helper" next "$tmp/review-order.org" review
test "$(<"$tmp/out")" = ' second-outcome [#DONE] Second outcome' && pass || fail 'next review advances in plan order'
expect_ok "$helper" review "$tmp/review-order.org" second-outcome REVIEWED
expect_status 1 "$helper" next "$tmp/review-order.org" review
test ! -s "$tmp/out" && pass || fail 'next review emits no output when no review is pending'
expect_ok "$helper" summary "$tmp/review-order.org"
expect_contains "$tmp/out" 'L1 TODO=0'
expect_contains "$tmp/out" 'L1 WIP=0'
expect_contains "$tmp/out" 'L1 DONE=2'
expect_contains "$tmp/out" 'L2 TODO=0'
expect_contains "$tmp/out" 'L2 WIP=0'
expect_contains "$tmp/out" 'L2 DONE=3'
expect_contains "$tmp/out" 'L1 REVIEWED=2'
expect_contains "$tmp/out" 'L1 UNREVIEWED=0'

cp "$tmp/review-order.org" "$tmp/appended-review.org"
sed -n '/^\* DONE \[#B\] Second outcome/,$p' "$tmp/review-order.org" | sed \
  -e 's/Second outcome/Appended refinement/' \
  -e 's/second-outcome/appended-refinement/' \
  -e 's/Third task/Appended task/' \
  -e 's/third-task/appended-task/' \
  -e 's/:REVIEW_STATUS: REVIEWED/:REVIEW_STATUS: UNREVIEWED/' \
  >>"$tmp/appended-review.org"
expect_ok "$helper" validate "$tmp/appended-review.org"
expect_ok "$helper" next "$tmp/appended-review.org" review
test "$(<"$tmp/out")" = ' appended-refinement [#DONE] Appended refinement' && pass || fail 'appended unreviewed L1 is selected without selecting reviewed history'
expect_ok "$helper" summary "$tmp/appended-review.org"
expect_contains "$tmp/out" 'L1 REVIEWED=2'
expect_contains "$tmp/out" 'L1 UNREVIEWED=1'
expect_ok "$helper" next "$tmp/appended-review.org" review
test "$(<"$tmp/out")" = ' appended-refinement [#DONE] Appended refinement' && pass || fail 'rejected L1 remains pending without a review transition'
expect_ok "$helper" set "$tmp/appended-review.org" appended-refinement WIP --force
sed 's/- Goal :: Test order\./- Goal :: Correct the rejected refinement./' "$tmp/appended-review.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/appended-review.org"
expect_ok "$helper" set "$tmp/appended-review.org" appended-refinement DONE
expect_ok "$helper" next "$tmp/appended-review.org" review
test "$(<"$tmp/out")" = ' appended-refinement [#DONE] Appended refinement' && pass || fail 'corrected rejected L1 is selected for re-review'
expect_ok "$helper" review "$tmp/appended-review.org" appended-refinement REVIEWED
expect_status 1 "$helper" next "$tmp/appended-review.org" review
test ! -s "$tmp/out" && pass || fail 'accepted appended L1 leaves review current'

copy valid-minimal.org review-transitions.org
review_before=$(cksum "$tmp/review-transitions.org")
expect_fail "$helper" review "$tmp/review-transitions.org" first-outcome REVIEWED
test "$review_before" = "$(cksum "$tmp/review-transitions.org")" && pass || fail 'review rejects unfinished L1 without mutation'
expect_fail "$helper" review "$tmp/review-transitions.org" first-task REVIEWED
expect_contains "$tmp/err" 'ID first-task is not an L1'
expect_fail "$helper" review "$tmp/review-transitions.org" missing REVIEWED
expect_contains "$tmp/err" 'unknown ID missing'
expect_status 2 "$helper" review "$tmp/review-transitions.org" first-outcome PENDING
expect_ok "$helper" set "$tmp/review-transitions.org" first-outcome WIP
expect_fail "$helper" review "$tmp/review-transitions.org" first-outcome REVIEWED
expect_ok "$helper" set "$tmp/review-transitions.org" first-task WIP
expect_ok "$helper" set "$tmp/review-transitions.org" first-task DONE
expect_ok "$helper" set "$tmp/review-transitions.org" first-outcome DONE
chmod 640 "$tmp/review-transitions.org"
expect_ok "$helper" review "$tmp/review-transitions.org" first-outcome REVIEWED
expect_contains "$tmp/review-transitions.org" ':REVIEW_STATUS: REVIEWED'
test "$(stat -c '%a' "$tmp/review-transitions.org" 2>/dev/null || stat -f '%Lp' "$tmp/review-transitions.org")" = 640 && pass || fail 'review preserves mode'
expect_ok "$helper" review "$tmp/review-transitions.org" first-outcome UNREVIEWED
expect_contains "$tmp/review-transitions.org" ':REVIEW_STATUS: UNREVIEWED'
expect_contains "$tmp/review-transitions.org" '* DONE [#A] First outcome'
sed 's/- Goal :: Test the helper\./- Goal :: Corrected after explicit review reset./' "$tmp/review-transitions.org" >"$tmp/changed" && mv "$tmp/changed" "$tmp/review-transitions.org"
expect_ok "$helper" validate "$tmp/review-transitions.org"
expect_ok "$helper" review "$tmp/review-transitions.org" first-outcome REVIEWED
expect_ok "$helper" set "$tmp/review-transitions.org" first-outcome WIP --force
expect_contains "$tmp/review-transitions.org" ':REVIEW_STATUS: UNREVIEWED'
expect_contains "$tmp/review-transitions.org" '* WIP [#A] First outcome'
expect_ok "$helper" set "$tmp/review-transitions.org" first-outcome DONE
expect_ok "$helper" next "$tmp/review-transitions.org" review
test "$(<"$tmp/out")" = ' first-outcome [#DONE] First outcome' && pass || fail 'materially changed reviewed L1 returns to pending review'

copy valid-multi.org describe.org
expect_ok "$helper" describe "$tmp/describe.org" first-outcome
test "$(<"$tmp/out")" = $'L1 1/2 First outcome\nGoal: Test order.' && pass || fail 'describe prints stable L1 position and text'
expect_ok "$helper" describe "$tmp/describe.org" second-task
test "$(<"$tmp/out")" = $'L2 Second task\nWhy: Needed.' && pass || fail 'describe prints stable L2 text'
expect_fail "$helper" describe "$tmp/describe.org" missing
expect_contains "$tmp/err" 'unknown ID missing'
whitespace_plan="$tmp/plan with spaces.org"
copy valid-minimal.org 'plan with spaces.org'
sed \
  -e 's/First outcome/First outcome with  internal spaces/' \
  -e 's/- Goal :: Test the helper\./- Goal :: Text with  internal spaces./' \
  "$whitespace_plan" >"$tmp/changed" && mv "$tmp/changed" "$whitespace_plan"
expect_ok "$helper" describe "$whitespace_plan" first-outcome
test "$(<"$tmp/out")" = $'L1 1/1 First outcome with  internal spaces\nGoal: Text with  internal spaces.' && pass || fail 'describe output is position-aware and whitespace-safe'

describe_sentinel="$tmp/describe-output-was-evaluated"
adversarial_plan="$tmp/"$'plan %=\tline\nnext.org'
adversarial_title='Outcome %= with tab'
adversarial_title+=$'\t'
adversarial_title+='$(touch '"$describe_sentinel"') ; `touch '"$describe_sentinel"'` & | < >'
adversarial_goal='Purpose %= with tab'
adversarial_goal+=$'\t'
adversarial_goal+='$(touch '"$describe_sentinel"') ; $HOME * ? [x]'
awk -v title="$adversarial_title" -v goal="$adversarial_goal" '
  /^\* TODO \[#A\] First outcome$/ { print "* TODO [#A] " title; next }
  /^- Goal :: Test the helper\.$/ { print "- Goal :: " goal; next }
  { print }
' "$fixtures/valid-minimal.org" >"$adversarial_plan"
expect_ok "$helper" validate "$adversarial_plan"
expect_ok "$helper" describe "$adversarial_plan" first-outcome
{
  printf 'L1 1/1 %s\n' "$adversarial_title"
  printf 'Goal: %s\n' "$adversarial_goal"
} >"$tmp/expected-describe"
cmp -s "$tmp/expected-describe" "$tmp/out" && pass || fail 'describe preserves adversarial text as data'
test ! -e "$describe_sentinel" && pass || fail 'describe output is never evaluated as shell code'

copy valid-minimal.org review-failure.org
expect_ok "$helper" set "$tmp/review-failure.org" first-outcome WIP
expect_ok "$helper" set "$tmp/review-failure.org" first-task WIP
expect_ok "$helper" set "$tmp/review-failure.org" first-task DONE
expect_ok "$helper" set "$tmp/review-failure.org" first-outcome DONE
review_failure_before=$(cksum "$tmp/review-failure.org")
review_failure_bin="$tmp/review-failure-bin"
mkdir -p "$review_failure_bin"
printf '#!/bin/sh\nexit 1\n' > "$review_failure_bin/chmod"
chmod +x "$review_failure_bin/chmod"
expect_fail env PATH="$review_failure_bin:$PATH" "$helper" review "$tmp/review-failure.org" first-outcome REVIEWED
test "$review_failure_before" = "$(cksum "$tmp/review-failure.org")" && pass || fail 'failed review write leaves original unchanged'
test -z "$(find "$tmp" -maxdepth 1 -name 'review-failure.org.tmp.*' -print -quit)" && pass || fail 'failed review write cleans temporary file'

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
expect_contains "$tmp/out" "profile=$profile"
test -f "$profile" && pass || fail 'default executor profile exists'
expect_contains "$profile" 'name = "org-plan-test-executor"'
expect_contains "$profile" 'model = "gpt-5.4-mini"'
expect_contains "$profile" 'developer_instructions ='
expect_contains "$profile" 'You are the depth-two executor and the only code writer.'
expect_contains "$profile" 'Return only concise structured evidence to the supervisor, never directly to the director'
test "$(stat -c '%a' "$profile" 2>/dev/null || stat -f '%Lp' "$profile")" = 600 && pass || fail 'new executor profile mode is 600'
chmod 640 "$profile"
expect_ok "$helper" prepare-executor --model gpt-5.6-terra --agents-dir "$agents_dir" --profile-name org-plan-test-executor
expect_contains "$profile" 'model = "gpt-5.6-terra"'
test "$(stat -c '%a' "$profile" 2>/dev/null || stat -f '%Lp' "$profile")" = 640 && pass || fail 'existing executor profile mode is preserved'
python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$profile" && pass || fail 'executor profile is parseable TOML'
before=$(cksum "$profile")
expect_fail "$helper" prepare-executor --model 'bad"value' --agents-dir "$agents_dir" --profile-name org-plan-test-executor
expect_contains "$tmp/err" 'invalid model: bad"value'
test "$before" = "$(cksum "$profile")" && pass || fail 'invalid model does not mutate profile'
expect_fail "$helper" prepare-executor --model gpt-5.6-terra --agents-dir "$agents_dir" --profile-name 'Bad_Profile'
expect_contains "$tmp/err" 'invalid profile name: Bad_Profile'
test "$before" = "$(cksum "$profile")" && pass || fail 'invalid profile name does not mutate profile'
test -z "$(find "$agents_dir" -name '.*.??????' -print -quit)" && pass || fail 'profile writer leaves no temporary files'
failure_bin="$tmp/failure-bin"
mkdir -p "$failure_bin"
printf '#!/bin/sh\nexit 1\n' > "$failure_bin/chmod"
chmod +x "$failure_bin/chmod"
write_failure_dir="$tmp/write-failure-agents"
expect_fail env PATH="$failure_bin:$PATH" "$helper" prepare-executor --agents-dir "$write_failure_dir"
test -z "$(find "$write_failure_dir" -type f -name '.*.??????' -print -quit)" && pass || fail 'profile writer cleans current temporary file on chmod failure'
interrupt_bin="$tmp/interrupt-bin"
mkdir -p "$interrupt_bin"
printf '#!/bin/sh\nkill -TERM "$PPID"\nsleep 1\nexit 1\n' > "$interrupt_bin/chmod"
chmod +x "$interrupt_bin/chmod"
interrupt_executor_dir="$tmp/interrupt-executor-agents"
expect_fail env PATH="$interrupt_bin:$PATH" "$helper" prepare-executor --agents-dir "$interrupt_executor_dir"
test -z "$(find "$interrupt_executor_dir" -type f -name '.*.??????' -print -quit)" && pass || fail 'interrupted executor preparation cleans current staged file'
interrupt_supervision_dir="$tmp/interrupt-supervision-agents"
expect_fail env PATH="$interrupt_bin:$PATH" "$helper" prepare-supervision --agents-dir "$interrupt_supervision_dir"
test -z "$(find "$interrupt_supervision_dir" -type f -name '.*.??????' -print -quit)" && pass || fail 'interrupted supervision preparation cleans current staged file'

mkdir_interrupt_bin="$tmp/mkdir-interrupt-bin"
mkdir -p "$mkdir_interrupt_bin"
real_mkdir=$(command -v mkdir)
printf '#!/bin/sh\nreal_mkdir=%s\n"$real_mkdir" "$@" || exit\ncase "$*" in *org-plan-stage.*) kill -TERM "$PPID" ;; esac\n' "$real_mkdir" > "$mkdir_interrupt_bin/mkdir"
chmod +x "$mkdir_interrupt_bin/mkdir"
for command in prepare-executor prepare-supervision; do
  creation_dir="$tmp/creation-$command-agents"
  expect_status 143 env PATH="$mkdir_interrupt_bin:$PATH" "$helper" "$command" --agents-dir "$creation_dir"
  test -z "$(find "$creation_dir" -name '.org-plan-stage.*' -print -quit)" && pass || fail "$command cleans a stage directory interrupted during creation"
  test ! -s "$tmp/out" && pass || fail "$command interruption prints no success result"
done

mv_interrupt_bin="$tmp/mv-interrupt-bin"
mkdir -p "$mv_interrupt_bin"
real_mv=$(command -v mv)
printf '#!/bin/sh\nreal_mv=%s\n"$real_mv" "$@" || exit\ncount=0\ntest ! -f "$MOVE_COUNTER" || count=$(cat "$MOVE_COUNTER")\ncount=$((count + 1))\nprintf "%%s\\n" "$count" > "$MOVE_COUNTER"\ntest "$count" -ne 1 || kill -TERM "$PPID"\n' "$real_mv" > "$mv_interrupt_bin/mv"
chmod +x "$mv_interrupt_bin/mv"

fresh_rollback_dir="$tmp/fresh-rollback-agents"
expect_status 143 env PATH="$mv_interrupt_bin:$PATH" MOVE_COUNTER="$tmp/fresh-moves" "$helper" prepare-supervision --agents-dir "$fresh_rollback_dir"
test -z "$(find "$fresh_rollback_dir" -maxdepth 1 -type f -name '*.toml' -print -quit)" && pass || fail 'interrupted fresh supervision install leaves no partial profiles'
test -z "$(find "$fresh_rollback_dir" -name '.org-plan-stage.*' -print -quit)" && pass || fail 'fresh supervision rollback cleans stage directory'
test ! -s "$tmp/out" && pass || fail 'fresh supervision rollback prints no success result'

legacy_rollback_dir="$tmp/legacy-rollback-agents"
expect_ok "$helper" prepare-executor --agents-dir "$legacy_rollback_dir"
printf 'legacy-old\n' > "$legacy_rollback_dir/org-plan-executor.toml"
chmod 640 "$legacy_rollback_dir/org-plan-executor.toml"
legacy_before=$(cksum "$legacy_rollback_dir/org-plan-executor.toml")
expect_status 143 env PATH="$mv_interrupt_bin:$PATH" MOVE_COUNTER="$tmp/legacy-moves" "$helper" prepare-executor --agents-dir "$legacy_rollback_dir"
test "$legacy_before" = "$(cksum "$legacy_rollback_dir/org-plan-executor.toml")" && pass || fail 'interrupted legacy install restores old profile'
test "$(stat -c '%a' "$legacy_rollback_dir/org-plan-executor.toml" 2>/dev/null || stat -f '%Lp' "$legacy_rollback_dir/org-plan-executor.toml")" = 640 && pass || fail 'legacy rollback preserves old mode'
test -z "$(find "$legacy_rollback_dir" -name '.org-plan-stage.*' -print -quit)" && pass || fail 'legacy rollback cleans stage directory'
test ! -s "$tmp/out" && pass || fail 'legacy rollback prints no success result'

supervision_rollback_dir="$tmp/supervision-rollback-agents"
expect_ok "$helper" prepare-supervision --agents-dir "$supervision_rollback_dir"
rollback_index=0
for role in supervisor executor reviewer; do
  rollback_index=$((rollback_index + 1))
  printf 'old-%s\n' "$role" > "$supervision_rollback_dir/org-plan-$role.toml"
  chmod "$((600 + rollback_index))" "$supervision_rollback_dir/org-plan-$role.toml"
done
rollback_before=$(cksum "$supervision_rollback_dir"/*.toml)
rollback_modes=$(for file in "$supervision_rollback_dir"/*.toml; do stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file"; done)
expect_status 143 env PATH="$mv_interrupt_bin:$PATH" MOVE_COUNTER="$tmp/supervision-moves" "$helper" prepare-supervision --agents-dir "$supervision_rollback_dir"
test "$rollback_before" = "$(cksum "$supervision_rollback_dir"/*.toml)" && pass || fail 'interrupted supervision install restores all old profiles'
test "$rollback_modes" = "$(for file in "$supervision_rollback_dir"/*.toml; do stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file"; done)" && pass || fail 'supervision rollback preserves all old modes'
test -z "$(find "$supervision_rollback_dir" -name '.org-plan-stage.*' -print -quit)" && pass || fail 'supervision rollback cleans stage directory'
test ! -s "$tmp/out" && pass || fail 'supervision rollback prints no success result'

for command in prepare-executor prepare-supervision; do
  for link_kind in valid dangling; do
    symlink_dir="$tmp/symlink-$command-$link_kind"
    mkdir -p "$symlink_dir"
    if [[ $command == prepare-executor ]]; then link_path="$symlink_dir/org-plan-executor.toml"; else link_path="$symlink_dir/org-plan-supervisor.toml"; fi
    link_target="$symlink_dir/target.toml"
    if [[ $link_kind == valid ]]; then printf 'unchanged-target\n' > "$link_target"; chmod 640 "$link_target"; link_value=$link_target; else link_value="$symlink_dir/missing-target.toml"; fi
    ln -s "$link_value" "$link_path"
    link_before=$(readlink "$link_path")
    target_before= target_mode=; [[ $link_kind == dangling ]] || { target_before=$(cksum "$link_target"); target_mode=$(stat -c '%a' "$link_target" 2>/dev/null || stat -f '%Lp' "$link_target"); }
    expect_fail "$helper" "$command" --agents-dir "$symlink_dir"
    test -L "$link_path" && test "$link_before" = "$(readlink "$link_path")" && pass || fail "$command preserves $link_kind destination symlink"
    [[ $link_kind == dangling ]] || { test "$target_before" = "$(cksum "$link_target")" && pass || fail "$command preserves symlink target"; }
    [[ $link_kind == dangling ]] || { test "$target_mode" = "$(stat -c '%a' "$link_target" 2>/dev/null || stat -f '%Lp' "$link_target")" && pass || fail "$command preserves symlink target mode"; }
    test -z "$(find "$symlink_dir" -name '.org-plan-stage.*' -print -quit)" && pass || fail "$command rejects symlink before staging"
    test ! -s "$tmp/out" && pass || fail "$command symlink rejection prints no success result"
  done
done

collision_bin="$tmp/collision-bin"
mkdir -p "$collision_bin"
printf '#!/bin/sh\nreal_mkdir=%s\ncase "$*" in *org-plan-stage.*) "$real_mkdir" "$@" || exit; for last do :; done; test "${COLLISION_NONEMPTY:-0}" != 1 || printf foreign > "$last/sentinel"; exit 1 ;; *) exec "$real_mkdir" "$@" ;; esac\n' "$real_mkdir" > "$collision_bin/mkdir"
chmod +x "$collision_bin/mkdir"
for command in prepare-executor prepare-supervision; do
  for collision_kind in empty nonempty; do
    collision_dir="$tmp/collision-$command-$collision_kind-agents"
    if [[ $collision_kind == nonempty ]]; then collision_nonempty=1; else collision_nonempty=0; fi
    expect_fail env PATH="$collision_bin:$PATH" COLLISION_NONEMPTY="$collision_nonempty" "$helper" "$command" --agents-dir "$collision_dir"
    foreign_stage=$(find "$collision_dir" -maxdepth 1 -type d -name '.org-plan-stage.*' -print -quit)
    test -n "$foreign_stage" && pass || fail "$command preserves foreign $collision_kind colliding stage directory"
    [[ $collision_kind == empty ]] || { test -f "$foreign_stage/sentinel" && pass || fail "$command preserves foreign collision sentinel"; }
    test ! -s "$tmp/out" && pass || fail "$command $collision_kind collision prints no success result"
  done
done

encoded_dir="$tmp/encoded agents%="
encoded_dir="$encoded_dir"$'\tline\nnext'
expect_ok "$helper" prepare-supervision --agents-dir "$encoded_dir"
test "$(wc -l < "$tmp/out")" = 1 && pass || fail 'encoded success output is exactly one record'
python3 -c 'import sys, urllib.parse; fields=dict(item.split("=", 1) for item in open(sys.argv[1], encoding="ascii").read().strip().split(" ")); expected=sys.argv[2]; assert urllib.parse.unquote(fields["supervisor_profile"]) == expected + "/org-plan-supervisor.toml"; assert urllib.parse.unquote(fields["executor_profile"]) == expected + "/org-plan-executor.toml"; assert urllib.parse.unquote(fields["root_reviewer_profile"]) == expected + "/org-plan-reviewer.toml"' "$tmp/out" "$encoded_dir" && pass || fail 'encoded profile paths round-trip without eval'
expect_contains "$tmp/out" '%20'
expect_contains "$tmp/out" '%25'
expect_contains "$tmp/out" '%3D'
expect_contains "$tmp/out" '%09'
expect_contains "$tmp/out" '%0A'
expect_ok "$helper" prepare-executor --agents-dir "$encoded_dir" --profile-name encoded-executor
test "$(wc -l < "$tmp/out")" = 1 && pass || fail 'legacy encoded success output is exactly one record'
python3 -c 'import sys, urllib.parse; fields=dict(item.split("=", 1) for item in open(sys.argv[1], encoding="ascii").read().strip().split(" ")); assert urllib.parse.unquote(fields["profile"]) == sys.argv[2] + "/encoded-executor.toml"' "$tmp/out" "$encoded_dir" && pass || fail 'legacy encoded profile path round-trips without eval'
expect_fail "$helper" prepare-executor --model
expect_contains "$tmp/err" 'usage: org-plan'
test ! -e "$tmp/.codex/agents/org-plan-executor.toml" && pass || fail 'tests avoid the default agents directory'

supervision_dir="$tmp/supervision-agents"
expect_ok "$helper" prepare-supervision --agents-dir "$supervision_dir"
expect_contains "$tmp/out" 'supervisor=org-plan-supervisor supervisor_model=gpt-5.6-luna'
expect_contains "$tmp/out" 'executor=org-plan-executor executor_model=gpt-5.6-terra'
expect_contains "$tmp/out" 'root_reviewer=org-plan-reviewer root_reviewer_model=gpt-5.6-sol'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'model = "gpt-5.6-luna"'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'mechanical evidence gates'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'You are the depth-one supervisor.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'The director/reviewer is the depth-zero root agent in the user conversation.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Coordinate only the depth-two executor'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'delegate all implementation and corrective edits only to that executor'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'report only to the director.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Never spawn a reviewer.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'send a complete standalone review request upward to the director'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'uncommitted L1 diff against its starting commit'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'wait for the director explicit ACCEPT or REJECT verdict.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'keep all L1 implementation and review-correction changes uncommitted until ACCEPT'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'create exactly one conventional commit for the accepted L1 when files changed'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'only then mark that L1 REVIEWED'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Leave rejected L1s UNREVIEWED and uncommitted for correction and re-review'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'never request fixup or autosquash commits'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'reset materially changed accepted L1s to UNREVIEWED before correction'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'When none are pending, skip the review request and report review already current.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Final acceptance requires a current full-suite pass and clean intended scope, never whole-branch re-review.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Run potentially large repository inspections, test commands, and log processing through an available context-preserving execution path'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'derives milestone evidence without injecting raw output into conversational context'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'If none is available, capture output outside conversational context and report only the command, exit status, pass/fail counts, affected scope, and the smallest diagnostic excerpt needed for a failure.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Keep short fixed-output observations direct.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Apply the same rule to director-side verification'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'never put raw command output in supervisor or director reports.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Context-mode is acceptable only when already available; do not install, require, or silently enable any context-management plugin.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'For the first human-facing mention of a milestone, use org-plan describe and report its position, title, and Goal or Why'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Include the current L1 position and title in progress reports'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'never identify it only by ordinal or raw ID.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'For the first human-facing mention of a commit, use a simple read-only Git query and report its conventional subject plus concise purpose before any optional short hash'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'later use the subject or milestone title, never a hash alone.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Machine-readable fresh assignments still carry exact IDs, starting commit hashes, and accepted L1 commit IDs.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Filter executor output into upstream decisions, actionable findings, commit IDs, test commands with pass/fail summaries, dirty-scope results, and blockers'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'smallest relevant diagnostic excerpt when needed to understand a failure, never raw logs or complete transcripts.'
expect_not_contains "$supervision_dir/org-plan-supervisor.toml" 'sandbox_mode ='
expect_contains "$supervision_dir/org-plan-executor.toml" 'model = "gpt-5.6-terra"'
expect_contains "$supervision_dir/org-plan-executor.toml" 'You are the depth-two executor and the only code writer.'
expect_contains "$supervision_dir/org-plan-executor.toml" 'Keep all implementation and review-correction changes uncommitted until the director explicitly ACCEPTS the L1.'
expect_contains "$supervision_dir/org-plan-executor.toml" 'After ACCEPT, create exactly one conventional commit for the accepted L1 when files changed.'
expect_contains "$supervision_dir/org-plan-executor.toml" 'Never create pre-review, fixup, or autosquash commits.'
expect_contains "$supervision_dir/org-plan-executor.toml" 'Return only concise structured evidence to the supervisor, never directly to the director'
expect_not_contains "$supervision_dir/org-plan-executor.toml" 'Return only concise structured evidence to the director'
expect_not_contains "$supervision_dir/org-plan-executor.toml" 'sandbox_mode ='
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'model = "gpt-5.6-sol"'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'sandbox_mode = "read-only"'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'You are the depth-zero read-only director/reviewer in the user conversation.'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'recommended root launch profile'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'spawn the depth-one org-plan supervisor; never spawn a separate reviewer'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Show brief user-facing console status'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'L1 POSITION/TOTAL — TITLE: STATUS'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Review each complete upward request from the supervisor'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'uncommitted diff against the L1 starting commit'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'shared-code regression impact, and named evidence'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Targeted shared context may be inspected without reopening accepted criteria.'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'If a requested L1 is REVIEWED, skip it without re-auditing it.'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'explicit ACCEPT or REJECT verdict'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Return concise structured findings with evidence'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'verdict to the supervisor.'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Never expose raw logs or complete child transcripts to the user.'
for role in supervisor executor reviewer; do
  python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$supervision_dir/org-plan-$role.toml" && pass || fail "$role profile is parseable TOML"
  test "$(stat -c '%a' "$supervision_dir/org-plan-$role.toml" 2>/dev/null || stat -f '%Lp' "$supervision_dir/org-plan-$role.toml")" = 600 && pass || fail "new $role profile mode is 600"
  expect_not_contains "$supervision_dir/org-plan-$role.toml" 'Luna'
  expect_not_contains "$supervision_dir/org-plan-$role.toml" 'Terra'
  expect_not_contains "$supervision_dir/org-plan-$role.toml" 'Sol'
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
expect_contains "$tmp/out" 'root_reviewer=test-reviewer root_reviewer_model=sol-test'
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --supervisor-model
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --reviewer-model 'bad"model'
expect_contains "$tmp/err" 'invalid model: bad"model'
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --executor-profile-name Bad_Name
expect_contains "$tmp/err" 'invalid profile name: Bad_Name'
expect_fail "$helper" prepare-supervision --agents-dir "$override_dir" --executor-profile-name same --reviewer-profile-name same
expect_contains "$tmp/err" 'profile names must be distinct'

failure_dir="$tmp/failure-agents"
mkdir -p "$failure_dir/org-plan-reviewer.toml"
expect_fail "$helper" prepare-supervision --agents-dir "$failure_dir"
expect_contains "$tmp/err" 'profile destination is not a regular file'
test ! -e "$failure_dir/org-plan-supervisor.toml" && pass || fail 'failed preparation does not install supervisor'
test ! -e "$failure_dir/org-plan-executor.toml" && pass || fail 'failed preparation does not install executor'
test -z "$(find "$failure_dir" -type f -name '.*.??????' -print -quit)" && pass || fail 'failed preparation cleans staged files'
test ! -s "$tmp/out" && pass || fail 'failed preparation prints no success result'
expect_contains "$skill" 'This section governs plan authoring only. Planner is a phase name, not a role in'
expect_contains "$skill" 'This section governs manual execution only. It is distinct from the supervised'
expect_contains "$skill" 'Supervised execution uses exactly three canonical roles:'
expect_contains "$skill" 'The **director/reviewer** is the depth-zero agent in the user'
expect_contains "$skill" 'Use the read-only `org-plan-reviewer` launch profile'
expect_contains "$skill" 'default model is `gpt-5.6-sol`'
expect_contains "$skill" 'launches the supervisor, reviews requested DONE + UNREVIEWED L1s'
expect_contains "$skill" 'The **supervisor** is the depth-one `org-plan-supervisor`, default model'
expect_contains "$skill" '`gpt-5.6-luna`'
expect_contains "$skill" 'It coordinates the executor, performs routine supervision'
expect_contains "$skill" 'requests review verdicts from the director'
expect_contains "$skill" 'It never spawns a reviewer.'
expect_contains "$skill" 'reports only to the director.'
expect_contains "$skill" 'The **executor** is the depth-two `org-plan-executor`, default model'
expect_contains "$skill" '`gpt-5.6-terra`. It is the only code writer'
expect_contains "$skill" 'reports only to the supervisor.'
expect_contains "$skill" 'The root launch profile and model are recommendations because a skill cannot'
expect_contains "$skill" 'change the model of an already-running root conversation.'
expect_contains "$skill" 'it adopts the director/reviewer contract in'
expect_contains "$skill" 'Model names are profile defaults'
expect_contains "$skill" 'canonical role names.'
expect_contains "$skill" 'profile plus the supervisor and executor profiles. Manual execution remains the'
expect_contains "$skill" 'Order L1s by implementation dependency'
expect_contains "$skill" 'Partition L1s into'
expect_contains "$skill" 'cohesive, reviewable use cases sized for one fresh executor.'
expect_contains "$skill" 'Make every L1 a'
expect_contains "$skill" 'standalone handoff: include its relevant starting context, prior-L1 dependencies'
expect_contains "$skill" 'Avoid hidden'
expect_contains "$skill" 'cross-L1 context, arbitrary equal-sized splits'
expect_contains "$skill" 'fresh executor can complete the L1 from the plan and repository alone.'
expect_contains "$skill" '`[agents] max_depth = 2` is required: the director/reviewer is depth zero,'
expect_contains "$skill" 'the supervisor is depth one, and the executor is depth two.'
expect_contains "$skill" 'The director spawns the supervisor with `fork_turns=none`'
expect_contains "$skill" 'The supervisor never spawns a reviewer.'
expect_contains "$skill" 'complete review request upward to the director'
expect_contains "$skill" 'Before each new L1, the supervisor verifies the preceding L1 is REVIEWED'
expect_contains "$skill" 'terminates any previous executor, confirms it is closed, then spawns a fresh'
expect_contains "$skill" 'for exactly that L1. Never carry an'
expect_contains "$skill" 'executor into another L1 or start the next L1 while the prior executor lives.'
expect_contains "$skill" 'The L1 executor remains available through that L1'
expect_contains "$skill" 'REJECT returns bounded corrections to the same executor'
expect_contains "$skill" 'implementation commit before the director'
expect_contains "$skill" 'After ACCEPT, the executor creates exactly one conventional commit for the'
expect_contains "$skill" 'accepted L1 when files changed. The supervisor verifies that commit, marks'
expect_contains "$skill" 'the L1 REVIEWED, terminates its executor, and confirms closure before'
expect_contains "$skill" 'write-capable child active'
expect_contains "$skill" 'Every assignment and upward review request must stand alone'
expect_contains "$skill" 'Only two subagents exist below the active root at once: the supervisor and its'
expect_contains "$skill" 'single executor.'
expect_contains "$skill" 'The executor returns concise evidence summaries only to the supervisor'
expect_contains "$skill" 'Its report and review request to'
expect_contains "$skill" 'the director contain only decisions, actionable findings, commit IDs or ranges,'
expect_contains "$skill" 'test commands with pass/fail summaries, dirty-scope results, blockers, and the'
expect_contains "$skill" 'smallest relevant diagnostic excerpt when a failure cannot be understood'
expect_contains "$skill" 'The supervisor runs potentially large repository inspections, test commands,'
expect_contains "$skill" 'available context-preserving execution path'
expect_contains "$skill" 'capture output outside conversational'
expect_contains "$skill" 'report only the command, exit status, pass/fail counts, affected'
expect_contains "$skill" 'scope, and the smallest diagnostic excerpt needed for a failure.'
expect_contains "$skill" 'Apply the same rule to director-side verification.'
expect_contains "$skill" 'operations must never enter supervisor or director reports.'
expect_contains "$skill" 'Do not install,'
expect_contains "$skill" 'context-mode is'
expect_contains "$skill" 'acceptable only when already available'
expect_contains "$skill" '## Human-readable director updates'
expect_contains "$skill" 'Keep the root active and show the user a brief console update'
expect_contains "$skill" 'Use `L1 POSITION/TOTAL — TITLE: STATUS`'
expect_contains "$skill" 'the supervisor resolves'
expect_contains "$skill" '`org-plan describe PLAN ID`'
expect_contains "$skill" 'For L1s, `describe` also supplies the stable plan position'
expect_contains "$skill" 'The exact ID may follow as supplemental data.'
expect_contains "$skill" 'identify a milestone only by an ordinal or raw ID.'
expect_contains "$skill" '`git show -s --format=%s COMMIT`'
expect_contains "$skill" 'before any optional short hash.'
expect_contains "$skill" 'hash remains supplemental and is never the only human-facing'
expect_contains "$skill" 'This human-prose contract does not alter machine-readable agent assignments.'
expect_contains "$skill" 'Fresh assignments continue to carry exact plan IDs, commit hashes or ranges'
expect_contains "$skill" 'By default, the director does not open, request, or forward complete child'
expect_contains "$skill" 'The supervisor enforces these acceptance gates:'
expect_contains "$skill" 'L2 changes remain uncommitted through the L1 review.'
expect_contains "$skill" 'no unintended dirty paths'
expect_contains "$skill" 'current touched-test evidence'
expect_contains "$skill" 'only DONE + UNREVIEWED L1s. Each fresh upward review request covers'
expect_contains "$skill" 'only the selected L1 and its uncommitted diff against the L1 starting commit,'
expect_contains "$skill" 'The director may inspect'
expect_contains "$skill" 'The director skips any REVIEWED L1 accidentally included in a request'
expect_contains "$skill" 'On ACCEPT, the executor creates exactly one'
expect_contains "$skill" 'conventional commit for the accepted L1 when files changed'
expect_contains "$skill" 'supervisor mark that L1 REVIEWED and close its executor.'
expect_contains "$skill" 'On REJECT, it'
expect_contains "$skill" 'UNREVIEWED and uncommitted while the supervisor returns corrections to the'
expect_contains "$skill" 'requesting a new verdict from the director.'
expect_contains "$skill" 'Never use'
expect_contains "$skill" 'fixup or autosquash commits for review corrections.'
expect_contains "$skill" 'REVIEWED L1 must first be reset to UNREVIEWED.'
expect_contains "$skill" 'the supervisor skips a review request'
expect_contains "$skill" 'redundant whole-branch reviewer audit.'
expect_contains "$skill" 'A reviewer REJECT verdict must contain actionable findings.'
expect_contains "$skill" 'returns the affected item to the executor for correction'
expect_contains "$skill" 'viewport sizes, and font-scale combinations.'
expect_contains "$skill" 'Non-UI work does not'
expect_contains "$skill" 'Each supervisor assignment states the plan path, target branch and base branch'
expect_contains "$skill" 'all prepared profile and model names, the complete L1/L2 loop, evidence gates,'
expect_contains "$skill" 'upward director-review request and per-L1 fresh-executor lifecycle'
expect_contains "$skill" 'root status'
expect_contains "$skill" '`[agents] max_depth = 2` nesting'
expect_contains "$skill" 'Each executor assignment states the active L1 and complete L2 block'
expect_contains "$skill" 'accepted prior-L1 outputs, exact allowed change scope, required tests'
expect_contains "$skill" 'the exactly-one-post-ACCEPT L1 commit rule, the prohibition on pre-review,'
expect_contains "$skill" 'fixup, and autosquash commits, preserved paths, the single-L1 lifetime'
expect_contains "$skill" 'Each upward review request states the plan path, target branch, the selected L1'
expect_contains "$skill" 'ID, position, title, and UNREVIEWED status'
expect_contains "$skill" 'read-only uncommitted diff'
expect_contains "$skill" 'impact, evidence locations, any applicable named UI screenshot/component/'
expect_contains "$skill" 'REVIEWED-request skip rule'
expect_contains "$skill" 'The director receives a complete'
expect_contains "$skill" 'upward request for every audit.'
expect_contains "$skill" 'Never rely on agent memory'
expect_contains "$skill" 'or use context'
expect_contains "$skill" '"continue above", including for nested agents.'
expect_contains "$skill" 'The supervisor classifies every failure before routing it:'
expect_contains "$skill" 'Routine mechanical failures return to the executor'
expect_contains "$skill" 'Reviewer findings return to the executor unchanged in substance'
expect_contains "$skill" 'Material ambiguity invokes the director/reviewer for a read-only options'
expect_contains "$skill" 'director to obtain the user'
expect_contains "$skill" 'executor choose an unresolved material requirement.'
expect_contains "$skill" 'the supervisor reruns the applicable L2 or L1 gate'
expect_contains "$skill" 'new director verdict while the milestone remains UNREVIEWED.'
expect_contains "$skill" 'the supervisor explicitly resets it to'
expect_contains "$skill" 'all L1s are REVIEWED'
expect_contains "$skill" 'it becomes REVIEWED only after reviewer acceptance.'
sed -n '/^# Supervised execution$/,/^# Executor$/p' "$skill" >"$tmp/supervised-skill"
expect_not_contains "$tmp/supervised-skill" 'planner'
expect_not_contains "$tmp/supervised-skill" 'Luna'
expect_not_contains "$tmp/supervised-skill" 'Terra'
expect_not_contains "$tmp/supervised-skill" 'Sol'
expect_contains "$readme" '## Org Plan supervised execution'
expect_contains "$readme" 'director/reviewer (depth 0, org-plan-reviewer, Sol, read-only)'
expect_contains "$readme" 'supervisor (depth 1, org-plan-supervisor, Luna)'
expect_contains "$readme" 'executor (depth 2, org-plan-executor, Terra, only code writer)'
expect_contains "$readme" 'The supervisor sends review'
expect_contains "$readme" 'requests upward to the director/reviewer and never spawns a reviewer.'
expect_contains "$readme" 'at most two subagents below it'
expect_contains "$readme" '`L1 2/5 — Validate release metadata: in review`'
expect_contains "$readme" 'Evidence flows upward as concise summaries; raw test and inspection'
expect_contains "$readme" 'director/reviewer audits only requested DONE + UNREVIEWED milestones.'
expect_contains "$readme" 'so later refinements review only new or'
expect_contains "$readme" 'Final acceptance still requires a current full-suite'
expect_contains "$agents" '## Org Plan supervised workflow invariants'
expect_contains "$agents" 'The director/reviewer is depth zero in the user'
expect_contains "$agents" 'recommended read-only `org-plan-reviewer` launch profile defaults to Sol'
expect_contains "$agents" 'an already-running root keeps its CLI-selected model.'
expect_contains "$agents" 'The supervisor never spawns a reviewer; it requests each review upward from'
expect_contains "$agents" 'Every L1 must have exactly one `:REVIEW_STATUS:` property, initially'
expect_contains "$agents" '`UNREVIEWED`; L2s must not have one.'
expect_contains "$agents" '`REVIEWED` is valid only after reviewer'
expect_contains "$agents" 'Reopening a reviewed L1 as WIP resets it to'
expect_contains "$agents" 'reset a completed reviewed L1 explicitly before any material'
expect_contains "$agents" '`org-plan next PLAN review` to select the first DONE + UNREVIEWED L1'
expect_contains "$agents" '`org-plan review PLAN ID REVIEWED|UNREVIEWED` for durable transitions'
expect_contains "$agents" '`org-plan describe PLAN ID` for stable title plus Goal/Why text.'
expect_contains "$agents" 'skips already REVIEWED milestones'
expect_contains "$agents" 'Keep one writer active.'
expect_contains "$agents" 'delegates implementation and corrective'
expect_contains "$agents" 'edits only to the executor; the director/reviewer is read-only.'
expect_contains "$agents" 'available context-preserving execution path.'
expect_contains "$agents" 'capture'
expect_contains "$agents" 'output outside conversational context and report only the command, exit'
expect_contains "$agents" 'status, pass/fail counts, affected scope, and smallest necessary failure'
expect_contains "$agents" 'Do not install,'
expect_contains "$agents" 'require, or silently enable an optional context-management plugin.'
expect_contains "$agents" 'Keep the root active and post brief human-facing status'
expect_contains "$agents" 'Use `L1 POSITION/TOTAL — TITLE: STATUS` when possible.'
expect_contains "$agents" '`org-plan describe` and lead with its position, title,'
expect_contains "$agents" 'first commit mention with its conventional subject and purpose; IDs and hashes'
expect_contains "$agents" 'Final acceptance requires the supervisor to verify a current full-suite pass'
expect_contains "$agents" 'It does not repeat reviewer audits for REVIEWED L1s.'
expect_contains "$manifest" 'Dyne.org Gestalt'
expect_contains "$manifest" 'Org Plan'
expect_contains "$manifest" 'adapted Superpowers workflows'

if [ "$failures" -ne 0 ]; then printf '%s passed, %s failed\n' "$passes" "$failures"; exit 1; fi
printf '%s passed\n' "$passes"
