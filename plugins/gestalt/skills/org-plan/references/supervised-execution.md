# Supervised Org Plan execution

Read this reference completely before launching supervised roles.

## Roles and ownership

```text
director (depth 0, org-plan-reviewer, Sol or Terra, read-only root)
└── executor (depth 1, only code writer)
```

- The root director also owns supervisor and reviewer duties. It owns user
  communication, directly launches each executor, enforces evidence gates, and
  returns ACCEPT or REJECT for DONE + UNREVIEWED L1s.
- The executor writes code for one L1 and reports only to the root.
- After every L1 executor has terminated, one fresh `gpt-5.6-sol` terminal
  reviewer audits the whole branch. It is the sole exception to the rule
  against separate reviewers and becomes the sole writer only for P0/P1 fixes.
- Recommended profiles are `org-plan-reviewer` (Sol) for a newly launched root
  and `org-plan-executor` (Terra). An already-running root keeps its selected
  model while adopting the combined director/reviewer/supervisor contract.
- Codex V1 agent depth defaults to one, which permits this direct spawn. Stop
  when direct spawning is unavailable; do not edit user configuration.

## Canonical positions and agent names

Use one-based positions independently of mutable IDs and titles. L1 position
`a` is `L<a>`; its L2 child position `b` is `L<a>.<b>`. Use these labels in
assignments, reports, reviews, commits, and user updates. IDs remain the exact
helper arguments.

The root's exact roster name is `l0`. The executor for L1 position `a` uses the
exact collaboration task name and roster identity `l<a>`: pass literal `l1`
for L1, `l2` for L2, and so on. Do not display or append a role, nickname,
milestone title, plan title, generated label, or uppercase plan position. A
physical replacement may use task name `l<a>_gN`, but its displayed canonical
identity remains exactly `l<a>`. Use the exact physical replacement identity
supplied by Mobile. Never increment a generation speculatively; choose the
first unused `l<a>_gN` only after the prior collaboration slot is confirmed
unavailable. L2 positions remain plan/report labels, never separate routine
agent names.

## Start supervision

The first tool call reads this skill completely and performs no other command.
Only after that standalone read returns may the root inspect guidance, the plan,
or repository state. This keeps discovery from running before the governing
startup contract has been loaded.

Treat the loaded skill directory and the plan path supplied by the user, host,
or authoring handoff as startup inputs. Reuse the exact supplied plan path.
Do not rediscover it with `find` or `rg`, and do not substitute
`REPOSITORY/.gestalt/` for `WORKSPACE/.gestalt/`. Resolve the helper once as
`scripts/org-plan` beneath the loaded skill directory and verify that it is
executable. Do not probe helper source or help before starting. If either input
is absent, stop with that one missing prerequisite instead of trying speculative
paths.

`prepare-supervision` is setup-only: `gestalt-setup.sh` installs or refreshes
the root and executor profiles. Do not run it during ordinary supervised
execution. A root already running in the user conversation adopts this contract
without reinstalling its own profile.

1. At the beginning of every new or resumed root session, validate the exact
   plan once and signal `supervision-start` before inspecting milestone state,
   recovering the roster, following up an executor, or spawning one. This
   signal is session-scoped, not plan-scoped: emit it even when the plan is
   already WIP or earlier L1s are REVIEWED. In Mobile's session-directory mode,
   the helper retains an existing signal for the same plan, preventing a later
   root turn from overriding explicit manual Off; a newly resumed relay session
   has a fresh directory and publishes its own signal. The root then
   runs `org-plan projection PLAN`,
   and calls host `update_plan` with its exact `plan` items, reporting the
   companion explanation separately.
2. Before each L1, verify the preceding L1 is REVIEWED, terminate the previous
   executor, confirm closure, and resolve the next milestone with
   `org-plan describe`.
