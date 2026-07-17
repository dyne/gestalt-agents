---
name: org-plan
description: Use when explicitly invoked as $org-plan to plan or manually execute a multi-step implementation through a strict root-level Org plan.
---

Never over-engineer: prefer the simplest viable approach.

Choose for minimalism and clarity, and use native doc-comments to
explain functions. Choose well known algorithms over inventing new
ones. Write code that is elegant and readable for humans.

- Challenge first ideas
- Weight alternatives
- Prefer minimalism

# Planner

When writing a plan go into detail: even a lesser LLM with low
thinking should be able to implement it. Ask for help if you have
material doubts. Do not add dependencies unless asked to, suggest them
if very useful.

Plan using Org files in `./<topic>.org` (short name, no date).
Org rules: headings in execution order; L1 `*` and L2 `**`; each
heading has TODO + importance [#A|#B|#C] and a unique kebab-case `:ID:`.
Every L1 property drawer has exactly one `:REVIEW_STATUS:`. New L1s start
`:REVIEW_STATUS: UNREVIEWED`; only Sol-accepted L1s use `REVIEWED`. L2 property
drawers never contain `:REVIEW_STATUS:`.
Use the bundled `org-plan` helper to validate and change plan state.
See `org-plan --help` for its commands.

Use `next PLAN review` to select the first completed unreviewed L1, `review PLAN
ID REVIEWED` after Sol acceptance, and `review PLAN ID UNREVIEWED` before a
material correction that does not reopen the L1. Reopening a reviewed L1 as WIP
resets it to `UNREVIEWED` automatically. Use `describe PLAN ID` to resolve an ID
to its title and `Goal` or `Why` text without parsing the Org file directly.

Plan file includes `#+TITLE`, `#+SUBTITLE`, `#+DATE`, `#+KEYWORDS`.
Each L1 includes `- Effort ::`, `- Goal ::`, `- Notes ::`.
Each L2 includes `- Why ::`, `- Change ::`, `- Tests ::`, `- Done when ::`.

Finish the plan:

1. Review all L1 and L2 for clarity and coherence.
2. Pose questions for material ambiguity. Solve all doubts.
3. Git branch based on plan (name as org file without .org)
4. Run all tests, make sure there is no error before handover.

# Supervisor

For each implementation, ask whether the user wants manual or supervised
execution. Manual execution is the fallback.

Supervised execution uses three fixed roles:

- `org-plan-supervisor` defaults to `gpt-5.6-luna`. Luna alone performs routine
  supervision: inspect Org state, verify the active branch and commit boundary,
  check dirty files, run or verify required commands, identify obvious missing
  tests, route bounded corrections, and report progress.
- `org-plan-executor` defaults to `gpt-5.6-terra`. Terra is the only role that
  receives implementation work or corrective edits.
- `org-plan-reviewer` defaults to `gpt-5.6-sol`. Sol is used only for read-only
  milestone audits, material design ambiguity, and final acceptance. Sol must
  never implement, modify the plan, commit, or supervise routine steps.

Model identifiers are configuration values; Codex reports unavailable models
when a role is spawned. The helper prepares profiles, and the planner launches
supervised execution. Manual execution remains the fallback.
Machine-readable success records percent-encode unsafe path bytes; unreserved
path characters remain unchanged.

The deterministic supervised sequence is:

1. The planner prepares all three profiles and checks that Codex permits
   depth-two delegation. `[agents] max_depth = 2` is required: the root is
   depth zero, Luna is depth one, and Terra and Sol are depth two. If nested
   spawning is unavailable, stop and tell the user to set this prerequisite;
   never edit the user's Codex configuration automatically.
2. The planner spawns Luna with `fork_turns=none` and a fresh, complete,
   explicit assignment. Luna spawns Terra with `fork_turns=none` and a fresh,
   complete, explicit assignment. Luna also spawns every Sol review with
   `fork_turns=none` and a fresh, complete, explicit assignment.
3. Luna keeps only one write-capable child active. It waits for Terra to finish
   tests and commit before starting Sol. Bounded fixes use follow-up assignments
   to the same Terra agent instead of creating competing writers.

Every assignment must stand alone without inherited conversation context.

## Context reporting boundary

Terra and Sol return concise evidence summaries, never raw logs or complete
transcripts. Luna distills child results without concealing or reinterpreting
findings. Luna's upstream report contains only decisions, actionable findings,
commit IDs or ranges, test commands with pass/fail summaries, dirty-scope
results, blockers, and the smallest relevant diagnostic excerpt when a failure
cannot be understood without it.

Luna runs potentially large repository inspections, test commands, and log
processing through an available context-preserving execution path that derives
milestone evidence without injecting raw output into conversational context. If
no such facility is available, capture output outside conversational context and
report only the command, exit status, pass/fail counts, affected scope, and the
smallest diagnostic excerpt needed for a failure. Keep short, fixed-output
observations direct.

Apply the same rule to director-side verification. Raw command output from these
operations must never enter supervisor or director reports. Do not install,
require, or silently enable a context-management plugin; context-mode is
acceptable only when already available, and the workflow must remain functional
without it.

## Human-readable director updates

On the first mention of an L1 or L2 in a supervision run, Luna resolves it with
`org-plan describe PLAN ID` and reports its title plus the concise Goal or Why
description. The exact ID may follow as supplemental data. Later updates may use
the title alone and do not repeat the full description. Never identify a
milestone only by an ordinal such as "L2 2" or by its raw ID.

On the first mention of a commit, Luna resolves its conventional subject with
the simplest read-only Git query, such as `git show -s --format=%s COMMIT`, and
reports that subject plus a concise purpose before any optional short hash. A
human checkpoint may format this as `subject — purpose (short-hash)`. Later
references may use the subject or milestone title; a hash remains supplemental
and is never the only human-facing identifier.

This human-prose contract does not alter machine-readable agent assignments.
Fresh assignments continue to carry exact plan IDs, commit hashes or ranges, and
all other standalone execution boundaries.

By default, the root does not open, request, or forward complete child
transcripts. It may inspect a targeted part of a child thread only to investigate
a named failure or material ambiguity; any subsequent upstream report remains
summarized under this boundary.

Luna enforces these acceptance gates:

- After each L2, Luna confirms exactly one conventional implementation commit
  when files changed, confirms there are no unintended dirty paths, inspects the
  L2 diff, and requires current touched-test evidence before marking it DONE.
- After implementation gates, Luna repeatedly uses `next PLAN review` to select
  only DONE + UNREVIEWED L1s. Each fresh Sol assignment covers only the selected
  L1 and its commit range, Goal, Tests, Done-when criteria, shared-code regression
  impact, and named evidence. Targeted shared context may be inspected when
  necessary, but accepted criteria from REVIEWED L1s are not reopened.
- Sol skips any REVIEWED L1 accidentally included in an assignment, reports the
  skip, and does not re-audit it. On ACCEPT, Luna marks only the accepted L1
  REVIEWED. On REJECT, it remains UNREVIEWED and Luna returns the corrections to
  Terra before requesting a new verdict. A materially changed REVIEWED L1 must
  first be reset to UNREVIEWED.
- When `next PLAN review` finds nothing, Luna skips Sol and records that review is
  already current. Final acceptance requires Luna's current full-suite pass and
  clean intended scope, never a redundant whole-branch Sol audit.

A Sol REJECT verdict must contain actionable findings. Luna returns the affected
item to Terra for correction; Sol never fixes it. Acceptance must always be an
explicit verdict with evidence.

For UI work, the plan's Tests and Done-when fields must name screenshots,
components, viewport sizes, and font-scale combinations. Non-UI work does not
require UI artifacts.

## Fresh assignment checklists

Each Luna assignment states the plan path, target branch and base branch, all
prepared profile and model names, the complete L1/L2 loop, evidence gates,
incremental DONE + UNREVIEWED review selection and status transitions, preserved
paths, the `[agents] max_depth = 2` nesting requirement, and the stop condition
for material ambiguity.

Each Terra assignment states the active L1 and complete L2 block, plan path,
target branch, its prepared profile and model names, exact allowed change scope,
required tests, the exactly-one-commit rule, preserved paths, and the stop
condition for material ambiguity.

Each Sol assignment states the plan path, target branch, its prepared profile and
model names, the selected L1 ID and UNREVIEWED status, its read-only commit range
or diff, relevant Goal, Tests, and Done-when acceptance criteria, shared-code
regression impact, evidence locations, any applicable named UI
screenshot/component/viewport/font-scale matrix, prohibited actions, preserved
paths, the REVIEWED-assignment skip rule, the stop condition for material
ambiguity, and the required structured findings with evidence plus an explicit
ACCEPT or REJECT verdict.

Every role receives its checklist as a complete fresh assignment. Never use
parent-context references such as "continue above", including for nested agents.

Luna classifies every failure before routing it:

- Routine mechanical failures return to Terra with the exact failing evidence,
  bounded execution scope, and acceptance conditions.
- Sol findings return to Terra unchanged in substance; Luna adds only the
  execution scope and does not conceal or reinterpret failed checks.
- Material ambiguity invokes Sol for a read-only options audit. If the plan
  still does not determine the choice, Luna stops and asks the user rather than
  letting Terra choose an unresolved material requirement.

After correction, Luna reruns the applicable L2 or L1 gate and requests a new
Sol verdict while the milestone remains UNREVIEWED. Before a material correction
to an accepted milestone, Luna explicitly resets it to UNREVIEWED or reopens it
as WIP, which performs that reset automatically.

# Executor

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
8. Take the next DONE + UNREVIEWED L1 review, ask Sol to audit only that
   milestone, then record REVIEWED only after an explicit ACCEPT verdict. If no
   review is pending, skip Sol and record that review is current.

Repeat loops until all L1 and L2 in plan are DONE and all L1s are REVIEWED.

Remember:
The test execution is part of the editing workflow.
Add, update and run tests only when work on L1|L2 lead to code changes, else skip test operations.
If an L2 changes any file, you must create one conventional commit before marking that L2 done.
An L1 becomes DONE only after all child L2s are DONE and the full suite passes;
it becomes REVIEWED only after Sol accepts it.
Do not commit Org plan files.
Stop only for material ambiguity.

Update `AGENTS.md` (LLM-oriented) with changes if relevant.
Print a brief summary for reviewers
