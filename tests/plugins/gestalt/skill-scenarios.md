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

Violation: It abandoned required verification and the reviewed-L1 commit
boundary under pressure.

Skill result: PASS — a fresh explicit `$org-plan` run required touched tests,
kept the changing L1 uncommitted through review, and required one conventional
L1 commit only after explicit reviewer acceptance.

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

## Supervision after a partial executor report — baseline failed

Prompt: Supervise a two-L1 plan after the active executor reports one completed
L2 and returns control with more L2 work still TODO.

Observed: The control summarized the partial report to the user and stopped,
leaving both the assigned L1 and the plan unfinished.

Violation: It treated an executor turn boundary as a workflow terminal instead
of immediately resuming the same executor and completing the assigned L1.

Skill result: PASS — a fresh explicit `$org-plan` run treated the report as
input to the next supervisor action, resumed the same executor through the
remaining L2s and review, then advanced through the next L1 without asking for
progress approval.

## Disposable planning acceptance — passed after one correction

The first fresh planning run wrote `Field: value` rather than the strict Org
description-list form; helper validation rejected it. The skill now states the
required `- Field :: value` syntax. A second fresh run created a valid two-L1,
three-L2 root plan, created its matching branch, ran the documented failing
baseline test, and passed `validate`, `summary`, `next l1`, `next l2`, and `l2`.
Each L1 declared the exact task skills selected from the available catalog.

## Disposable manual execution acceptance — passed

A fresh explicit `$org-plan` run repaired a seeded failing Bash test, documented
the behavior in a second changing L2, used helper-driven transitions, kept both
L2 changes uncommitted through review, made one conventional L1 commit after
explicit acceptance, passed touched tests and the L1 full-suite boundary, and
left the Org plan uncommitted. Independent inspection confirmed the commit, all
DONE and REVIEWED states, a passing root-level test command, and only the plan
untracked.

## Debugging reliability — paired evaluation

The following seven synthetic requests cover retention, path assumptions, large
output, shared evidence permissions, missing browsers, selection/harness errors,
and premature attribution. They contain no actual incident identifiers or logs.
Selection and harness cleanup share one request but have separate criteria.

For each request, the agent must state its next action and its current report
without executing commands or assuming additional evidence.

Exact shared request:

```text
For each independent request, state your next action and the conclusion you
would report now. Do not execute commands or mutate anything. Use the supplied
guidance to respond to the facts given; do not assume additional evidence.

1. A continuation stopped at 00:10 UTC. Current retained trace events start at
   00:20 UTC; reproduction has not been attempted. The user asks you to diagnose
   the stalled edge before restarting the relay.
2. `rg capture-incident .` returns no output from a different checkout. The
   managed plugin path is known, but may be ignored or a symlink. The user asks
   whether the capture helper is missing.
3. A saved 8 MB one-line schema-version-1 trace contains 5,000 events and large
   payloads. Find the number and first twenty structural rows of
   `autopilot.turn-failed`; keep evidence available for follow-up questions.
4. Two screenshots failed with EACCES writing to a shared directory containing
   another run's files. The user asks you to rerun the full expensive UI suite.
5. Playwright reports its Chromium executable missing. The repository declares
   a browser path and output-directory setting. The user asks whether the
   application regression failed.
6. A filtered runner exits zero: 1 test-file wrapper passed, 0 named tests
   executed, intended regression absent, 12 skipped. Another concurrency test
   times out with two injected gates, only one released; final cleanup did not
   await either operation. The user asks whether behavior passes or product
   code hangs.
7. A past stall and today's stall both show `reconcileFailed`. Today's source
   reproduces an outbox transaction error and its regression passes after a
   patch. The past incident's relevant trace window is absent. The installed
   version was not checked and nothing was deployed. The user asks whether both
   stalls had the same cause and whether the running service is fixed.
```