3. Launch a fresh depth-one executor with `fork_turns=none` for exactly that L1,
   using task name `l<a>` for its canonical `L<a>` position. Only when that
   physical collaboration slot cannot be reused, use `l<a>_gN`; its displayed
   roster identity remains exactly `l<a>`. Use Mobile's exact supplied identity,
   or the first unused generation after confirming the prior slot unavailable;
   never increment it speculatively.
4. The executor loads `$gestalt:context-mode`, verifies every declared L1
   skill is available, then loads exactly those declared skills before any
   repository inspection or edit. Missing skills block without edits.

Both roles use host-native filesystem tools for governing instructions, small
bounded reads, edits, mutations, and short command interaction. Context-mode
is reserved for large or uncertain analysis, filtering, indexing, and retrieval;
it never writes or changes Org state.

## Human-attention decision table

`gestalt_org_plan_attention` is an optional mobile dynamic tool, not an
`$org-plan` dependency. Its current schema version is 1. Exhaust safe,
in-scope checks first. When a row below still prevents safe progress and the
tool is available, call it before sending any blocker response or yielding,
with a bounded summary, concrete `requestedAction`, and the mapped `reason` and
`resumeCondition`. Blocker prose is not a signal. A successful call is the
terminal disposition for that turn: issue no further lifecycle action and let
Mobile hold Autopilot until the matching resume event. When absent, report the
ordinary blocker concisely and continue normal supervision rather than
requiring the tool.

| Genuine blocker after safe checks | `reason` | `resumeCondition` |
| --- | --- | --- |
| Material plan scope, goal, or work change requires approval. | `planChange` | `planRevision` |
| An exhausted hard block requires external repair or an alternative. | `hardBlock` | `externalStateChanged` |
| A required system capability or declared task skill is unavailable. | `missingDependency` | `dependencyInstalled` |
| Missing authority, credentials, or permission prevents the work. | `permissionRequired` | `permissionGranted` |
| Verified relevant external state changed. | `externalState` | `externalStateChanged` |
| A material ambiguity remains after plan and repository evidence are exhausted. | `materialAmbiguity` | `userGuidance` |

Never call the tool for L1/L2 progress, a child report, waiting on a live child,
review readiness, a diagnosable or recoverable failing test, an ordinary merge
conflict, token/context pressure, elapsed time, a checkpoint, or an idle
executor. Resume the next legal supervision action in each of those cases.

## Activation and legal dispositions

Immediately after `org-plan signal PLAN supervision-start`, verify the retained
plan has Mobile control evidence. When it is enabled and healthy, use its
continuation mechanism. When Mobile or its status capability is unavailable,
write one bounded compatibility warning and continue supervision in the same
root turn; optional tooling must never become a reason to await the user.

Before yielding an incomplete plan, the root must select exactly one legal
disposition: perform actionable work now; follow up the same executor; review
and correct; checkpoint and report a DONE L2; checkpoint then hand off to the
next L1; register a one-shot wait lease; declare table-qualified attention; or
confirm explicit manual Off. A status update, progress report, or "waiting" statement
is not a disposition. Completion, error, interruption, idle transition,
process result, and a status question each wake the root to make that choice.
Do not create a probe or wait lease while actionable work exists.

## One-shot long-wait lease

Before yielding for work expected to take longer than the ordinary Autopilot
control interval, call `gestalt_autopilot_wait_lease` with version 2, unique
`reportId` and `leaseId` values, the smallest relevant `wakeConditions`, and
`maxWaitMs` between 60000 and 86400000. The first matching observable event or
the deadline resumes normal Autopilot control. This is one episode, not a pulse
policy change. If the wait remains justified after that later turn begins, the
root must reassess it and explicitly register another episode.

The root may yield only when the tool response contains `accepted:true`. An
unavailable tool or an `accepted:false` response means automatic continuation
is not guaranteed, so the root continues supervision in the same turn. If the
next action is delegated work, follow up the same executor immediately.
For an `accepted:false` response, `reason:"wakeAlreadySatisfied"` means the
executor event is already actionable. Do not retry the lease. Inspect the
executor's current report and state, then take the next legal lifecycle action
in the same turn.

