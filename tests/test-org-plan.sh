#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
helper="$root/plugins/org-plan/skills/org-plan/scripts/org-plan"
fixtures="$root/tests/fixtures"
skill="$root/plugins/org-plan/skills/org-plan/SKILL.md"
manifest="$root/plugins/org-plan/.codex-plugin/plugin.json"
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
  awk '
    /^\* / { l1 = 1 }
    { print }
    l1 && /^:ID:/ { print ":REVIEW_STATUS: UNREVIEWED"; l1 = 0 }
  ' "$fixtures/$1" >"$tmp/$2"
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
test "$(<"$tmp/out")" = $'L1 First outcome\nGoal: Test order.' && pass || fail 'describe prints stable L1 text'
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
test "$(<"$tmp/out")" = $'L1 First outcome with  internal spaces\nGoal: Text with  internal spaces.' && pass || fail 'describe output is whitespace-safe'

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
expect_contains "$profile" 'Return only concise structured evidence to the planner, never raw logs or complete transcripts.'
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
python3 -c 'import sys, urllib.parse; fields=dict(item.split("=", 1) for item in open(sys.argv[1], encoding="ascii").read().strip().split(" ")); expected=sys.argv[2]; assert urllib.parse.unquote(fields["supervisor_profile"]) == expected + "/org-plan-supervisor.toml"; assert urllib.parse.unquote(fields["executor_profile"]) == expected + "/org-plan-executor.toml"; assert urllib.parse.unquote(fields["reviewer_profile"]) == expected + "/org-plan-reviewer.toml"' "$tmp/out" "$encoded_dir" && pass || fail 'encoded profile paths round-trip without eval'
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
expect_contains "$tmp/out" 'reviewer=org-plan-reviewer reviewer_model=gpt-5.6-sol'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'model = "gpt-5.6-luna"'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'mechanical evidence gates'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'select only DONE + UNREVIEWED L1s for read-only Sol verdicts'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'mark only accepted L1s REVIEWED, leave rejected L1s UNREVIEWED for correction and re-review'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'reset materially changed accepted L1s to UNREVIEWED before correction'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'When none are pending, skip Sol and report review already current.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Final acceptance requires a current full-suite pass and clean intended scope, never whole-branch Sol re-review.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Run potentially large repository inspections, test commands, and log processing through an available context-preserving execution path'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'derives milestone evidence without injecting raw output into conversational context'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'If none is available, capture output outside conversational context and report only the command, exit status, pass/fail counts, affected scope, and the smallest diagnostic excerpt needed for a failure.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Keep short fixed-output observations direct.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Apply the same rule to director-side verification'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'never put raw command output in supervisor or director reports.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Context-mode is acceptable only when already available; do not install, require, or silently enable any context-management plugin.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'For the first human-facing mention of a milestone, use org-plan describe and report its title plus Goal or Why'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'later use the title without repeating the description'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'never identify it only by ordinal or raw ID.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'For the first human-facing mention of a commit, use a simple read-only Git query and report its conventional subject plus concise purpose before any optional short hash'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'later use the subject or milestone title, never a hash alone.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Machine-readable fresh assignments still carry exact IDs and commit hashes or ranges.'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'Filter child output into upstream decisions, actionable findings, commit IDs or ranges, test commands with pass/fail summaries, dirty-scope results, and blockers'
expect_contains "$supervision_dir/org-plan-supervisor.toml" 'smallest relevant diagnostic excerpt when needed to understand a failure, never raw logs or complete transcripts.'
expect_not_contains "$supervision_dir/org-plan-supervisor.toml" 'sandbox_mode ='
expect_contains "$supervision_dir/org-plan-executor.toml" 'model = "gpt-5.6-terra"'
expect_contains "$supervision_dir/org-plan-executor.toml" 'exactly one conventional commit'
expect_contains "$supervision_dir/org-plan-executor.toml" 'Return only concise structured evidence to Luna, never raw logs or complete transcripts.'
expect_not_contains "$supervision_dir/org-plan-executor.toml" 'sandbox_mode ='
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'model = "gpt-5.6-sol"'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'sandbox_mode = "read-only"'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Review only an assigned DONE + UNREVIEWED L1'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'shared-code regression impact, and named evidence'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Targeted shared context may be inspected without reopening accepted criteria.'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'If an assigned L1 is REVIEWED, skip it and report the skip without re-auditing it.'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'explicit ACCEPT or REJECT verdict'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'Return only concise structured findings with evidence'
expect_contains "$supervision_dir/org-plan-reviewer.toml" 'never raw logs or complete transcripts.'
for role in supervisor executor reviewer; do
  python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$supervision_dir/org-plan-$role.toml" && pass || fail "$role profile is parseable TOML"
  test "$(stat -c '%a' "$supervision_dir/org-plan-$role.toml" 2>/dev/null || stat -f '%Lp' "$supervision_dir/org-plan-$role.toml")" = 600 && pass || fail "new $role profile mode is 600"
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
expect_contains "$skill" 'New L1s start'
expect_contains "$skill" ':REVIEW_STATUS: UNREVIEWED'
expect_contains "$skill" 'planner spawns Luna with `fork_turns=none`'
expect_contains "$skill" 'Luna spawns Terra with `fork_turns=none`'
expect_contains "$skill" 'every Sol review with'
expect_contains "$skill" '`fork_turns=none` and a fresh, complete, explicit assignment'
expect_contains "$skill" 'only one write-capable child active'
expect_contains "$skill" 'waits for Terra to finish'
expect_contains "$skill" 'follow-up assignments'
expect_contains "$skill" 'without inherited conversation context'
expect_contains "$skill" 'Terra and Sol return concise evidence summaries, never raw logs or complete'
expect_contains "$skill" 'transcripts. Luna distills child results without concealing or reinterpreting'
expect_contains "$skill" "Luna's upstream report contains only decisions, actionable findings,"
expect_contains "$skill" 'commit IDs or ranges, test commands with pass/fail summaries, dirty-scope'
expect_contains "$skill" 'results, blockers, and the smallest relevant diagnostic excerpt when a failure'
expect_contains "$skill" 'cannot be understood without it.'
expect_contains "$skill" 'Luna runs potentially large repository inspections, test commands, and log'
expect_contains "$skill" 'processing through an available context-preserving execution path that derives'
expect_contains "$skill" 'milestone evidence without injecting raw output into conversational context.'
expect_contains "$skill" 'no such facility is available, capture output outside conversational context and'
expect_contains "$skill" 'report only the command, exit status, pass/fail counts, affected scope, and the'
expect_contains "$skill" 'smallest diagnostic excerpt needed for a failure. Keep short, fixed-output'
expect_contains "$skill" 'observations direct.'
expect_contains "$skill" 'Apply the same rule to director-side verification.'
expect_contains "$skill" 'operations must never enter supervisor or director reports.'
expect_contains "$skill" 'Do not install,'
expect_contains "$skill" 'require, or silently enable a context-management plugin; context-mode is'
expect_contains "$skill" 'acceptable only when already available, and the workflow must remain functional'
expect_contains "$skill" 'without it.'
expect_contains "$skill" '## Human-readable director updates'
expect_contains "$skill" 'On the first mention of an L1 or L2 in a supervision run, Luna resolves it with'
expect_contains "$skill" '`org-plan describe PLAN ID` and reports its title plus the concise Goal or Why'
expect_contains "$skill" 'The exact ID may follow as supplemental data. Later updates may use'
expect_contains "$skill" 'the title alone and do not repeat the full description.'
expect_contains "$skill" 'Never identify a'
expect_contains "$skill" 'milestone only by an ordinal such as "L2 2" or by its raw ID.'
expect_contains "$skill" 'On the first mention of a commit, Luna resolves its conventional subject with'
expect_contains "$skill" '`git show -s --format=%s COMMIT`'
expect_contains "$skill" 'reports that subject plus a concise purpose before any optional short hash.'
expect_contains "$skill" '`subject — purpose (short-hash)`'
expect_contains "$skill" 'references may use the subject or milestone title; a hash remains supplemental'
expect_contains "$skill" 'and is never the only human-facing identifier.'
expect_contains "$skill" 'This human-prose contract does not alter machine-readable agent assignments.'
expect_contains "$skill" 'Fresh assignments continue to carry exact plan IDs, commit hashes or ranges, and'
expect_contains "$skill" 'all other standalone execution boundaries.'
expect_contains "$skill" 'By default, the root does not open, request, or forward complete child'
expect_contains "$skill" 'transcripts. It may inspect a targeted part of a child thread only to investigate'
expect_contains "$skill" 'a named failure or material ambiguity; any subsequent upstream report remains'
expect_contains "$skill" 'summarized under this boundary.'
expect_contains "$skill" 'exactly one conventional implementation commit'
expect_contains "$skill" 'no unintended dirty paths'
expect_contains "$skill" 'current touched-test evidence'
expect_contains "$skill" 'only DONE + UNREVIEWED L1s'
expect_contains "$skill" 'Each fresh Sol assignment covers only the selected'
expect_contains "$skill" 'L1 and its commit range, Goal, Tests, Done-when criteria, shared-code regression'
expect_contains "$skill" 'Targeted shared context may be inspected when'
expect_contains "$skill" 'accepted criteria from REVIEWED L1s are not reopened.'
expect_contains "$skill" 'Sol skips any REVIEWED L1 accidentally included in an assignment'
expect_contains "$skill" 'On ACCEPT, Luna marks only the accepted L1'
expect_contains "$skill" 'On REJECT, it remains UNREVIEWED'
expect_contains "$skill" 'materially changed REVIEWED L1 must'
expect_contains "$skill" 'When `next PLAN review` finds nothing, Luna skips Sol'
expect_contains "$skill" 'already current. Final acceptance requires Luna'
expect_contains "$skill" 'clean intended scope, never a redundant whole-branch Sol audit.'
expect_not_contains "$skill" 'Sol audits the complete branch against its base'
expect_contains "$skill" 'Sol REJECT verdict must contain actionable findings'
expect_contains "$skill" 'returns the affected'
expect_contains "$skill" 'item to Terra for correction'
expect_contains "$skill" 'viewport sizes, and font-scale combinations'
expect_contains "$skill" 'Non-UI work does not'
expect_contains "$skill" 'Each Luna assignment states the plan path, target branch and base branch'
expect_contains "$skill" 'all'
expect_contains "$skill" 'prepared profile and model names'
expect_contains "$skill" 'complete L1/L2 loop, evidence gates'
expect_contains "$skill" 'review selection and status transitions, preserved'
expect_contains "$skill" 'paths, the `[agents] max_depth = 2` nesting requirement'
expect_contains "$skill" 'Each Terra assignment states the active L1 and complete L2 block'
expect_contains "$skill" 'target branch, its prepared profile and model names, exact allowed change scope,'
expect_contains "$skill" 'required tests, the exactly-one-commit rule, preserved paths, and the stop'
expect_contains "$skill" 'exactly-one-commit'
expect_contains "$skill" 'Each Sol assignment states the plan path, target branch, its prepared profile and'
expect_contains "$skill" 'model names, the selected L1 ID and UNREVIEWED status, its read-only commit range'
expect_contains "$skill" 'or diff, relevant Goal, Tests, and Done-when acceptance criteria, shared-code'
expect_contains "$skill" 'evidence locations'
expect_contains "$skill" 'regression impact, evidence locations, any applicable named UI'
expect_contains "$skill" 'screenshot/component/viewport/font-scale matrix, prohibited actions, preserved'
expect_contains "$skill" 'paths, the REVIEWED-assignment skip rule, the stop condition for material'
expect_contains "$skill" 'ambiguity, and the required structured findings with evidence plus an explicit'
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
expect_contains "$skill" 'requests a new'
expect_contains "$skill" 'Sol verdict while the milestone remains UNREVIEWED.'
expect_contains "$skill" 'Luna explicitly resets it to UNREVIEWED or reopens it'
expect_contains "$skill" 'all L1s are REVIEWED'
expect_contains "$skill" 'it becomes REVIEWED only after Sol accepts it.'
expect_contains "$manifest" 'strict manual execution or supervised execution'
expect_contains "$manifest" 'Luna, Terra, and Sol defaults'
expect_contains "$manifest" 'account access to the configured models'
expect_contains "$manifest" '[agents] max_depth = 2'

if [ "$failures" -ne 0 ]; then printf '%s passed, %s failed\n' "$passes" "$failures"; exit 1; fi
printf '%s passed\n' "$passes"
