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
Use the bundled `org-plan` helper to validate and change plan state.
See `org-plan --help` for its commands.

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

Repeat loops until all L1 and L2 in plan are DONE.

Remember:
The test execution is part of the editing workflow.
Add, update and run tests only when work on L1|L2 lead to code changes, else skip test operations.
If an L2 changes any file, you must create one conventional commit before marking that L2 done.
An L1 becomes DONE only after all child L2s are DONE and the full suite passes.
Do not commit Org plan files.
Stop only for material ambiguity.

Update `AGENTS.md` (LLM-oriented) with changes if relevant.
Print a brief summary for reviewers
