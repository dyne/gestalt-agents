# Agent repository guidance

## Org Plan supervised workflow invariants

- Treat the loaded Org Plan skill directory and exact supplied plan path as
  supervision inputs. Reuse them; do not search with `find` or `rg`, assume a
  repository-local `.gestalt/`, inspect helper source, or probe help before the
  first lifecycle command. Do not run `prepare-supervision` during ordinary supervised execution:
  it is setup-only and `gestalt-setup.sh` owns profile
  installation. If the helper or plan input is absent, report that single
  prerequisite instead of trying speculative paths.
- The depth-zero root combines director, reviewer, and supervisor duties in the
  user's initial Codex conversation. Its recommended read-only
  `org-plan-reviewer` launch profile defaults to Sol; an already-running root
  keeps its CLI-selected model. The root directly launches exactly one fresh
  depth-one `org-plan-executor` per L1. The executor defaults to Terra, is the
  only code writer, and reports only to the root. Do not create an intermediate
  supervisor or a separate routine L1 reviewer. The required terminal
  `gpt-5.6-sol` whole-branch reviewer is the sole exception.
- Use one-based canonical labels for plan references: L1 position `a` is
  `L<a>` and its L2 child position `b` is `L<a>.<b>`. IDs remain helper
  arguments. Agent-roster identity is deliberately different and exact: the
  root is `l0`; the executor for L1 position `a` is exactly `l<a>`. Pass that
  literal value as `task_name` (`l1`, then `l2`, and so on). Never append a
  title, role, nickname, plan name, L2 position, or generated label. For a
  replacement, use the exact physical identity supplied by Mobile. Never
  increment a generation speculatively; choose the first unused `l<a>_gN`
  only after the prior collaboration slot is confirmed unavailable.
- Every L1 must have exactly one non-empty `:SKILLS:` property and exactly one
  `:REVIEW_STATUS:` property, initially `UNREVIEWED`; L2s must have neither.
  `:SKILLS:` is a whitespace-separated list of exact `$skill` references chosen
  by comparing the L1 with the complete available skill catalog. Do not list
  `$gestalt:context-mode`; every role loads it as a mandatory baseline.
  Each fresh L1 executor loads that baseline plus exactly the declared
  task-specific list before repository inspection or implementation and stops
  without edits if either is unavailable.
  `REVIEWED` is valid only after reviewer acceptance of a DONE L1. Reopening a
  reviewed L1 as WIP resets it to `UNREVIEWED`; reset a completed reviewed L1
  explicitly before any material correction that does not reopen it.
- Use `org-plan next PLAN review` to select the first DONE + UNREVIEWED L1,
  `org-plan review PLAN ID REVIEWED|UNREVIEWED` for durable transitions, and
  `org-plan describe PLAN ID` for stable title plus Goal/Why text and L1 Skills.
  The reviewer
  skips already REVIEWED milestones, so appended refinement L1s do not trigger
  repeat audits of accepted work.
- After every successful `authoring-start`, `supervision-start`, `set`, `l2`,
  `review`, or external `resync`, the active root runs `org-plan projection PLAN`
  and calls host `update_plan` with its exact ordered plan items, while
  reporting the companion explanation separately. This is a
  best-effort UI projection only: a missing or failed host tool warns once,
  never changes or rolls back Org state, and is retried at the next lifecycle
  boundary. Executors report mutations; Bash and MCP code never invoke another
  Codex tool.
- Keep one writer active. The read-only root delegates implementation and
  corrective edits only to the active executor. Executor evidence and review
  requests go directly to the root as concise structured summaries. After all
  L1 executors have terminated, the terminal reviewer becomes the sole writer
  only when its review reports P0 or P1 issues.
- Treat supervision as a completion loop with explicit report boundaries. The
  executor owns its whole assigned L1, not one L2, but returns concise evidence
  after each L2 reaches DONE. The root validates that state and evidence,
  projects it, and, when supported, records `l2Completed` before returning one
  compact L2 final. Do not call `followup_task` before that final. Autopilot
  starts the next root turn, where the root resumes the same executor for the
  next L2 or begins L1 review. If no L2 boundary is available, preserve the
  legacy same-turn fallback: resume the same executor before returning a root
  response.
  If the user asks for status during partial work, answer briefly and perform
  that same continuation in the current turn; a status reply never consumes the
  required supervision action. Otherwise take the next eligible lifecycle action:
  review only a DONE + UNREVIEWED L1, finish an accepted L1, or launch the next
  L1. Never turn a partial report into a final user response or wait for
  progress approval. An accepted L1 may end its current root turn only after
  its commit/review/projection transition and optional `l1Accepted` checkpoint;
  it never ends the plan. The checkpoint must be the last tool call of the root
  turn: immediately emit the boundary final and end the turn. Autopilot
  continues in the next root turn, and the
  final L1 still has a later terminal-review turn. Without the optional
  checkpoint tool, retain safe continuous supervision and never stop early.
  A checkpoint is a short, idempotent persist-and-ack boundary, never a wait
  episode. Do not register a wait lease or wait for `executorChanged` after
  it; Mobile schedules the fenced continuation from durable
  `checkpointChanged` after the matching root final. If a later turn observes
  `checkpointHandoffFailed`, re-read durable plan and control state instead of
  blindly replaying the checkpoint, requesting attention, or inventing a
  replacement. Treat `safetyPaused` as a safe terminal control state and
  resume only after Mobile or explicit manual recovery.
  Stop only after the complete plan is accepted or when a genuine external
  blocker remains that the root cannot resolve without user input or changed
  external state.
