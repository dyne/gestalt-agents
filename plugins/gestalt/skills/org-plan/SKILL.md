---
name: org-plan
description: Create or execute implementation plans stored as Org files with ordered L1/L2 milestones, exact skill assignments, durable review status, helper-driven state transitions, and optional root-directed subagent execution. Use for multi-step work that needs inspectable scope, evidence gates, incremental review, and one conventional commit per accepted L1.
---

# Org Plan

Prefer the simplest viable design. Make every milestone precise enough for a
fresh lesser-reasoning executor to complete from the plan and repository alone.

## Choose a workflow

- **Authoring:** create or revise an Org plan. Read
  [Plan format](references/plan-format.md) and
  [CLI state machine](references/cli-state.md).
- **Supervised execution:** the root directs, supervises, and reviews one fresh
  depth-one executor per L1. Read
  [Supervised execution](references/supervised-execution.md) before spawning.
- **Manual execution:** use the loop below when supervised roles are unavailable
  or the user explicitly requests manual work.

The bundled `scripts/org-plan` helper validates plans and performs durable state
changes. Use its `--help` output for exact arguments.

## Invariants

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
10. Do not commit Org plan files unless the governing repository or user
    explicitly requires them as deliverables.

## Authoring workflow

1. Create `./<topic>.org` with a short topic name and no date in the filename.
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

1. Confirm the assigned branch and choose the next WIP L1, otherwise the first
   TODO L1. Transition it with `org-plan set`.
2. Load the implicit context-mode baseline and exactly the L1's declared skills.
3. Choose the next WIP L2, otherwise the first TODO L2. Transition it with
   `org-plan l2`.
4. Implement the L2, add or update relevant tests, run focused tests, inspect
   intended scope, and mark the L2 DONE.
5. When all children are DONE, run the full suite, inspect the complete L1 diff,
   and mark the L1 DONE.
6. Use `org-plan next PLAN review`. Ask a reviewer to audit only the selected
   L1's uncommitted diff against its starting commit and acceptance criteria.
7. On REJECT, correct the same diff and repeat its gates and review. On ACCEPT,
   create one conventional commit when needed and record REVIEWED.
8. Continue until every L1 and L2 is DONE and every L1 is REVIEWED.

Stop only for an unavailable required skill, a material ambiguity not resolved
by the plan and repository, or an unavailable execution prerequisite. Update
governing `AGENTS.md` only when the completed work changes durable repository
instructions.