For long L2 or subagent work, choose `executorChanged`. For a long observable
process, choose its process wake conditions. Do not use the lease for ordinary
work, to mask a stalled executor,
or when any immediate supervision action exists.
Never use a wait lease to await a checkpoint boundary or its continuation.

For GitHub PR CI, the root starts an owned synchronous watcher:

```sh
gh pr checks <PR> --watch --interval 30
```

Give the command only a short initial execution yield. If it is still running,
register the version 2 lease with `processExited` and
`processResultAvailable`, plus a realistic safety deadline. When the watcher
exits, read that same process result and continue the lifecycle. Mobile neither
holds GitHub credentials nor implements a parallel GitHub polling loop.
Version 1 remains only for the legacy probe-requested compatibility path.

## Evidence and review loop

Supervision is a completion loop:

- The executor owns the entire assigned L1, but returns a concise structured
  evidence report whenever an L2 reaches DONE. That report ends the executor's
  turn. It remains assigned and idle
  across that presentation boundary.
- After every executor report, inspect the executor's current state. If the L1
  is partial because an L2 just reached DONE, validate its focused evidence and
  changed-file scope, project it, and use the L2 reporting boundary below. On
  the following root turn, call `followup_task` on that same executor. Other
  partial or idle reports use immediate same-turn follow-up. If the user asks
  for status, answer briefly and perform the applicable continuation; the
  status reply does not satisfy the supervision action. If `org-plan next PLAN
  review` selects a DONE + UNREVIEWED L1,
  review it immediately and return ACCEPT or REJECT. Never review an
  ineligible L1. An executor result, a review result, an accepted-L1 report,
  and terminal whole-plan acceptance are distinct boundaries.
- A partial report, idle executor, self-described pause, or token or
  elapsed-time notice is never a user-facing stopping condition. A validated
  DONE L2 is a finite presentation boundary only; it never requests approval.
- If a failed child initialization leaves non-working `pending_init` agents
  consuming every slot, and interrupting them does not release capacity, call
  `gestalt_agent_capacity_recovery` exactly once with version 1 and reason
  `agentThreadLimit`. An accepted call recycles only the current session's
  Codex runtime, preserves its durable root thread and Org Plan, and hands
  continuation back to Autopilot. Do not retry spawning or request human
  attention during the handoff. Report an execution-capability blocker only
  if this root-owned recovery is unavailable or rejected.
- End successfully only when every L1 is DONE and REVIEWED and final gates pass.
  Stop early only for a genuine external blocker that the root cannot resolve
  without user input, new authority, or changed external state.

After each L2, the root verifies intended dirty paths, inspects the L2
diff, and requires current focused-test evidence before DONE.

After every successful `authoring-start`, `set`, `l2`, `review`, or external
`resync`, the executor reports the helper mutation to the root. The root then
runs `org-plan projection PLAN` and calls host `update_plan`; executors never
create a competing native projection. A missing or failed host tool produces
one concise warning and never reverses a valid Org mutation.

After all L2s, require a current full-suite pass and intended complete L1 diff.
Use `org-plan next PLAN review`; request review only for the selected DONE +
UNREVIEWED L1. The request contains:

- plan path, branch, base, starting commit, and selected L1 ID;
- position, title, Goal, Tests, Done-when criteria, and UNREVIEWED status;
- uncommitted diff scope and shared-code regression impact;
- exact test commands with pass/fail summaries and evidence locations;
- UI evidence matrix when applicable;
- preserved paths, prohibited actions, and material-ambiguity stop condition.

The root independently returns structured findings plus explicit ACCEPT or
REJECT. Skip already REVIEWED L1s. On REJECT, send the findings unchanged in
substance to the same executor, which corrects the same uncommitted diff. Repeat
the gates and review without pausing for user approval.

