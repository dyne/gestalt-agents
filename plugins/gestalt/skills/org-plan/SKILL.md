---
name: org-plan
description: Create or execute durable Org plans when explicitly requested or when implementation work needs cross-session persistence, L1/L2 milestones, assigned skills or owners, supervised review and evidence gates, per-milestone commits, or mobile attention. Do not use for ordinary bounded single-session tasks.
---

# Org Plan

Prefer the simplest viable design. Make every milestone precise enough for a
fresh lesser-reasoning executor to complete from the plan and repository alone.

## Route planning work

Use Codex's native planning surfaces when useful for small
single-session, bounded work. Straightforward implementation tasks do
not require a persisted plan.

Select Org Plan only when the user explicitly requests it or the work genuinely
needs at least one of these capabilities:

- execution across sessions or context compaction;
- inspectable workspace-local durability;
- L1/L2 milestone hierarchy or explicit skill assignment;
- supervised subagent ownership;
- review, accept, or reject transitions and evidence gates;
- one commit per accepted milestone;
- mobile attention or supervision.

Once an Org workflow is active, its Org file and helper state machine are
authoritative. Continue projecting it to host `update_plan` for UI progress,
but keep native plan entries to short position, title, and status information;
do not copy full Org milestone prose into them.

## Choose a workflow

- **Authoring:** create or revise an Org plan. Read
  [Plan format](references/plan-format.md) and
  [CLI state machine](references/cli-state.md).
- **Supervised execution:** the root directs, supervises, and reviews one fresh
  depth-one executor per L1. Read
  [Supervised execution](references/supervised-execution.md) before spawning.
- **Manual execution:** use the loop below when supervised roles are unavailable
  or the user explicitly requests manual work.

When the typed `gestalt-org-plan` MCP server is available, prefer its bounded
read and transition tools. Otherwise use the bundled `scripts/org-plan` helper;
it remains the supported compatibility fallback. Neither path invokes host
tools: after a lifecycle mutation the active root alone reads the projection and
updates the native plan. `org-plan --help` and `org-plan COMMAND --help` return
successful, side-effect-free usage. Do not run `prepare-supervision` during ordinary supervision:
it is a setup/update command that installs role profiles, and
`gestalt-setup.sh` already invokes it. When execution is supplied a plan path,
reuse that exact path instead of searching for another plan or assuming the
nearest repository owns `.gestalt/`.

For mobile interoperability, see the versioned
[attention protocol](references/attention-protocol.md).

## Invariants

Use one-based canonical position labels in plan communication: L1 position `a`
is `L<a>` and its L2 child position `b` is `L<a>.<b>`. IDs remain machine state
keys. Agent-roster identity is exact: the root is `l0`; the executor for L1
position `a` is exactly `l<a>`. Pass that literal value as `task_name` (`l1`,
then `l2`, and so on). Do not append a title, role, nickname, plan name, L2
position, or generated display label. For a replacement, use the exact
physical identity supplied by Mobile. Never increment a generation
speculatively; choose the first unused `l<a>_gN` only after the prior
collaboration slot is confirmed unavailable.

1. Every L1 has exactly one non-empty `:SKILLS:` property and one
   `:REVIEW_STATUS:` property. New L1s start `UNREVIEWED`; L2s have neither.
2. Select L1 skills from the complete available catalog. Use exact `$skill`
   references and the smallest sufficient task-specific set.
3. `$gestalt:context-mode` is an implicit execution baseline. Never put it
   in `:SKILLS:`. Every executor loads it plus exactly the declared L1 skills
   before repository inspection or implementation, and stops without edits if
   any required skill is unavailable.
4. Use helper commands for TODO and review transitions; do not hand-edit them
   during execution.
   After each successful `authoring-start`, `supervision-start`, `set`, `l2`,
   `review`, or external `resync`, the active root reads `org-plan projection PLAN`
   and makes the host-owned `update_plan` call with its `plan` array,
   reporting its companion explanation separately. This is a best-effort UI
   projection only: tool unavailability warns without rolling back or changing
   the authoritative Org state.
