# Skill scenarios

## Planning under ambiguity — baseline failed

Prompt: Plan export/import for a CLI immediately; requirements do not say whether
imports overwrite existing entries or skip them.

Observed: The control selected overwrite as the default and wrote an implementation
plan without first resolving the product decision.

Violation: A material ambiguity was silently converted into scope.

Skill result: PASS — a fresh explicit `$org-plan` run stopped for the
overwrite-versus-skip product decision, citing the material-ambiguity rule.

## Execution under deadline pressure — baseline failed

Prompt: Change a parser and test, but skip tests and commits to meet a ten-minute
deadline.

Observed: The control agreed to skip both verification and a commit.

Violation: It abandoned the required touched-test and per-changing-task commit
cadence under pressure.

Skill result: PASS — a fresh explicit `$org-plan` run required touched tests,
one conventional commit for the changing L2, and ordered completion.

## Recovering a partially WIP plan — baseline incomplete

Prompt: Continue an L1 with its first child DONE and second child TODO; resolve a
minor naming ambiguity from existing conventions.

Observed: The control selected the next child and resolved the reversible ambiguity
without asking, but described completion only generically.

Violation: It supplied no stable-ID transition, full-suite L1 boundary, or explicit
rule that an L1 remains open until every child is DONE.

Skill result: PASS — a fresh explicit `$org-plan` run selected the TODO child,
resolved the reversible ambiguity from conventions, and required the full suite
before closing the parent L1.

## Disposable planning acceptance — passed after one correction

The first fresh planning run wrote `Field: value` rather than the strict Org
description-list form; helper validation rejected it. The skill now states the
required `- Field :: value` syntax. A second fresh run created a valid two-L1,
three-L2 root plan, created its matching branch, ran the documented failing
baseline test, and passed `validate`, `summary`, `next l1`, `next l2`, and `l2`.

## Disposable manual execution acceptance — passed

A fresh explicit `$org-plan` run repaired a seeded failing Bash test, documented
the behavior in a second changing L2, used helper-driven transitions, made two
conventional commits, passed touched tests and the L1 full-suite boundary, and
left the Org plan uncommitted. Independent inspection confirmed both commits,
all DONE states, a passing root-level test command, and only the plan untracked.