- `org-plan signal PLAN supervision-start` has a required postcondition: Mobile
  either reports enabled healthy control for the retained plan, or the root
  reports one bounded compatibility warning and stays in same-turn continuous
  supervision. Before yielding an incomplete plan, choose exactly one legal
  disposition: actionable work, same-executor follow-up, review/correction,
  accepted-L1 checkpoint and boundary final, one-shot wait lease,
  table-qualified attention, or explicit manual Off. Status prose alone is not
  a disposition. Executor completion/error/interruption/idle, process result,
  and a user status question wake the root; do not require a probe or lease
  before immediate work. A replacement physical slot may use `l<a>_gN`, but its
  displayed roster identity remains exactly `l<a>` and its generation follows
  the non-speculative replacement rule above.
- Before yielding for an operation that is reasonably expected to outlast the
  normal Autopilot control interval, the root registers
  `gestalt_autopilot_wait_lease` version 2 with a unique report and lease ID,
  the smallest relevant observable wake set, and a bounded `maxWaitMs` between
  one minute and 24 hours. Mobile resumes on the first matching event or the
  deadline. The lease covers one episode only and never changes the permanent
  pulse policy; if the wait is still justified in a later turn, the root must
  assess and register a new lease. Use process events for an observable command
  and `executorChanged` for long delegated work. Never lease routine work,
  hide a stalled executor, or delay an action available now. For GitHub PR CI,
  the root starts `gh pr checks <PR> --watch --interval 30` with a short initial
  command yield; only if it remains running does the root lease
  `processExited` and `processResultAvailable`, then consumes that same process
  result after wake. Mobile never needs GitHub credentials or its own CI poller.
- When failed child initialization leaves stale, non-working `pending_init`
  agents consuming every collaboration slot and interrupt does not release
  them, the root calls `gestalt_agent_capacity_recovery` exactly once with
  version 1 and reason `agentThreadLimit`. An accepted call is a Mobile-owned
  recycle of only that session's Codex runtime; it preserves the durable root
  thread and Org Plan and returns continuation to Autopilot. Do not retry spawn,
  request attention, or report a blocker during the handoff. Block only if the
  recovery tool is unavailable or rejects the root-owned request.
- Org Plan files are workspace-local runtime coordination data and are never
  Git deliverables. No user request, repository instruction, or release
  workflow can permit staging, committing, force-adding, cherry-picking, or
  otherwise introducing an Org Plan into Git history. Before every accepted L1
  commit, the executor and root inspect `git diff --cached --name-only` and
  reject the commit if it contains the active plan or any `.gestalt/*.org` path.
- Use host-native filesystem tools for governing instructions, small bounded
  reads, edits, mutations, and short command interaction; use context-mode only
  for large or uncertain analysis, filtering, indexing, and retrieval. If it
  is unavailable, capture output outside conversational context and report only the command, exit
  status, pass/fail counts, affected scope, and smallest necessary failure excerpt. Load the installed `$gestalt:context-mode` skill in every role, but do not install or enable it automatically when unavailable.
- Post brief human-facing status at supervision start and when an L1 starts,
  reaches review, is rejected, is accepted, or blocks. For every DONE L2, emit
  exactly one concise root final with Completion, Files, Verification, Commit,
  and Next. `Commit` says it is pending L1 acceptance because L2s never commit.
  For each accepted L1, emit exactly one concise root final answer that rolls up
  its L2 outcomes and includes Completion, Files, Review, Verification, Commit,
  and Next. After either boundary checkpoint, make no more tool calls, launch no
  executor, perform no review, and start no later milestone in that root turn.
  Synthesize only facts added since the previous boundary; do not copy
  commentary, raw logs, or child transcripts. The terminal success answer follows only the
  terminal whole-branch review, correction commit if needed, final gates,
  residual P2-or-lower findings, and clean intended scope.
  Use `L<a>/TOTAL — TITLE: STATUS` when possible. Resolve the first
  milestone mention with `org-plan describe` and lead with its position, title,
  and Goal/Why; later mentions may use the position and title alone. Lead the
  first commit mention with its conventional subject and purpose; IDs and hashes
  are supplemental. Machine assignments retain exact IDs and commit ranges.