5. Keep one writer. L2 changes remain uncommitted through L1 review.
6. Review only DONE + UNREVIEWED L1s. A REJECT returns corrections to the same
   L1 writer. REVIEWED is valid only after explicit reviewer acceptance.
7. After ACCEPT, create exactly one conventional commit for the L1 when files
   changed, then record REVIEWED. Never use fixup or autosquash commits for
   review corrections.
8. Reopening a reviewed L1 resets it to UNREVIEWED. Reset a completed reviewed
   L1 explicitly before a material correction that does not reopen it.
9. An L2 needs current focused evidence. An L1 needs all children DONE, a current
   full-suite pass, intended dirty scope, and reviewer acceptance.
10. Org Plan files are workspace-local coordination state. Keep every
    plan below the supplied workspace root's `.gestalt/`
    directory. Never stage, commit, or otherwise introduce one into
    Git history. This absolute prohibition cannot be overridden by
    repository instruction, release workflow, or claim that the plan
    is a deliverable. Do not mention that the local `.gestalt` Org
    plan remains intentionally untracked.
11. Execution is completion-driven with explicit report boundaries. One
    executor owns the whole assigned L1, not one L2, and returns concise
    evidence whenever an L2 reaches DONE. The root validates the L2 state,
    focused evidence, and changed-file scope, then projects it. When supported,
    call `gestalt_org_plan_checkpoint` once with `l2Completed` and return one
    compact L2 final; do not call `followup_task` before that final. The
    checkpoint is the last tool call of the root turn: emit the final
    immediately and end the turn. Autopilot
    starts the next root turn, where the root resumes the same executor for the
    next L2 or begins L1 review. If the L2 checkpoint is unavailable, use the
    legacy same-turn fallback: summarize in commentary and call `followup_task`
    before returning any root response. Review only DONE + UNREVIEWED
    L1s. After an L1 is ACCEPTED, committed when changed, REVIEWED, and
    projected, one concise root accepted-L1 final must end that root turn; it
    never ends the plan. Continue through every L1 and a later terminal review
    until final gates pass.
    A checkpoint is a short, idempotent persist-and-ack boundary, never a wait
    episode. Do not register a wait lease or wait for `executorChanged` after
    it. Mobile starts the next fenced continuation from durable
    `checkpointChanged` after the matching root final. If a later turn observes
    `checkpointHandoffFailed`, re-read durable plan and control state; do not
    blindly replay the checkpoint, request attention, or invent a replacement.
    Treat `safetyPaused` as a safe terminal control state and resume only after
    Mobile or explicit manual recovery.
    If Codex reports `agent thread limit reached` after child initialization
    failed, inspect the roster. When stale, non-working `pending_init` entries
    still consume every slot and interrupting them does not release capacity,
    call `gestalt_agent_capacity_recovery` exactly once with version 1 and
    reason `agentThreadLimit`. Its accepted response recycles only the current
    session runtime while preserving the durable root thread and Org Plan;
    Autopilot resumes supervision after restoration. Do not request human
    attention or retry spawning during that handoff. Report an execution
    blocker only when the recovery tool is unavailable or rejects the
    root-owned request.
12. In supervised execution, final acceptance includes one fresh depth-one
    whole-branch reviewer, launched with `fork_turns=none`,
    `agent_type=org-plan-reviewer`, and `task_name=final_review`, after every L1
    is REVIEWED and its executor has terminated. Give it a general overview of
    the implemented plan; the dedicated role fixes the reviewer model to Sol.
    Require a severity-ranked review of all branch
    implementation work. If it reports P0 or P1 issues, order that same reviewer
    to become the sole writer, fix every P0/P1, add regression coverage, and run focused plus
    full-suite checks before the root accepts one conventional final-review
    correction commit. Do not finish with an unresolved P0 or P1.
