---
name: development-testing
description: Implement a defined behavior, create or update coherent automated tests for its observable contract, and bring the relevant suite to green. Use when implementation and tests must agree before completion; a red-first test is not required unless another governing workflow requires it.
---

# Development Testing

1. Implement the stated behavior within the current scope.
2. Add or update tests for its externally observable contract.
3. Run the smallest suite that exercises the changed behavior.
4. Diagnose each mismatch. Fix production code when behavior is wrong; fix a
   test when it encodes an obsolete contract or incidental implementation
   detail; request clarification only for a material requirement ambiguity.
5. Repeat until the relevant suite is green.
6. Report the exact commands and current results. Apply
   `$gestalt:verification-before-completion` before making a completion claim.

Do not bundle unrelated refactors or speculative cases. When `$org-plan` is
active, remain inside its current L2 and use only its prescribed test boundary,
state transitions, review, and commit workflow.