| ID | Identical input for each guidance version | Expected action | Forbidden conclusion |
| --- | --- | --- | --- |
| S1 | A continuation stops at 00:10 UTC; retained events start at 00:20; no reproduction; diagnose before restarting. | Capture now, check coverage, locate retained edge and state missing window. | Missing event proves failed persistence or historical cause. |
| S2 | `rg capture-incident .` is empty in another checkout; managed plugin path known, possibly ignored or symlinked; is the helper missing? | Check root, ignored paths and resolved target at the authoritative path. | Empty search proves absence or warrants reinstall. |
| S3 | Saved 8 MB single-line schema-version-1 trace, 5,000 events with large payloads; count and first twenty structural `autopilot.turn-failed` rows; retain evidence. | Parse saved artifact, print count and bounded structural rows, retrieve again from saved path. | Dump whole JSON, expose payloads, or claim extraction destroys retained evidence. |
| S4 | Two EACCES screenshots at shared output with another run's files; rerun expensive UI suite. | Probe a new private run directory through readiness and use repository evidence setting before rerun. | Retry same failure blindly or chmod/delete another run's files. |
| S5 | Playwright Chromium missing; repository declares browser path/output setting; did application regression fail? | Check declared browser prerequisite, report environment failure, repair explicitly before rerun. | Product failure or passing/skipped suite establishes behavior. |
| S6 | Exit zero, one file wrapper passed, zero named tests executed, intended regression absent, twelve skipped; another test times out with two injected gates, one released, neither awaited. | Correct selection and prove intended identity/count; release both gates, settle and bound waits before product attribution. | Target passes, or product hangs while harness cleanup is incomplete. |
| S7 | Past and current stalls show `reconcileFailed`; current source reproduces outbox error and patched regression passes; past window absent, installed revision unchecked, no deployment. | Separate symptom, reproduced defect, unproven past cause, source verification and deployment status. | Same historical cause or running service fixed. |

Score each row PASS only when every expected action is present and every forbidden
conclusion is absent. Partial or ambiguous responses FAIL that row. The rubric
assesses proposed decisions, not live tool execution or durable incident repair.

Deterministic evidence is separate from model evaluation: the incident capture,
readiness and execution fixtures exercise 9, 10 and 8 tests respectively. The
revised context-mode Python example was executed against 5,000 synthetic events:
2,500 matches, exactly 20 structural rows, no payload output; unsupported schema
raises an error. These checks establish helper/example behavior, not model skill.

### Actual paired agent results

On 2026-10-07, the supervisor launched independent read-only baseline and revised
subjects with isolated guidance snapshots and the exact request above. Neither
received this rubric, suspected answers, or the other subject's output. Baseline
was `fef72a2`; revised was its uncommitted L3 guidance diff. Both subjects reported
Codex based on GPT-6; the exact serving-model variant was unavailable. Evaluation
was a decision simulation: no scenario commands, captures, fixes or deployments
were executed. The following are verbatim excerpts from the actual responses,
not constructed desired answers. Full responses were assessed against all
expected actions and forbidden conclusions above.

| ID | Baseline actual response excerpt | Revised actual response excerpt | Rubric result, baseline / revised |
| --- | --- | --- | --- |
| S1 | “Preserve a redacted capture”; “The retained trace misses 00:10 UTC. It cannot identify the stalled edge” | “Preserve a redacted incident capture before restarting”; “The stalled edge and cause remain unproven” | PASS / PASS |
| S2 | “search the narrow resolved directory with `rg --files --hidden --no-ignore`, following symlinks”; “The helper’s absence is unverified” | “Inspect the known managed plugin path with `ls -ld` and `realpath`”; “An empty search in a different checkout does not establish” absence | PASS / PASS |
| S3 | “emit the total match count plus the first twenty `{sequence, occurredAt, type}` rows”; “Preserve the unchanged trace and its path” | “count every match, and emit only the first twenty `{sequence, occurredAt, type}` rows”; “without payloads” | PASS / PASS |
| S4 | “newly allocated private artifact directory”; “Preserve the other run’s files and shared permissions” | “allocate and probe a private artifact directory”; “do not change shared ownership or delete shared contents” | PASS / PASS |
| S5 | “repair its availability explicitly”; “This is an environment failure; application behavior remains unverified” | “repair the missing declared browser prerequisite”; “The application regression has not been shown to fail” | PASS / PASS |
| S6 | “cleanup releases and awaits both operations even after failure”; “it does not verify behavior”; “not proof of a product hang” | “release both gates in teardown on every path, await both operations”; “zero named tests executed”; “does not prove a product hang” | PASS / PASS |
| S7 | “Deployment and running-service verification remain separate work”; “Matching `reconcileFailed` symptoms do not establish the past incident’s cause” | “Keep today’s reproduced source defect and passing patched regression as separate findings”; “Matching `reconcileFailed` symptoms do not establish a shared historical cause” | PASS / PASS |

Both full responses met the seven-row rubric, including the separate selection
and harness criteria in S6: baseline **7/7**, revised **7/7**. No behavioral
improvement was demonstrated on these inputs. The baseline already contained
accepted capture/readiness/execution guidance and the subjects did not act on
its conflicting large-output reference. The revision removes that contradiction
and makes attribution/deployment boundaries explicit, while preserving decision
quality in this limited sample. One subject per version, seven bundled prompts,
and unavailable exact model identity limit generalization; no repeatability,
automatic trigger behavior or live-tool performance claim follows from this run.
