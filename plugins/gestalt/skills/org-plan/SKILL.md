---
name: org-plan
description: Multi-step implementation method to use when creating, studying or executing a plan.  org-plan helper script.
---

Never over-engineer: prefer the simplest viable approach.

Choose for minimalism and clarity, and use native doc-comments to
explain functions. Choose well known algorithms over inventing new
ones. Write code that is elegant and readable for humans.

- Challenge first ideas
- Weight alternatives
- Prefer minimalism

# Planner

This section governs plan authoring only. Planner is a phase name, not a role in
the supervised four-role hierarchy below.

When writing a plan go into detail: even a lesser LLM with low
thinking should be able to implement it. Ask for help if you have
material doubts. Do not add dependencies unless asked to, suggest them
if very useful.

Plan using Org files in `./<topic>.org` (short name, no date).
Org rules: headings in execution order; L1 `*` and L2 `**`; each
heading has TODO + importance [#A|#B|#C] and a unique kebab-case `:ID:`.
Every L1 property drawer has exactly one `:REVIEW_STATUS:`. New L1s start
`:REVIEW_STATUS: UNREVIEWED`; only reviewer-accepted L1s use `REVIEWED`. L2 property
drawers never contain `:REVIEW_STATUS:`.
Use the bundled `org-plan` helper to validate and change plan state.
See `org-plan --help` for its commands.

Use `next PLAN review` to select the first completed unreviewed L1, `review PLAN
ID REVIEWED` after reviewer acceptance, and `review PLAN ID UNREVIEWED` before a
material correction that does not reopen the L1. Reopening a reviewed L1 as WIP
resets it to `UNREVIEWED` automatically. Use `describe PLAN ID` to resolve an ID
to its title and `Goal` or `Why` text without parsing the Org file directly.

Plan file includes `#+TITLE`, `#+SUBTITLE`, `#+DATE`, `#+KEYWORDS`.
Each L1 includes `- Effort ::`, `- Goal ::`, `- Notes ::`.
Each L2 includes `- Why ::`, `- Change ::`, `- Tests ::`, `- Done when ::`.

Order L1s by implementation dependency so foundations and contracts precede
their consumers, then order each L1's L2s by the same rule. Partition L1s into
cohesive, reviewable use cases sized for one fresh executor. Make every L1 a
standalone handoff: include its relevant starting context, prior-L1 dependencies
and outputs, scope, invariants, tests, and acceptance criteria. Avoid hidden
cross-L1 context, arbitrary equal-sized splits, and separation of changes that
must be understood or validated together. Repartition or add context until a
fresh executor can complete the L1 from the plan and repository alone.

Finish the plan:

1. Review all L1 and L2 for clarity and coherence.
2. Pose questions for material ambiguity. Solve all doubts.
3. Git branch based on plan (name as org file without .org)
4. Run all tests, make sure there is no error before handover.

# Supervised execution

For each implementation, ask whether the user wants manual or supervised
execution. Manual execution is the fallback.

Supervised execution uses exactly four canonical roles:

- The **director** is the depth-zero agent in the user's initial Codex
  conversation. It may use any model selected by the CLI, owns communication
  with the user, launches the supervisor, and receives reports only from the
  supervisor.
- The **supervisor** is the depth-one `org-plan-supervisor`, default model
  `gpt-5.6-luna`. It coordinates the executor and reviewer, performs routine
  supervision, enforces evidence gates, and reports only to the director.
- The **executor** is the depth-two `org-plan-executor`, default model
  `gpt-5.6-terra`. It is the only code writer, receives implementation and
  corrective work, and reports only to the supervisor.
- The **reviewer** is the depth-two read-only `org-plan-reviewer`, default model
  `gpt-5.6-sol`. It reviews only assigned DONE + UNREVIEWED L1s, never implements
  or modifies the plan, and reports only to the supervisor.

Neither depth-two role reports directly to the director. Model names are defaults
for their profiles, not substitutes for the canonical role names.

Model identifiers are configuration values; Codex reports unavailable models
when a role is spawned. The helper prepares profiles, and the director launches
supervised execution. Manual execution remains the fallback.
Machine-readable success records percent-encode unsafe path bytes; unreserved
path characters remain unchanged.

The deterministic supervised sequence is:

1. The director prepares all three profiles and checks that Codex permits
   depth-two delegation. `[agents] max_depth = 2` is required: the director is
   depth zero, the supervisor is depth one, and the executor and reviewer are
   depth two. If nested spawning is unavailable, stop and tell the user to set
   this prerequisite; never edit the user's Codex configuration automatically.
2. The director spawns the supervisor with `fork_turns=none` and a fresh,
   complete assignment. The supervisor spawns one reviewer with
   `fork_turns=none`, keeps that read-only reviewer for the entire run, and sends
   it a complete standalone follow-up assignment for each audit.
3. Before each new L1, the supervisor verifies the preceding L1 is REVIEWED,
   terminates any previous executor, confirms it is closed, then spawns a fresh
   `org-plan-executor` with `fork_turns=none` for exactly that L1. Never carry an
   executor into another L1 or start the next L1 while the prior executor lives.
4. The L1 executor remains available through that L1's review. The supervisor
   waits for implementation gates before assigning the persistent reviewer; a
   REJECT returns bounded corrections to the same executor, followed by a new
   standalone audit assignment to the same reviewer.
5. After ACCEPT, the supervisor marks the L1 REVIEWED, terminates its executor,
   and confirms closure before selecting the next L1. It keeps only one
   write-capable child active throughout.

Every assignment must stand alone without inherited conversation context.

## Context reporting boundary

The executor and reviewer return concise evidence summaries only to the
supervisor, never raw logs or complete transcripts. The supervisor distills
child results without concealing or reinterpreting findings. Its report to the
director contains only decisions, actionable findings, commit IDs or ranges,
test commands with pass/fail summaries, dirty-scope results, blockers, and the
smallest relevant diagnostic excerpt when a failure cannot be understood
without it.

The supervisor runs potentially large repository inspections, test commands,
and log processing through an available context-preserving execution path that
derives milestone evidence without injecting raw output into conversational
context. If no such facility is available, capture output outside conversational
context and report only the command, exit status, pass/fail counts, affected
scope, and the smallest diagnostic excerpt needed for a failure. Keep short,
fixed-output observations direct.

Apply the same rule to director-side verification. Raw command output from these
operations must never enter supervisor or director reports. Do not install,
require, or silently enable a context-management plugin; context-mode is
acceptable only when already available, and the workflow must remain functional
without it.

## Human-readable director updates

On the first mention of an L1 or L2 in a supervision run, the supervisor resolves
it with `org-plan describe PLAN ID` and reports its title plus the concise Goal
or Why description. The exact ID may follow as supplemental data. Later updates
may use the title alone and do not repeat the full description. Never identify a
milestone only by an ordinal such as "L2 2" or by its raw ID.

On the first mention of a commit, the supervisor resolves its conventional
subject with the simplest read-only Git query, such as
`git show -s --format=%s COMMIT`, and reports that subject plus a concise purpose
before any optional short hash. A human checkpoint may format this as
`subject — purpose (short-hash)`. Later references may use the subject or
milestone title; a hash remains supplemental and is never the only human-facing
identifier.

This human-prose contract does not alter machine-readable agent assignments.
Fresh assignments continue to carry exact plan IDs, commit hashes or ranges, and
all other standalone execution boundaries.

By default, the director does not open, request, or forward complete child
transcripts. It may inspect a targeted part of a child thread only to investigate
a named failure or material ambiguity; any subsequent upstream report remains
summarized under this boundary.

The supervisor enforces these acceptance gates:

- After each L2, the supervisor confirms exactly one conventional implementation
  commit when files changed, confirms there are no unintended dirty paths,
  inspects the L2 diff, and requires current touched-test evidence before marking
  it DONE.
- After implementation gates, the supervisor repeatedly uses `next PLAN review`
  to select only DONE + UNREVIEWED L1s. Each fresh reviewer assignment covers
  only the selected L1 and its commit range, Goal, Tests, Done-when criteria,
  shared-code regression impact, and named evidence, and goes to the same
  persistent reviewer. Targeted shared context may be inspected when necessary,
  but accepted criteria from REVIEWED L1s are not reopened.
- The reviewer skips any REVIEWED L1 accidentally included in an assignment,
  reports the skip, and does not re-audit it. On ACCEPT, the supervisor marks
  only the accepted L1 REVIEWED and closes that L1's executor. On REJECT, it
  remains UNREVIEWED and the supervisor returns corrections to the same L1
  executor before requesting a new verdict from the persistent reviewer. A
  materially changed REVIEWED L1 must first be reset to UNREVIEWED.
- When `next PLAN review` finds nothing, the supervisor skips the reviewer and
  records that review is already current. Final acceptance requires the
  supervisor's current full-suite pass and clean intended scope, never a
  redundant whole-branch reviewer audit.

A reviewer REJECT verdict must contain actionable findings. The supervisor
returns the affected item to the executor for correction; the reviewer never
fixes it. Acceptance must always be an
explicit verdict with evidence.

For UI work, the plan's Tests and Done-when fields must name screenshots,
components, viewport sizes, and font-scale combinations. Non-UI work does not
require UI artifacts.

## Fresh assignment checklists

Each supervisor assignment states the plan path, target branch and base branch,
all prepared profile and model names, the complete L1/L2 loop, evidence gates,
incremental DONE + UNREVIEWED review selection and status transitions,
the persistent-reviewer and per-L1 fresh-executor lifecycle, preserved paths,
the `[agents] max_depth = 2` nesting requirement, and the stop condition for
material ambiguity.

Each executor assignment states the active L1 and complete L2 block, plan path,
target branch, its prepared profile and model names, relevant repository starting
state and accepted prior-L1 outputs, exact allowed change scope, required tests,
the exactly-one-commit rule, preserved paths, the single-L1 lifetime, and the
stop condition for material ambiguity.

Each reviewer assignment states the plan path, target branch, its prepared
profile and model names, the selected L1 ID and UNREVIEWED status, its read-only
commit range or diff, relevant Goal, Tests, and Done-when acceptance criteria,
shared-code regression impact, evidence locations, any applicable named UI
screenshot/component/viewport/font-scale matrix, prohibited actions, preserved
paths, the REVIEWED-assignment skip rule, the stop condition for material
ambiguity, and the required structured findings with evidence plus an explicit
ACCEPT or REJECT verdict.

Every role receives its checklist as a complete fresh assignment: once for the
supervisor, once per L1 executor generation, and once per persistent-reviewer
audit. Never rely on child memory or use parent-context references such as
"continue above", including for nested agents.

The supervisor classifies every failure before routing it:

- Routine mechanical failures return to the executor with the exact failing
  evidence, bounded execution scope, and acceptance conditions.
- Reviewer findings return to the executor unchanged in substance; the
  supervisor adds only the execution scope and does not conceal or reinterpret
  failed checks.
- Material ambiguity invokes the reviewer for a read-only options audit. If the
  plan still does not determine the choice, the supervisor stops and asks the
  director to obtain the user's decision rather than letting the executor choose
  an unresolved material requirement.

After correction, the supervisor reruns the applicable L2 or L1 gate and requests
a new reviewer verdict while the milestone remains UNREVIEWED. Before a material
correction to an accepted milestone, the supervisor explicitly resets it to
UNREVIEWED or reopens it as WIP, which performs that reset automatically.

# Executor

This section governs manual execution only. It is distinct from the supervised
depth-two `org-plan-executor` role defined above.

When assigned work, don't ask confirmation. Study the plan, check you
are on its assigned branch, pose questions at beginning only for
material doubts, then start and follow strictly the Loop per L1 and L2.
Resolve minor reversible questions from the plan and repository context.

Loop per L1, in order:
Take next WIP L1, else first TODO L1 → set WIP. Study L1.

Loop per L2, in order:
1. Take next WIP L2, else first TODO L2 → set WIP.
2. Implement this WIP L2 in the context of its L1.
3. Add and update tests. Run touched tests only. Fix.
4. Git commit changes; no commits if no file changed; use conventional commit messages.
5. Finish this WIP L2 → set DONE.
6. If WIP L1 has all DONE L2 → run all tests, fix any errors.
7. Finish this WIP L1 → set DONE.
8. Take the next DONE + UNREVIEWED L1 review, ask a reviewer to audit only that
   milestone, then record REVIEWED only after an explicit ACCEPT verdict. If no
   review is pending, skip the reviewer and record that review is current.

Repeat loops until all L1 and L2 in plan are DONE and all L1s are REVIEWED.

Remember:
The test execution is part of the editing workflow.
Add, update and run tests only when work on L1|L2 lead to code changes, else skip test operations.
If an L2 changes any file, you must create one conventional commit before marking that L2 done.
An L1 becomes DONE only after all child L2s are DONE and the full suite passes;
it becomes REVIEWED only after reviewer acceptance.
Do not commit Org plan files.
Stop only for material ambiguity.

Update `AGENTS.md` (LLM-oriented) with changes if relevant.
Print a brief summary for reviewers
