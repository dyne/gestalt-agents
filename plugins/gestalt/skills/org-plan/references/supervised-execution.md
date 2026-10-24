# Supervised Org Plan execution

Read this reference completely before launching supervised roles. The Org
SKILL owns shared invariants; this reference owns the supervised lifecycle.

## Roles and ownership

Use these terms consistently:

- **root:** the depth-zero director, supervisor, and routine reviewer;
- **executor:** the depth-one writer assigned to one complete L1;
- **terminal reviewer:** the final whole-branch reviewer;
- **relay session:** one Mobile status-directory lifetime;
- **root turn:** one model turn by the root;
- **Codex runtime:** one app-server process lifetime;
- **checkpoint:** a durable control event;
- **boundary final:** the user response immediately following a checkpoint.

```text
root (depth 0, org-plan-reviewer, gpt-6.1-sol/medium, read-only)
└── executor (depth 1, only code writer)
```

- The root owns user communication, directly launches executors, enforces
  evidence gates, and returns ACCEPT or REJECT for DONE + UNREVIEWED L1s.
- Executors report only to the root.
- After executors terminate, one fresh terminal reviewer audits the whole branch;
  it writes only P0/P1 fixes under the terminal procedure below.
- Profiles default to `gpt-6.1-sol` / `medium`; existing roots keep their settings.
  Before v1 dispatch, read the [policy handoff contract](model-policy-workflow.md).
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
in Mobile's durable authorization, which names its predecessor and evidence.
Never derive or increment a generation. Without authorization, resume the
assigned executor or report a control-state conflict; prompts cannot authorize
replacement. L2 positions are plan/report labels, never routine agent names.

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

1. At the beginning of every new or resumed relay session, validate the exact
   plan once and signal `supervision-start` before inspecting milestone state,
   recovering the roster, following up an executor, or spawning one. This
   signal is session-scoped, not plan-scoped: emit it even when the plan is
   already WIP or earlier L1s are REVIEWED. In Mobile's session-directory mode,
   the helper retains an existing signal for the same plan, preventing a later
   root turn from overriding explicit manual Off; a newly resumed relay session
   has a fresh directory and publishes its own signal. Project this and every
   subsequent lifecycle mutation under SKILL invariant 4.
2. Before each L1, verify the preceding L1 is REVIEWED, terminate the previous
   executor, confirm closure, and resolve the next milestone with
   `org-plan describe`.
3. Launch a fresh depth-one executor with `fork_turns=none` for exactly that L1,
   using task name `l<a>` for its canonical `L<a>` position. Only when that
   physical slot is unavailable and Mobile durably authorizes replacement, use
   its exact `l<a>_gN`; display it as `l<a>`. Never derive an identity from the
   roster or generated instructions.
4. Apply SKILL invariant 3: the executor loads exactly the declared optional
   skills before repository inspection or edits; missing skills block without
   edits. Gestalt workflows are already loaded.

