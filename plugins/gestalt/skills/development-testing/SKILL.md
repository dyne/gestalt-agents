---
name: development-testing
description: Use when an implementation goal is complete enough to define coherent automated tests, or when implementation and tests must be brought to green before completion
---

# Development Testing

## Overview

Implement the stated goal, then create or update tests that express that goal and make the implementation and tests agree until the relevant suite is green.

## Org Plan Authority

When `$org-plan` is active, it controls L1/L2 order, scope, test boundaries, commits, and continuation. This skill operates inside the current L2 and adds no separate gate, pause, review, subagent, or commit workflow.

## Workflow

1. Implement the current goal within its stated scope.
2. Create or update tests that are coherent with the implementation goal and externally observable behavior.
3. Run the tests relevant to the changed behavior.
4. If code or tests fail, diagnose the mismatch and fix the appropriate side.
5. Repeat the relevant test run until green.
6. At an Org Plan L1 boundary, run only the broader verification required by Org Plan.

There is no requirement to write or observe a failing test before production code. Tests must validate the intended goal rather than freeze incidental implementation details.

## Choosing What to Fix

- Fix production code when it does not meet the goal or intended behavior.
- Fix tests when they encode an incorrect assumption, an obsolete contract, or implementation detail that is not part of the goal.
- Clarify the goal when code and tests expose a genuine requirement ambiguity.
- Keep unrelated refactors and speculative cases outside the current scope.

## Completion Evidence

Report the exact commands run and their current results. Use `superpowers:verification-before-completion` before claiming the work is complete or passing.