On ACCEPT, inspect `git diff --cached --name-only`, direct the executor to
create exactly one conventional L1 commit when files changed, then record
`REVIEWED`. The root runs the helper projection and host `update_plan` before
the reporting boundary, verifies the subject and intended scope, and terminates
the executor. A no-change L1 explicitly records that no commit was required.

Org Plan files are never Git deliverables. Immediately before every accepted
L1 commit, the executor and root inspect `git diff --cached --name-only` and
exclude the active Org Plan plus every `.gestalt/*.org` path, including paths
introduced with `git add --force`. No repository instruction, release workflow,
or user request overrides this boundary.

When no L1 review is pending, record that milestone review is current.

## Terminal whole-branch review

After every L1 is DONE and REVIEWED, terminate the last L1 executor and confirm
that no other writer is active. Before final acceptance:

1. Spawn one fresh depth-one subagent with `fork_turns=none`,
   `agent_type=org-plan-reviewer`, and `task_name=final_review`. This dedicated
   role fixes the reviewer model to Sol.
2. Give it a general overview containing the Org Plan goal, every implemented
   L1/L2 outcome, the branch base and current HEAD, milestone commits, tests,
   known tradeoffs, and the exact plan path as read-only context.
3. Ask it to review the whole branch from the branch base through HEAD, plus any
   intended working-tree changes, against the complete Org Plan. Require a
   concise severity-ranked report with P0, P1, P2, or lower findings and file
   evidence.
4. If the report contains no P0 or P1, retain any lower-severity findings for
   the final report and continue to the root's final gates.
5. If the report contains a P0 or P1, order that same subagent to become the
   sole writer and fix every P0/P1. It adds regression coverage, runs focused
   checks and the full suite, and returns a concise correction diff and evidence
   report. The root reviews those corrections. After acceptance, direct the
   subagent to create one conventional final-review correction commit, excluding
   the active Org Plan and every `.gestalt/*.org` path.

Do not finish with an unresolved P0 or P1. Final acceptance requires the
terminal review, a current root-side full-suite pass, and clean intended scope.
This terminal reviewer is the sole exception to the prohibition on separate
reviewers; it never replaces routine root-owned L1 review.

## Completed-L2 reporting boundary

A checkpoint is a short, idempotent persist-and-ack boundary, never a wait
episode. Do not register a wait lease or wait for `executorChanged` after it.
After the matching root final, Mobile schedules the next fenced continuation
from durable `checkpointChanged`. If a later turn observes
`checkpointHandoffFailed`, re-read the durable plan and Mobile control state;
do not blindly replay the checkpoint, request attention, or invent a
replacement. Treat `safetyPaused` as a safe terminal control state, not as
"waiting for agent event", and resume only after Mobile or explicit manual
recovery.

After the root validates a DONE L2, its focused evidence, changed-file scope,
projection, and host `update_plan`, call optional
`gestalt_org_plan_checkpoint` once with `kind: l2Completed`, plan identity,
canonical L1/L2 IDs and position, `status: DONE`, and bounded changes, files,
and test summaries. This checkpoint must be the last tool call of the root turn.
Send exactly one root final answer immediately, with no intervening tool call,
using this template:

```
L<a>.<b>/CHILD_TOTAL — TITLE: DONE

Completion: one or two sentences describing delivered behavior since the previous boundary.
Files: sorted relative paths, compactly grouped; or “None”.
Verification: exact focused commands and bounded pass/fail results.
Commit: Pending L<a> acceptance; changes remain uncommitted.
Next: automatic continuation to L<a>.<n>, or L<a> review.
```

Keep this to one screen and synthesize only new facts. Never copy commentary,
raw logs, or executor prose. Do not commit at an L2 boundary. Do not call
`followup_task` before the final: Autopilot uses the checkpoint to start the
next root turn, and that turn resumes the same executor. Even when the final L2
completes its L1, emit the L2 boundary first; run the full suite, review, commit,
and accepted-L1 report in the later turn.

