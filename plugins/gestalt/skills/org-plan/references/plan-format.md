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
heading has a lifecycle keyword (`TODO`, `WIP`, `DONE`, or helper-managed
`SUSPENDED`), importance `[#A]`, `[#B]`, or `[#C]`, and a unique
kebab-case `:ID:`.

## L1 contract

Every L1 property drawer contains exactly:

```org
:ID: unique-l1-id
:SKILLS: $namespace:skill $other-skill
:REVIEW_STATUS: UNREVIEWED
```

The skills list is non-empty, whitespace-separated, exact, and task-specific.
Gestalt workflow skills are always-loaded session infrastructure. Conditional
capabilities such as `$gestalt:xerj` require runtime readiness; neither belongs
in milestone dependencies. Declare only optional non-Gestalt skills.

Every L1 body contains:

```org
- Effort ::
- Goal ::
- Notes ::
```

Partition L1s into cohesive reviewable use cases sized for one fresh executor.
Include starting context, dependencies on prior L1s, expected prior outputs,
allowed scope, invariants, required tests, and acceptance criteria.

## Milestone size before execution

During authoring, split independent acceptance outcomes into separate cohesive
L1s before execution. Each should be understandable and reviewable by one fresh
executor from its starting context and criteria. Keep coupled changes together
when separate acceptance would leave an invalid intermediate contract. Preserve
one writer per L1 and express internal dependent steps as L2s.

| Candidate milestone | Authoring decision |
| --- | --- |
| Repair checkout retry behavior and redesign unrelated reporting navigation | Split: either outcome can be accepted independently, with separate context, tests and owners. |
| Change a request schema and its inseparable producer/consumer validation in one repository | Keep one L1: acceptance requires the shared contract and regression checks together; use L2s for coupled implementation steps. |

Signals to reassess before handoff include unrelated criteria, repeated need to
rediscover separate subsystems, or an assignment that cannot supply sufficient
starting context. Complexity, elapsed time or compaction count alone is not a
mechanical split threshold. Do not split an active approved L1 automatically.
Executors stay within its scope; material replanning follows existing authority
and lifecycle gates. Smaller milestones never waive focused/full checks, review,
commit or checkpoint requirements.

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

Never hand-edit derived measurements. Timestamps are ISO-8601 instants; the
helper accepts RFC 3339 offsets in existing plans and normalizes newly written
timestamps to UTC. Elapsed seconds and token counters are non-negative
integers; quota values are integer percentages. Start values are immutable,
checkpoints refresh current values, and completion records end values. Omit
unavailable quota values. If a quota resets or moves backward, record zero
percent used.

Start the L1 before its first L2 and finish it after implementation, review,
retries, and waiting. Start and finish each L2 separately. Checkpoint the active
L1 after each state mutation and at least every 60 seconds while active. Never
derive L1 duration by summing L2 durations.

## Suspended work

Only the supported dependency-reopen transition creates `SUSPENDED`. A suspended
L1 remains UNREVIEWED and declares `:SUSPENDED_FOR: earlier-l1-id`. Its former
WIP L2, if any, is also SUSPENDED; other children keep DONE/TODO. A suspended
L2 cannot exist outside a suspended L1, and a WIP child cannot exist inside one.
Suspended L1s must form one ordered dependency chain, with at most one suspended
L2 per suspended L1. Active work must precede the innermost suspended L1.
Nested chains require a consumer advertising `nested-suspension-v1` in addition
to `suspension-v1`. See [CLI state machine](cli-state.md) for review and consumer
gates; never hand-author suspension to bypass them.
