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
| Record review | `org-plan review PLAN L1_ID REVIEWED\|UNREVIEWED` |
| Notify authoring | `org-plan signal PLAN authoring-start` |
| Notify execution | `org-plan signal PLAN work-start` |
| Notify supervision | `org-plan signal PLAN supervision-start` |
| Resync after external plan correction | `org-plan signal PLAN resync` |

Signals are safe no-ops when Gestalt Mobile status integration is absent.

## Native Codex plan projection

`org-plan projection PLAN` validates and emits a read-only JSON document with
a companion `explanation` plus ordered `plan` items ready for the host-owned
`update_plan` tool. Current Codex tool items accept only `step` and `status`,
so the root passes the exact `plan` array and reports the companion explanation
as status context. Its item statuses use tool spelling: `pending`,
`in_progress`, and `completed` (not app-server notification spelling
`inProgress`). It projects only L1s: `TODO` is pending, `WIP` is in progress,
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
L2: TODO -> WIP -> DONE
L1: TODO -> WIP -> DONE + UNREVIEWED -> REVIEWED
```

- Mark an L2 DONE only after intended-scope inspection and current focused-test
  evidence.
- Mark an L1 DONE only after every child is DONE and the full suite passes.
- Mark an L1 REVIEWED only after an explicit ACCEPT verdict.
- REJECT leaves the L1 DONE + UNREVIEWED while corrections and gates repeat.
- Reopening a REVIEWED L1 as WIP resets it to UNREVIEWED.
- Before materially changing a completed REVIEWED L1 without reopening it, run
  `org-plan review PLAN ID UNREVIEWED`.
- After an external correction to the plan, signal `resync` before continuing.
