---
name: systematic-debugging
description: Investigate bugs, test failures, build failures, performance regressions, and unexpected behavior before proposing a fix. Use when a reproducible symptom needs evidence, a root cause, a falsifiable hypothesis, and regression verification.
---

# Systematic Debugging

Do not propose a fix until evidence identifies a plausible root cause.

## Workflow

### 1. Establish the failure

- Read the complete error and relevant stack trace.
- Record exact reproduction steps, expected behavior, actual behavior, and
  whether reproduction is reliable.
- Inspect relevant recent changes, configuration, dependencies, and environment.
- At component boundaries, capture what enters, what leaves, and which state or
  configuration applies.

Exit when the failing component and evidence path are known. If the failure is
not reproducible, gather more data or report that limitation; do not guess.

### 2. Compare patterns

- Find the nearest working example in the same codebase.
- Read any reference implementation completely.
- List every relevant difference between the working and failing paths.
- Trace the bad value or state backward to its origin. Use
  [root-cause tracing](root-cause-tracing.md) for a deep call chain.

Exit with a specific causal explanation supported by observed differences.

### 3. Test one hypothesis

State: `I think <cause> produces <symptom> because <evidence>.`

Change or instrument one variable with the smallest reversible experiment. If
the result falsifies the hypothesis, discard it and return to evidence
collection; do not stack speculative fixes.

Exit only when the experiment confirms or rejects the stated hypothesis.

### 4. Implement and verify

- Fix the identified cause, not a downstream symptom.
- Add or update regression coverage for the intended behavior.
- Use `$gestalt:development-testing` to bring implementation and tests to green.
- Reproduce the original scenario and run the relevant regression suite.
- Use `$gestalt:verification-before-completion` for the final claim.

Another governing workflow may require observing a red test before
implementation. This skill itself requires relevant regression evidence, not a
particular test-writing order.

## Escalation

After three failed implementation attempts, stop making local patches and
reassess the architecture. Report the attempted hypotheses, evidence learned,
shared state or coupling uncovered, and options requiring a broader design
decision.

For timing-dependent failures, use
[condition-based waiting](condition-based-waiting.md). After finding the root
cause, use [defense in depth](defense-in-depth.md) only where additional
validation prevents recurrence.

When `$org-plan` is active, debugging remains inside the current L2; Org Plan
retains scope, test, state, review, and commit authority.