Both roles follow the required [context-mode routing contract](../../context-mode/SKILL.md#routing-contract).
It never mutates Org state; the unavailable-tool evidence fallback is below.

## Human-attention decision table

Use only the [SKILL decision table](../SKILL.md#human-attention-decision-table)
after exhausting safe checks. The optional tool uses schema version 1; call it
before a genuine blocker response when available. A successful call is the
terminal disposition: issue no further lifecycle action and let Mobile hold
Autopilot until the matching resume event. When absent, report the blocker
normally; its absence is not a dependency failure. All non-attention cases in
the SKILL require the next legal supervision action.

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

## Actionable wakes

Per actionable wake, read authoritative retained Org/control and assigned
executor/process state once, reusing current event facts. Refresh affected facts
after mutation, change or contradiction. Inspect delta scope/report/evidence and
rerun invalidated checks; reuse never replaces independent verification.

For running work without a pending decision, use available agent/process event
waits in the same turn or accepted long-wait leases below. No repeated
health/list/status loops or gratuitous followups. Use `followup_task` only for
next authorized work, missing evidence/corrections, or idle incomplete executors.
Recover actionable errors safely in the same turn; only exhausted table-qualified
blockers use attention. Answer status questions and perform the lifecycle disposition.

## One-shot long-wait lease

Before yielding for work expected to take longer than the ordinary Autopilot
control interval, call `gestalt_autopilot_wait_lease` with version 2, unique
`reportId` and `leaseId` values, the smallest relevant `wakeConditions`, and
`maxWaitMs` between 60000 and 86400000. The first matching observable event or
the deadline resumes normal Autopilot control. This is one episode, not a pulse
policy change. If the wait remains justified after that later turn begins, the
root must reassess it and explicitly register another episode.

| Lease outcome | Required root action |
| --- | --- |
| `accepted:true` | Yield for this one episode; reassess after wake/deadline. |
| `unavailable` or `accepted:false` | Inspect current state; continue supervision in the same turn, following up the same executor immediately when delegated work is next. |
| `wakeAlreadySatisfied` | Inspect current executor report and state; continue in the same turn. Do not retry the lease: the event is already actionable. |

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
Version 1 remains only for legacy compatibility when Mobile explicitly requests
it.

## Evidence and review loop

- The executor owns the entire assigned L1, but returns a concise structured
  evidence report whenever an L2 reaches DONE. That report ends the executor's
  turn. It remains assigned and idle
  across that boundary final.
- After every executor report, inspect the executor's current state. If the L1
  is partial because an L2 just reached DONE, validate its focused evidence and
  changed-file scope, project it, and use the L2 boundary below. On
  the following root turn, call `followup_task` on that same executor. Other
  partial or idle reports use immediate same-turn follow-up. If the user asks
  for status, answer briefly and perform the applicable continuation; the
  status reply does not satisfy the supervision action. If `org-plan next PLAN
  review` selects a DONE + UNREVIEWED L1,
  review it immediately and return ACCEPT or REJECT. Never review an
  ineligible L1. An executor result, a review result, an accepted-L1 report,
  and terminal whole-plan acceptance are distinct boundaries.
- A partial report, idle executor, self-described pause, or token/elapsed-time
  notice is never a stopping condition or request for progress approval.
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
diff, and requires current focused-test evidence before DONE. Use the
[evidence contract](evidence-report.md) for reports and independent root verification.

Executors report successful helper mutations; only the active root projects
them under SKILL invariant 4. Missing host tools never reverse valid Org state.

Record findings/checks/decisions in the [investigation ledger](continuity-ledger.md);
read before iteration/recovery.

After all L2s, require a current full-suite pass and intended complete L1 diff.
Use `org-plan next PLAN review`; request review only for the selected DONE +
UNREVIEWED L1. Use the evidence contract's review form and required task inputs.
Inspect selected milestone sections and relevant evidence
fields; retain governing reads and complete intended scope/diff checks.

The root independently returns structured findings plus explicit ACCEPT or
REJECT. Skip already REVIEWED L1s. On REJECT, send the findings unchanged in
substance to the same executor, which corrects the same uncommitted diff. Repeat
the gates and review without pausing for user approval.

On ACCEPT, both root and executor inspect `git diff --cached --name-only`
immediately before committing and exclude the active plan and all
`.gestalt/*.org` paths, including force-added paths, under SKILL invariant 10.
Direct the executor to make the one conventional commit when changed, then
record REVIEWED and project. The root verifies subject/scope and terminates
the executor. Explicitly record when no commit was required.

When no L1 review is pending, record that milestone review is current.

## Terminal whole-branch review

After every L1 is DONE and REVIEWED, terminate the last executor and confirm
no writer remains. Before acceptance:

1. Spawn a fresh depth-one subagent with `fork_turns=none`, `agent_type=default`,
   `task_name=final_review`, explicit `model=gpt-6.1-sol`, `reasoning_effort=medium`.
   Verify catalog and explicit launch settings under the plan's assurance mode;
   strict requires effective evidence, while configured retains unknown fields.
   Never inherit Astra or select the pinned
   `org-plan-reviewer` role.
2. Assign terminal-reviewer duties and supply the skill/reference paths,
   Org Plan goal, implemented L1/L2 outcomes, branch base and HEAD,
   milestone commits, tests, tradeoffs, and exact read-only plan path.
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

## Completed-L2 boundary

A checkpoint is a short, idempotent persist-and-ack boundary, never a wait
episode. Do not register a wait lease or wait for `executorChanged` after it.
After the matching root final, Mobile schedules the next fenced continuation
from durable `checkpointChanged`. If a later turn observes
`checkpointHandoffFailed`, re-read the durable plan and Mobile control state;
do not blindly replay the checkpoint, request attention, or invent a
replacement. Treat `safetyPaused` as a safe terminal control state, not as
"waiting for agent event", and resume only after Mobile or explicit manual
recovery.

| Checkpoint outcome | Required root action |
| --- | --- |
| `recorded` | Emit exactly one boundary final immediately; the checkpoint is the last tool call of the turn. |
| `alreadyRecorded` | Reconcile without another final; do not replay the boundary. |
| `failed`, rejected, terminated, or result-less | Continue same-turn supervision; no boundary final is authorized. |
| `unavailable` | Use the boundary-specific fallback below; preserve every evidence/review gate. |

A recycled runtime reconciles `checkpointHandoffFailed` once.

After validating a DONE L2, its evidence, scope, projection, and host
`update_plan`, call optional
`gestalt_org_plan_checkpoint` once with only `kind: l2Completed`. Mobile derives
the boundary details from the authoritative retained plan. This checkpoint must
be the turn's last tool call; status `recorded` is required before the final.
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

Keep this to one screen with only new facts. Never copy commentary, raw logs, or
executor prose. Do not commit or call `followup_task`: Autopilot starts the next
root turn and resumes the executor. Even the final L2 gets its boundary first;
full-suite review, commit, and L1 reporting happen later.

If `l2Completed` is unavailable, it is not a blocker. Use a compact commentary
summary and resume the same executor in the current turn, because Mobile cannot
safely accept a root final for an incomplete plan without that boundary.

## Accepted-L1 boundary

An accepted L1 ends one root turn, not the plan. After its commit/review,
projection, and host `update_plan`, call optional
`gestalt_org_plan_checkpoint` once with only `kind: l1Accepted`. Mobile derives
the boundary details from the authoritative retained plan.
The checkpoint must be the last tool call of the root turn. Then send exactly
one root final answer immediately after its successful response, with no
intervening tool call, using the
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

A missing checkpoint is not a blocker: preserve all gates, emit the accepted-L1
final, and end the turn. Never cross this boundary with continuous supervision,
post-acceptance commentary, documentation, or the next L1. On the next root turn,
revalidate durable plan and roster, then launch exactly one fresh canonical
executor; after the final L1, start terminal review. This accepted-L1 boundary
is mandatory even when the checkpoint tool is unavailable; it is not whole-plan
success.

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

Read the [evidence contract](evidence-report.md) before reporting or evaluating evidence.

Potentially large or uncertain inspections, tests, and logs use context-mode or
another context-preserving analysis path in both roles; small bounded filesystem
work stays native.
If unavailable, capture output outside the conversation and report only the
command, exit status, pass/fail counts, affected scope, and smallest diagnostic
excerpt. Never relay raw logs or complete child transcripts upward.

Root updates: supervision start and L1 start/review/reject/accept/block.
First mention: `L<a>/TOTAL — TITLE: STATUS` and Goal; later: canonical
position/title. First commit: conventional subject and purpose, then optional hash.

Routine review is agent-to-agent. Ask the user only for a material ambiguity or
unavailable prerequisite, never for progress approval.

## Standalone assignments

Use the evidence contract's assignment form and required task inputs for the
assigned L1: selected L1/children once or exact required section reads, candidate
identities, report budget and evidence location. Supply exact optional skills;
Gestalt workflows are already loaded. Retain helper-only transitions, one
post-ACCEPT commit, preserved paths, continuation and genuine external-blocker
conditions. An L2 boundary or partial report never completes the assigned L1.

Never rely on inherited conversation context or write “continue above.”
