---
name: verification-before-completion
description: Match claims of complete, fixed, passing, verified, review-ready, or safe-to-ship work to current evidence. Use immediately before reporting a result or accepting delegated work.
---

# Verification Before Completion

For every result claim:

1. State the exact claim and its scope.
2. Identify evidence produced after the affected work last changed.
3. Check the command exit status, intended test identities and actual executed,
   failed and skipped counts, reproduction, or inspected artifact. Zero matches,
   all-skipped selection or different identities leave the target unverified.
4. Report no broader claim than that evidence supports.
5. If adequate evidence is absent, call the result unverified.

| Claim | Sufficient evidence | Insufficient evidence |
|---|---|---|
| Touched behavior passes | current result with intended tests executed | an older run or only skipped tests |
| Full suite passes | current full-suite result | focused tests only |
| Build succeeds | current build result | lint output |
| Bug is fixed | current reproduction or regression test | code changed only |
| Historical incident cause is proven | incident-window evidence tying the mechanism to the failure | similar error text or a source reproduction alone |
| Running installation includes the fix | verified installed revision or deployment evidence | passing source tests |
| Requirements are met | criterion-by-criterion inspection | tests alone |
| Delegated work is complete | inspected artifacts and relevant results | agent report alone |

Do not rerun checks merely because a report is being written. Use evidence
required by the user, task, or governing workflow. When `$org-plan` is active,
use its focused L2 evidence and full-suite L1 evidence without adding another
gate.

For controlled concurrency, confirm injected preconditions and bounded waits,
then inspect evidence that every held operation was released and settled even
after failure. Incomplete harness cleanup cannot support a product-hang claim.
See [execution evidence](../development-testing/references/test-execution-evidence.md).

Report exact commands and results, for example:

```text
Focused tests: `pytest tests/test_widget.py` — 12 passed.
Full suite was not run at this boundary.
```
