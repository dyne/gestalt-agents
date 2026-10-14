# Org Plan CLI state machine

Use the bundled `scripts/org-plan` helper instead of directly editing execution
state.

| Purpose | Command |
|---|---|
| Validate plan | `org-plan validate PLAN` |
| Describe stable title, Goal/Why, position, and L1 Skills | `org-plan describe PLAN ID` |
| Emit the read-only native Codex plan projection | `org-plan projection PLAN` |
| Select implementation work | `org-plan next PLAN implement` |
| Select first DONE + UNREVIEWED L1 | `org-plan next PLAN review` |
| Transition L1 | `org-plan set PLAN L1_ID WIP\|DONE` |
| Transition L2 | `org-plan l2 PLAN L2_ID WIP\|DONE` |
| Suspend dependent work and reopen dependency atomically | `org-plan suspend-reopen PLAN DEPENDENT_L1_ID DEPENDENCY_L1_ID` |
| Resume suspended work after dependency acceptance | `org-plan resume PLAN DEPENDENT_L1_ID` |
| Record review | `org-plan review PLAN L1_ID REVIEWED\|UNREVIEWED` |
| Notify authoring | `org-plan signal PLAN authoring-start` |
| Notify execution | `org-plan signal PLAN work-start` |
| Notify supervision | `org-plan signal PLAN supervision-start` |
| Resync after external plan correction | `org-plan signal PLAN resync` |

Signals are safe no-ops when Gestalt Mobile status integration is absent.
For startup compatibility, `org-plan supervision-start PLAN` is an exact alias
for the supervision signal, and `org-plan status PLAN` is a read-only alias for
`org-plan summary PLAN`.

In Mobile's session-directory mode, the first `supervision-start` for a plan in
that relay session publishes the status document. Repeating it in the same
directory retains the existing document instead of emitting another activation
edge. A private per-plan marker distinguishes a prior activation from ordinary
`work-start` or lifecycle publication, so a missed activation remains
recoverable. A resumed relay session receives a fresh directory, so it must
invoke the command again even when the Org Plan itself is already WIP. Legacy
single-file mode continues to publish on every explicit signal because it has
no session-isolation boundary.

## Native Codex plan projection

`org-plan projection PLAN` validates and emits a read-only JSON document with
a companion `explanation` plus ordered `plan` items ready for the host-owned
`update_plan` tool. Current Codex tool items accept only `step` and `status`,
so the root passes the exact `plan` array and reports the companion explanation
as status context. Its item statuses use tool spelling: `pending`,
`in_progress`, and `completed` (not app-server notification spelling
`inProgress`). It projects only L1s: `TODO` is pending, `SUSPENDED` is pending with an explicit title label, `WIP` is in progress,
`DONE + UNREVIEWED` is in progress with “Awaiting review”, and `DONE +
REVIEWED` is completed. The Org file remains authoritative.

After every successful `authoring-start`, `supervision-start`, `set`, `l2`,
`review`, or external `resync`, the active root runs `org-plan projection PLAN`
and invokes host `update_plan` with its exact ordered plan items, reporting the
companion explanation separately.
This second action is best effort: if the host tool is absent or errors, warn
once concisely, preserve the valid Org mutation, and retry only at the next
lifecycle boundary. Bash helpers and MCP code never invoke `update_plan`.

## Legal progression

```text
L2: TODO -> WIP <-> DONE
L1: TODO -> WIP <-> DONE + UNREVIEWED -> REVIEWED
```

- Mark an L2 DONE only after intended-scope inspection and current focused-test
  evidence.
- Mark an L1 DONE only after every child is DONE and the full suite passes.
- Mark an L1 REVIEWED only after an explicit ACCEPT verdict.
- REJECT leaves the L1 DONE + UNREVIEWED while corrections and gates repeat.
- Reopen a DONE L1 or L2 as WIP whenever corrections require another completion
  cycle. Reopening a REVIEWED L1 also resets it to UNREVIEWED.
- WIP and DONE states never transition back to TODO, including with `--force`.
- Before materially changing a completed REVIEWED L1 without reopening it, run
  `org-plan review PLAN ID UNREVIEWED`.
- After an external correction to the plan, signal `resync` before continuing.

## Reopen an earlier dependency while preserving active work

Use `suspend-reopen` only for an approved dependency correction. It requires a
WIP dependent L1 and an earlier DONE dependency; all L1s before that dependency
must be DONE + REVIEWED. The helper atomically suspends the dependent L1 and
its WIP child, leaving its DONE/TODO children, measurements, IDs, priorities,
titles and ordering unchanged. The dependency becomes WIP + UNREVIEWED.
Previously DONE dependency children retain historical completion and must be
explicitly reopened before new implementation. There may be only one suspended
L1 and one active WIP path. `--force` cannot suspend, resume or mutate suspended
work. Ordinary transitions can reopen intervening accepted dependencies in
order. `resume` requires every earlier L1 DONE + REVIEWED and restores precisely
the suspended WIP path. Selection never dispatches suspended work or skips it
to a later TODO. Root retires or idles the dependent writer before transferring
ownership; suspension does not itself grant an executor or revoke a runtime.

A suspended L1 has `:SUSPENDED_FOR: earlier-l1-id` in its property drawer. This
property is removed on resume; existing telemetry and description remain intact.
All transition and measurement candidates must validate AND produce a legal
native projection before any plan write or status publication. Failed review
reset/projection validation leaves both source and status unchanged. Root alone
projects successful `suspend-reopen` and `resume` transitions through host
`update_plan`, as for other lifecycle transitions.

Legacy Mobile consumers parse raw Org and cannot accept SUSPENDED. When a Mobile
status destination is configured, suspended-plan transitions and publication
require `GESTALT_MOBILE_ORG_PLAN_CAPABILITIES` to contain comma-separated token
`suspension-v1`. The trusted host may set it only after compatible consumer and
control support is active; the token is a compatibility assertion, not runtime
proof. Missing support fails before plan/status writes. With no destination,
commands can operate on offline disposable plans; this is not permission to
change a plan retained by an incompatible running consumer. Signals retain the
existing schema and use `update` for these transitions.

For repository development, invoke `plugins/gestalt/skills/org-plan/scripts/org-plan`
directly. This uses colocated modules and requires no install, home mutation,
profile setup or running-service restart. Typed MCP counterparts are
`org_plan_suspend_reopen` and `org_plan_resume`.

Normal packaged Org MCP explicitly inherits the two status variables and
`GESTALT_MOBILE_ORG_PLAN_CAPABILITIES` through its three-entry `env_vars`
allowlist. It does not set a capability value. A compatible compiled Mobile
owning-session launch supplies the fixed token with its plan-status lease and
scrubs ambient/configured assertions. Validate actual propagation after an
explicitly authorized compatible build activation; repository configuration
and subprocess regression success do not establish running-host support.

Suspension support in normal Org MCP does not authorize a restricted Live
transport. A future Live integration must keep its environment fail-closed and
use a narrow typed, controller-authenticated consumer-capability input bound to
bootstrap/configuration and admission receipts, with invalidation on component
or configuration changes. Do not export an arbitrary token or widen process
environment forwarding to bypass that boundary.
