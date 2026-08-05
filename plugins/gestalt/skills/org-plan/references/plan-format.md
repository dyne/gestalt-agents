# Org Plan format

Use this reference while authoring or validating a plan.

## Storage boundary

For every new plan, use exactly `<workspace-root>/.gestalt/<topic>.org`, where
the workspace root is the root explicitly supplied to Codex. Create the `.gestalt/` directory when absent.
Do not substitute a nearest Git repository root: a workspace may contain multiple repositories.
Org Plans are local coordination state, never Git deliverables; do not stage,
commit, force-add, cherry-pick, or otherwise introduce them into Git history.
Explicitly supplied legacy plans outside this directory remain readable for execution.
No repository instruction, release workflow, or user request can override this
prohibition. Before every implementation commit, inspect
`git diff --cached --name-only`; it must exclude the active Org Plan and every
`.gestalt/*.org` path.

After authoring or externally correcting a valid plan, the active root reads
`org-plan projection PLAN` and best-effort synchronizes its exact `plan` array
to host `update_plan`, reporting the companion explanation separately. Native
status is only a compact UI projection; it never
authorizes an Org transition, review, or completion.

## Document metadata

Include:

```org
#+TITLE:
#+SUBTITLE:
#+DATE:
#+KEYWORDS:
```

Use execution-order headings. L1 headings use `*`; L2 headings use `**`. Every
heading has a TODO keyword, importance `[#A]`, `[#B]`, or `[#C]`, and a unique
kebab-case `:ID:`.

## L1 contract

Every L1 property drawer contains exactly:

```org
:ID: unique-l1-id
:SKILLS: $namespace:skill $other-skill
:REVIEW_STATUS: UNREVIEWED
```

The skills list is non-empty, whitespace-separated, exact, and task-specific.
Never include `$gestalt:context-mode`; execution loads it as an implicit
baseline.

Every L1 body contains:

```org
- Effort ::
- Goal ::
- Notes ::
```

Partition L1s into cohesive reviewable use cases sized for one fresh executor.
Include starting context, dependencies on prior L1s, expected prior outputs,
allowed scope, invariants, required tests, and acceptance criteria.

## L2 contract

L2 property drawers contain an `:ID:` but no `:SKILLS:` and no
`:REVIEW_STATUS:`. Every L2 body contains:

```org
- Why ::
- Change ::
- Tests ::
- Done when ::
```

For UI work, Tests and Done-when name screenshots, components, viewport sizes,
and font-scale combinations. Non-UI work does not require UI artifacts.

## Measurements

Plans may use `STARTED_AT`, `UPDATED_AT`, `COMPLETED_AT`, `ELAPSED_SECONDS`,
`WEEKLY_REMAINING_START`, `WEEKLY_REMAINING_CURRENT`,
`WEEKLY_REMAINING_END`, `WEEKLY_PERCENT_USED`, `TOKENS_START`,
`TOKENS_CURRENT`, `TOKENS_END`, and `TOKENS_USED` on L1 or L2 headings.

Use only:

```sh
org-plan measure start PLAN ID SNAPSHOT_JSON
org-plan measure checkpoint PLAN ID SNAPSHOT_JSON
org-plan measure finish PLAN ID SNAPSHOT_JSON
```

Never hand-edit derived measurements. Timestamps are UTC ISO-8601 instants;
elapsed seconds and token counters are non-negative integers; quota values are
integer percentages. Start values are immutable, checkpoints refresh current
values, and completion records end values. Omit unavailable quota values. If a
quota resets or moves backward, record zero percent used.

Start the L1 before its first L2 and finish it after implementation, review,
retries, and waiting. Start and finish each L2 separately. Checkpoint the active
L1 after each state mutation and at least every 60 seconds while active. Never
derive L1 duration by summing L2 durations.