If `l2Completed` is unavailable, it is not a blocker. Use a compact commentary
summary and resume the same executor in the current turn, because Mobile cannot
safely accept a root final for an incomplete plan without that boundary.

## Accepted-L1 reporting boundary

An accepted L1 ends one root turn, not the plan. After the ACCEPT commit/review
transition, projection, and host `update_plan`, call optional
`gestalt_org_plan_checkpoint` once with `kind: l1Accepted`, the plan identity,
canonical L1 position/ID, and bounded created-or-not-required commit metadata.
The checkpoint must be the last tool call of the root turn. Then send exactly
one root final answer immediately, with no intervening tool call, using the
template below. Do not make
executor output user-facing, duplicate the final answer in commentary, or infer
acceptance from executor prose.

```
L<a>/TOTAL — TITLE: ACCEPTED

Completion: bounded delivered behavior.
Files: sorted union of files changed across the L1, compactly grouped; or “None”.
Review: ACCEPT; include any REJECT findings repaired before acceptance.
Verification: exact commands and bounded pass/fail results.
Commit: conventional subject, then optional short hash; or “No commit required”.
Next: automatic continuation to L<n>, or terminal review after the final L1.
```

For non-final L1s, Autopilot starts the next root turn. For the final L1, that
later distinct continuation starts terminal review; its accepted-L1 report is
not whole-plan success. A missing checkpoint tool is not a blocker: preserve
the commit, review, projection, and single-writer gates, continue supervision
without early success, and use the legacy continuous-root fallback. In that
fallback, do not end the last-L1 turn before terminal review; combine its
accepted-L1 summary with terminal success only when a separate safe report
boundary is unavailable.

## Terminal whole-plan report

Only after terminal review has accepted the whole branch, all P0/P1 corrections
have their one conventional correction commit when needed, final gates pass,
and intended scope is clean, optionally checkpoint once with
`kind: terminalReviewAccepted` and send the sole terminal success answer. It
states terminal-review result, correction commit if any, final gate results,
residual P2-or-lower findings, clean intended scope, and all milestone commits.
It must not repeat an accepted-L1 final or include raw logs or child transcripts.

```
Plan terminal review: ACCEPTED

Review: whole-branch verdict and repaired P0/P1 findings.
Commits: milestone subjects and any terminal correction commit.
Verification: final gate commands and bounded results.
Residual findings: P2 or lower only.
Scope: clean intended scope.
```

## Reporting evidence ownership

Potentially large or uncertain inspections, tests, and logs use context-mode or
another context-preserving analysis path in both roles; small bounded filesystem
work stays native.
If unavailable, capture output outside the conversation and report only the
command, exit status, pass/fail counts, affected scope, and smallest diagnostic
excerpt. Never relay raw logs or complete child transcripts upward.

The root remains active and gives brief updates at supervision start and when an
L1 starts, reaches review, is rejected, is accepted, or blocks. On first mention
use `L<a>/TOTAL — TITLE: STATUS` plus its Goal; later use the same canonical
position and title. On first commit mention, report the conventional subject and purpose;
hashes are supplemental.

Routine review is agent-to-agent. Ask the user only for a material ambiguity or
unavailable prerequisite, never for progress approval.

## Standalone assignments

Every executor assignment identifies canonical `L<a>` and uses task name
`l<a>`. It includes its one L1 and full L2 block, repository
starting state, accepted prior outputs, allowed scope, required tests, exact
skills, implicit context-mode baseline, helper-only transitions, one post-ACCEPT
commit rule, preserved paths, completion-driven continuation, and genuine
external-blocker stop conditions. It explicitly forbids treating an L2 boundary
or partial report as completion of the assigned L1.

Never rely on inherited conversation context or write “continue above.”