13. At the beginning of every new or resumed root session that supervises an
    incomplete plan, validate the exact plan and run `org-plan signal PLAN
    supervision-start` before milestone-state recovery, roster recovery,
    executor follow-up, or executor spawn. This is session-scoped, not
    plan-scoped: run it even when an L1 is already WIP or earlier L1s are
    REVIEWED. In Mobile's session-directory mode the helper retains an existing
    signal for the same plan, so a later root turn cannot re-enable control
    after explicit manual Off; a newly resumed relay session has a fresh
    directory and publishes its own signal. `supervision-start` has a verifiable postcondition:
    Mobile either reports
    enabled, healthy control for the retained plan, or the root records one
    bounded compatibility warning and remains in same-turn continuous
    supervision. At every would-be yield on an incomplete plan, the root must
    take one legal disposition: do actionable work, follow up the same
    executor, checkpoint and report a DONE L2, review/correct, checkpoint and
    report an accepted L1, register a
    one-shot wait lease, declare table-qualified attention, or confirm
    explicit manual Off. Status prose alone is never a disposition. Executor
    completion, error, interruption, idle state, process result, and a user
    status question are root wake inputs; an immediate action never requires a
    probe or lease first.

## One-shot long waits

When an operation is reasonably expected to exceed the normal Autopilot control
interval, the root calls `gestalt_autopilot_wait_lease` version 2 before
yielding. Supply unique `reportId` and `leaseId` values, the smallest relevant
`wakeConditions` set, and a bounded `maxWaitMs` from 60000 through 86400000.
Mobile resumes on the first matching observable event or that deadline. The
accepted lease applies to this episode only and does not alter later pulse
timing. If the same wait remains justified after Autopilot resumes, reassess it
and register a new lease from that later turn.

Yield only when the tool response contains `accepted:true`. If the tool is
unavailable or returns `accepted:false`, automatic continuation is not
guaranteed. Continue supervision in the same root turn, including an immediate
same-executor follow-up when that is the next lifecycle action.
For an `accepted:false` response, `reason:"wakeAlreadySatisfied"` means the
executor event is already actionable. Do not retry the lease. Inspect the
executor's current report and state, then take the next legal lifecycle action
in the same turn.

Use `executorChanged` for long delegated work and the appropriate process
conditions for an observable command. Do not create a
lease for routine work, while an immediate lifecycle action exists, or merely
to conceal a stalled executor. Never use a lease to await a checkpoint boundary.
For GitHub PR CI, start
`gh pr checks <PR> --watch --interval 30` with a short initial command yield.
If the command remains running, register a version 2 lease for `processExited`
and `processResultAvailable` with a realistic safety deadline. After the wake,
consume that same process result and continue. The supervisor owns this watcher;
Mobile does not receive GitHub credentials or poll GitHub itself. Version 1
remains the compatibility form for a Mobile-requested probe wait.

## Human-attention decision table

`gestalt_org_plan_attention` is an optional, mobile-provided dynamic tool. It
uses schema version 1 and is never an `$org-plan` dependency. First exhaust
safe, in-scope checks. If a row applies and the tool is available, call it
before sending any blocker response or yielding, with a bounded summary, a
concrete `requestedAction`, and the listed `reason` and `resumeCondition`.
Blocker prose is not a signal. After a successful call, stop issuing lifecycle
actions and let Mobile hold Autopilot until the matching resume event. If the
tool is unavailable, report the same normal blocker concisely and preserve the
supervision loop; do not invent a tool dependency.

| Only after safe checks, progress cannot continue because… | `reason` | `resumeCondition` |
| --- | --- | --- |
| A requested material scope, goal, or plan change needs approval. | `planChange` | `planRevision` |
| An exhausted hard block needs an outside repair or alternative. | `hardBlock` | `externalStateChanged` |
| A required system capability or declared task skill is unavailable. | `missingDependency` | `dependencyInstalled` |
| Required authority, credentials, or permission is absent. | `permissionRequired` | `permissionGranted` |
| Relevant external state changed after safe refresh or verification. | `externalState` | `externalStateChanged` |
| A material ambiguity remains after the plan and repository evidence are exhausted. | `materialAmbiguity` | `userGuidance` |

Do not escalate L1/L2 progress, a child report, waiting on a live child, review
readiness, a diagnosable or recoverable failing test, an ordinary merge
conflict, token or context pressure, elapsed time, checkpointing, or an idle
executor. Those cases immediately continue through the existing legal
lifecycle action.

## Authoring workflow

