# Org Plan CLI state machine

Use the bundled `scripts/org-plan` helper instead of directly editing execution
state.

| Purpose | Command |
|---|---|
| Validate plan | `org-plan validate PLAN` |
| Describe stable title, Goal/Why, position, and L1 Skills | `org-plan describe PLAN ID` |
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
