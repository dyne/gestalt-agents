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
- Codex must permit `[agents] max_depth = 1`. Stop when direct spawning is
  unavailable; do not edit user configuration.

## Start supervision

1. The root signals `supervision-start`.
2. Before each L1, verify the preceding L1 is REVIEWED, terminate the previous
   executor, confirm closure, and resolve the next milestone with
   `org-plan describe`.
3. Launch a fresh depth-one executor with `fork_turns=none` for exactly that L1.
4. The executor loads `$gestalt:context-mode`, verifies every declared L1
   skill is available, then loads exactly those declared skills before any
   repository inspection or edit. Missing skills block without edits.

## Evidence and review loop

After each L2, the root verifies intended dirty paths, inspects the L2
diff, and requires current focused-test evidence before DONE.

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
the gates and review.

On ACCEPT, direct the executor to create exactly one conventional L1 commit when
files changed and record REVIEWED. The root verifies its subject and scope,
terminates the executor, confirms closure, and selects the next L1.

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
commit rule, preserved paths, and stop conditions.

Never rely on inherited conversation context or write “continue above.”