- Routine L1 review is an agent-to-agent gate: the root independently inspects
  the executor's evidence and returns ACCEPT or REJECT directly to that
  executor. Do not ask the user for progress decisions or review approval;
  request user input only for material ambiguity or an unavailable prerequisite.
- After every L1 is DONE and REVIEWED, terminate the last L1 executor and spawn
  one fresh depth-one subagent with `fork_turns=none`,
  `agent_type=org-plan-reviewer`, and `task_name=final_review`. That dedicated
  role fixes the reviewer model to Sol. Give it a general overview
  of the implemented Org Plan, including the plan goal, milestones, branch base,
  commits, tests, and known tradeoffs. Require a whole-branch review of all
  implementation work against the Org Plan and a severity-ranked report. If it
  reports any P0 or P1
  issue, order that same subagent to fix every such issue as the sole writer,
  add regression coverage, and run focused plus full-suite checks. The root
  reviews the correction diff and, after acceptance, directs one conventional
  final-review correction commit that excludes every Org Plan path. P2 and
  lower findings may remain reported. Final acceptance requires no unresolved
  P0/P1 findings, a current root-side full-suite pass, and clean intended scope.

## Optional human-attention protocol

`gestalt_org_plan_attention` is an optional mobile dynamic tool, not an
`$org-plan` dependency. Its schema version is 1. After exhausting safe
in-scope checks, roots and executors call it before sending any blocker response
or yielding for a genuine table-qualified blocker: a material plan change
(`planChange`/`planRevision`),
exhausted hard block (`hardBlock`/`externalStateChanged`), unavailable required
dependency (`missingDependency`/`dependencyInstalled`), missing authority
(`permissionRequired`/`permissionGranted`), changed external state
(`externalState`/`externalStateChanged`), or unresolved material ambiguity
(`materialAmbiguity`/`userGuidance`). Every call includes a bounded summary and
a concrete requested action. If the tool is absent, report the ordinary blocker
without treating it as a missing Org Plan dependency.

When the tool is available, blocker prose is not a signal. A successful call is
the terminal disposition for that turn: issue no further lifecycle action and
let Mobile hold Autopilot until the mapped resume condition occurs.

A mobile autopilot checkpoint is synthetic control input: it never changes plan
scope or review authority. On a checkpoint, either emit the table-qualified
attention call or immediately resume the next legal Org Plan lifecycle action.
Never escalate progress, child reports, waiting on a live child, review
readiness, recoverable test failures, ordinary merge conflicts, token/context
pressure, elapsed time, checkpoints, or executor idleness.

## Vendoring skills for Codex and `npx skills`

Keep one canonical copy under
`plugins/<plugin-name>/skills/<skill-name>/`. Codex loads that tree through
`.codex-plugin/plugin.json` with `"skills": "./skills/"`; the marketplace entry
points to `./plugins/<plugin-name>`, producing
`<plugin-name>@dyne-gestalt-agents`.

The `skills` CLI recursively discovers `SKILL.md` files when no standard
top-level skill container is present. The same nested directories therefore
appear individually in `npx skills add dyne/gestalt-agents --list`. Do not add a
duplicate root `skills/` tree or repository symlinks: copies drift, while
symlink behavior differs across installers and operating systems.

Vendor complete directories, including references, scripts, examples, assets,
agent metadata, executable modes, and relative paths. Record the upstream
repository, release, commit, and license. Exact vendors use a committed SHA-256
manifest for relative paths, regular-file types, executable modes, and contents;
reject symlinks in the vendored tree.

If project coherence requires instruction changes, treat the package as an
attributed downstream adaptation rather than an exact vendor. Record every
rename, omission, and behavioral change in the plugin's `UPSTREAM.md`; use a
distinct downstream packaging version; and make the checksum fixture describe
the adapted package state. On update, import a new pinned upstream version,
reapply and reassess the documented adaptations, then regenerate the fixture.

Verify plugin manifests, marketplace metadata, checksums, `SKILL.md`
frontmatter, `agents/openai.yaml`, individual `npx skills` discovery, the full
test suite, and `git diff --check`.

Run `npx skills` discovery against a clean temporary copy of distributable
plugin content, excluding ignored references and development fixtures. Strip
terminal control sequences, parse discovered skill names, and assert the exact
expected set with each name appearing once; substring checks against the raw
CLI output can pass on descriptions or unrelated checkout content.

Equivalent skills from two enabled plugins can both trigger. Keep installation
explicit and document conflicts; a plugin must not silently install or disable
another plugin.
