---
name: org-plan
description: Create or execute durable Org plans when explicitly requested or when implementation work needs cross-session persistence, L1/L2 milestones, assigned skills or owners, supervised review and evidence gates, per-milestone commits, or mobile attention. Do not use for ordinary bounded single-session tasks.
---

# Org Plan

Prefer the simplest viable design. Make every milestone precise enough for a
fresh lesser-reasoning executor to complete from the plan and repository alone.

## Route planning work

Use native planning for ordinary bounded work. Select Org Plan when explicitly
requested or when work needs durable cross-session state, L1/L2 milestones,
assigned skills/owners, supervised review and evidence gates, milestone commits,
or mobile attention.

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

Authoring never authorizes execution: after the validated handoff, stop until
the user explicitly orders implementation or supervision.

When the typed `gestalt-org-plan` MCP server is available, prefer its bounded
read and transition tools. For permission failures, see [startup diagnostics](references/startup-diagnostics.md).
Otherwise use the bundled `scripts/org-plan` helper;
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

Use one-based labels `L<a>` and `L<a>.<b>` in plan communication; IDs remain
machine state keys. Supervised roles use the exact identities and replacement
authorization in [Canonical positions and agent names](references/supervised-execution.md#canonical-positions-and-agent-names).

1. Every L1 has exactly one non-empty `:SKILLS:` property and one
   `:REVIEW_STATUS:` property. New L1s start `UNREVIEWED`; L2s have neither.
2. Select L1 skills from the optional available catalog. Use exact `$skill`
   references and the smallest sufficient task-specific set.
3. Gestalt workflows are always loaded; conditional `$gestalt:xerj` requires
   runtime readiness. Never declare `$gestalt:*` in `:SKILLS:` or load one as
   optional. Executors verify and load exactly
   the declared optional skills before repository inspection or implementation,
   and stop without edits if any required optional skill is unavailable.
4. Use helper commands for TODO and review transitions; do not hand-edit them
   during execution.
   After each successful `authoring-start`, `supervision-start`, `set`, `l2`,
   `review`, `suspend-reopen`, `resume`, or external `resync`, the active root reads `org-plan projection PLAN`
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
8. Dependency corrections use `suspend-reopen` and `resume` per
   [CLI state machine](references/cli-state.md), requiring compatible consumption
   and one writer. Reopening a reviewed L1 resets it to UNREVIEWED. Reset a completed reviewed
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
11. Supervision is completion-driven. Read the entire
    [supervision reference](references/supervised-execution.md) for startup,
    ownership, continuation, capacity recovery, and report boundaries. Its
    completed-L2, accepted-L1, and terminal-report sections govern checkpoint
    outcomes and fallbacks; a boundary never grants review authority.
12. Final acceptance requires the
    [terminal whole-branch review](references/supervised-execution.md#terminal-whole-branch-review)
    and final gates after all L1s are REVIEWED. Read that contract before
    terminal review, including its sole-writer P0/P1 correction procedure.

## One-shot long waits

Before using a lease, read the
[one-shot long-wait contract](references/supervised-execution.md#one-shot-long-wait-lease),
including rejection/unavailable-tool behavior and the owned CI watcher. A lease
never replaces actionable work or a checkpoint boundary.

## Human-attention decision table

`gestalt_org_plan_attention` is optional and is never an `$org-plan`
dependency. Exhaust safe in-scope checks first. When a row applies, send its
exact `reason` and `resumeCondition` only; Mobile derives the bounded summary
and requested action from that validated pair. A successful call ends the turn.
If the tool is unavailable, report the blocker normally. Blocker prose is not
a signal.

| Only after safe checks, progress cannot continue because… | `reason` | `resumeCondition` |
| --- | --- | --- |
| A requested material scope, goal, or plan change needs approval. | `planChange` | `planRevision` |
| An exhausted hard block needs an outside repair or alternative. | `hardBlock` | `externalStateChanged` |
| A required system capability or declared task skill is unavailable. | `missingDependency` | `dependencyInstalled` |
| Required authority, credentials, or permission is absent. | `permissionRequired` | `permissionGranted` |
| Relevant external state changed after safe refresh or verification. | `externalState` | `externalStateChanged` |
| A material ambiguity remains after the plan and repository evidence are exhausted. | `materialAmbiguity` | `userGuidance` |

L1/L2 progress, child reports, waiting on a live child, review readiness,
recoverable test failures, merge conflicts, token/context pressure, elapsed
time, checkpoints, and executor idleness are not attention conditions.

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
6. Resolve milestone ambiguity and validate [model handoffs](references/model-policy-workflow.md)
   before handoff.
7. Validate with the helper. Create the topic branch and run the repository's
   required baseline checks before implementation handoff.
## Manual execution loop

Follow the required [context-mode routing contract](../context-mode/SKILL.md#routing-contract)
for native reads/mutations and evidence analysis. Context-mode never changes Org state.

1. Confirm the assigned branch and choose the next WIP L1, otherwise the first
   TODO L1. Transition it with `org-plan set`.
2. Gestalt skills are already loaded. Load exactly the L1's declared optional
   skills.
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
   accepted-L1 checkpoint is a boundary final, not a request for user
   approval and not plan completion.

Only the active root invokes host `update_plan` per invariant 4; executors
report mutations. Never ask Bash, an MCP server, or a generated profile to
invoke it. When using checkpoint/report boundaries, first read the mandatory
[completed-L2](references/supervised-execution.md#completed-l2-boundary),
[accepted-L1](references/supervised-execution.md#accepted-l1-boundary), and
[terminal-report](references/supervised-execution.md#terminal-whole-plan-report)
contracts. Manual execution otherwise continues immediately through L2s.

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
