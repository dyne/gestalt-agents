---
name: verification-before-completion
description: Use when reporting that work is complete, fixed, passing, verified, ready for review, or safe to ship
---

# Verification Before Completion

## Overview

Match completion claims to current evidence. Report what was actually checked, with which command or inspection, and what result it produced.

## Org Plan Authority

When `$org-plan` is active, it controls verification boundaries, test scope, commits, L1/L2 progression, and continuation. This skill consumes the evidence produced by that workflow; it does not trigger an additional command, test run, pause, review, commit gate, or task-transition gate.

At an L2 boundary, use the touched-test and implementation evidence required by Org Plan. At an L1 boundary, use the full-suite evidence required by Org Plan. Do not broaden either boundary.

## Evidence Contract

When reporting a result:

1. State the exact claim being made.
2. Identify the relevant evidence produced since the affected work last changed.
3. Check the command result, failure count, or inspected artifact.
4. Report the claim at the same scope as the evidence.
5. If adequate evidence is absent, say that the result is unverified instead of implying success.

Do not rerun checks solely because a message is being written. Run checks only when the governing workflow, task, or user request requires them.

## Claim Matching

| Claim | Relevant evidence | Insufficient evidence |
|---|---|---|
| Touched behavior passes | Current focused-test result | An older run from before the change |
| Full suite passes | Current full-suite result at the required boundary | Focused tests only |
| Build succeeds | Current build result | Lint output |
| Bug is fixed | Reproduction or relevant test result | Code changed without checking behavior |
| Regression coverage is relevant | Assertions exercise the intended behavior | A passing test of incidental details |
| Requirements are met | Requirement-by-requirement inspection | Tests alone |
| Delegated work is complete | Inspect artifacts and relevant results | Agent report alone |

## Reporting Examples

```text
Focused tests: `pytest tests/test_widget.py` — 12 passed.
Full suite was not run at this L2 boundary.
```

```text
The implementation is present, but no current test result is available; passing status is unverified.
```

Avoid broader statements such as “all tests pass” when only focused tests ran.

## Bottom Line

Use the evidence already required for the current workflow boundary. Make no claim broader than that evidence.
