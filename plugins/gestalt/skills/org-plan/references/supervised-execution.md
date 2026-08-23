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
- Recommended profiles are `org-plan-reviewer` (Sol) for a newly launched root
  and `org-plan-executor` (Terra). An already-running root keeps its selected
  model while adopting the combined director/reviewer/supervisor contract.
- Codex V1 agent depth defaults to one, which permits this direct spawn. Stop
  when direct spawning is unavailable; do not edit user configuration.

## Start supervision

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

1. Validate the exact plan once. The root then signals `supervision-start`,
   runs `org-plan projection PLAN`,
   and calls host `update_plan` with its exact `plan` items, reporting the
   companion explanation separately.
2. Before each L1, verify the preceding L1 is REVIEWED, terminate the previous
   executor, confirm closure, and resolve the next milestone with
   `org-plan describe`.
3. Launch a fresh depth-one executor with `fork_turns=none` for exactly that L1.
4. The executor loads `$gestalt:context-mode`, verifies every declared L1
   skill is available, then loads exactly those declared skills before any
   repository inspection or edit. Missing skills block without edits.

## Human-attention decision table

`gestalt_org_plan_attention` is an optional mobile dynamic tool, not an
`$org-plan` dependency. Its current schema version is 1. Exhaust safe,
in-scope checks first. When a row below still prevents safe progress and the
tool is available, call it before yielding with a bounded summary, concrete
`requestedAction`, and the mapped `reason` and `resumeCondition`. When absent,
report the ordinary blocker concisely and continue normal supervision rather
than requiring the tool.

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

## Evidence and review loop

Supervision is a completion loop:

- The executor owns the entire assigned L1. It continues from one L2 to the
  next without returning a final report merely because an L2, checkpoint,
  focused test, or progress update completed.
- After every executor report, inspect the executor's current state. If the L1
  is partial and the executor stopped or became idle, immediately resume that
  same executor. If `org-plan next PLAN review` selects a DONE + UNREVIEWED L1,
  review it immediately and return ACCEPT or REJECT. After acceptance, finish
  its commit/review transition and launch the next L1. Never review an
  ineligible L1.
- A partial report, idle executor, self-described pause, token or elapsed-time
  notice, or completed L2 is never a user-facing stopping condition. Use the
  available follow-up or wait mechanism and keep supervision moving.
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

On ACCEPT, direct the executor to create exactly one conventional L1 commit when
files changed and record REVIEWED. The root verifies its subject and scope,
terminates the executor, confirms closure, and selects the next L1.

Org Plan files are never Git deliverables. Immediately before every accepted
L1 commit, the executor and root inspect `git diff --cached --name-only` and
exclude the active Org Plan plus every `.gestalt/*.org` path, including paths
introduced with `git add --force`. No repository instruction, release workflow,
or user request overrides this boundary.

When no review is pending, record that review is current. Final acceptance is a
current root-side full-suite pass and clean intended scope, not a repeat audit
of REVIEWED L1s.

## Reporting boundary

Potentially large inspections, tests, and logs use a context-preserving path in
both roles.
If unavailable, capture output outside the conversation and report only the
command, exit status, pass/fail counts, affected scope, and smallest diagnostic
excerpt. Never relay raw logs or complete child transcripts upward.

The root remains active and gives brief updates at supervision start and when an
L1 starts, reaches review, is rejected, is accepted, or blocks. On first mention
use `L1 POSITION/TOTAL — TITLE: STATUS` plus its Goal; later use position and
title. On first commit mention, report the conventional subject and purpose;
hashes are supplemental.

Routine review is agent-to-agent. Ask the user only for a material ambiguity or
unavailable prerequisite, never for progress approval.

## Standalone assignments

Every executor assignment includes its one L1 and full L2 block, repository
starting state, accepted prior outputs, allowed scope, required tests, exact
skills, implicit context-mode baseline, helper-only transitions, one post-ACCEPT
commit rule, preserved paths, completion-driven continuation, and genuine
external-blocker stop conditions. It explicitly forbids treating an L2 boundary
or partial report as completion of the assigned L1.

Never rely on inherited conversation context or write “continue above.”