1. Resolve the workspace root explicitly supplied to Codex. Create
   `<workspace-root>/.gestalt/` when absent, then create
   `<workspace-root>/.gestalt/<topic>.org`, using a short kebab-case topic and
   no date in the filename. A Git repository root never redefines the supplied
   workspace root; a workspace may contain several repositories. Existing
   plans outside `.gestalt/` remain readable when explicitly supplied, but new
   plans always use this workspace-local destination.
2. Add the required document metadata, L1/L2 structure, property drawers, and
   field contracts from [Plan format](references/plan-format.md).
3. Validate a minimal skeleton before the first `authoring-start` signal, then
   signal again after coherent authoring changes.
4. Inspect every available skill name and discovery description. Assign each L1
   its minimal exact task-specific set.
5. Order L1s and L2s by dependency. Give each L1 its relevant starting context,
   prior outputs, invariants, tests, and acceptance criteria.
6. Review every milestone for ambiguity and lesser-model executability. Resolve
   material doubts before handoff.
7. Validate with the helper. Create the topic branch and run the repository's
   required baseline checks before implementation handoff.

## Manual execution loop

Use host-native filesystem tools for governing instructions, small bounded
reads, edits, mutations, and short command interaction. Use context-mode only
for large or uncertain analysis, filtering, indexing, and retrieval; it never
writes or changes Org state.

1. Confirm the assigned branch and choose the next WIP L1, otherwise the first
   TODO L1. Transition it with `org-plan set`.
2. Load the implicit context-mode baseline and exactly the L1's declared skills.
3. Choose the next WIP L2, otherwise the first TODO L2. Transition it with
   `org-plan l2`.
4. Implement the L2, add or update relevant tests, run focused tests, inspect
   intended scope, and mark the L2 DONE. Immediately select and execute the next
   actionable L2; do not stop at the L2 boundary.
5. When all children are DONE, run the full suite, inspect the complete L1 diff,
   and mark the L1 DONE.
6. Use `org-plan next PLAN review`. Ask a reviewer to audit only the selected
   L1's uncommitted diff against its starting commit and acceptance criteria.
7. On REJECT, correct the same diff and repeat its gates and review. On ACCEPT,
   inspect `git diff --cached --name-only` immediately before creating one
   conventional commit. It must exclude the active Org Plan and every
   `.gestalt/*.org` path, even if a force-add was attempted; otherwise unstage
   those paths and do not commit them. Then record REVIEWED.
8. Continue until every L1 and L2 is DONE and every L1 is REVIEWED. An L2 or
   accepted-L1 checkpoint is a presentation boundary, not a request for user
   approval and not plan completion.

The root performs the native projection after every successful lifecycle
boundary named above; executors only report their successful helper mutation.
Never ask Bash, an MCP server, or a generated profile to invoke `update_plan`.

In checkpoint-capable sessions, after each L2 reaches DONE and its focused
evidence and file scope are validated and projected, the root calls
`gestalt_org_plan_checkpoint` once with `l2Completed`, then emits one concise
root final answer without any intervening tool call. That final ends the root
turn. Autopilot starts a later turn that resumes the same executor
or begins L1 review. After an accepted L1 has its commit/review and projection
transition, the root calls the checkpoint once with `l1Accepted`, then emits
one concise root final answer without any intervening tool call. That final
ends the root turn; no executor launch, review, or later milestone action is
allowed after the checkpoint in that turn. The final L1
is still followed by a later root turn for terminal whole-branch review. Only
after that review, corrections, and final gates may the root optionally
checkpoint `terminalReviewAccepted` and emit terminal success. If checkpointing
is unavailable, retain all safety gates and continuous supervision; never end
early after the final L1.

Stop before plan completion, except at a validated L2 or accepted-L1 report
boundary, only for a genuine external blocker that cannot be
resolved autonomously: an unavailable required skill or execution prerequisite,
missing authority, changed external state, or a material ambiguity not resolved
by the plan and repository. When the attention tool is available, this stop is
valid only after its matching decision-table call succeeds. Routine progress,
review readiness, an executor
pause, token usage, or elapsed time are not blockers. Update
governing `AGENTS.md` only when the completed work changes durable repository
instructions.
