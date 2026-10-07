# Selected tests and controlled concurrency

Before running a filter, name the intended test identities and expected executed
count. Compare them with the runner's actual report, including failures and
skips. Prefer its native structured report when available. An exit-zero command
with zero matches, only skipped cases, or the wrong test identities leaves the
target behavior **unverified**. Correct selection and rerun; do not widen or
weaken the intended test silently. Report executed, passed, failed and skipped
counts separately rather than treating collected tests as executed tests.
Some runners can report a passing test-file wrapper when no named test matches;
that file-level count does not establish that the intended regression executed.

Keep the failure classification tied to evidence:

| Evidence | Classification and next action |
| --- | --- |
| A required executable, browser or writable evidence destination is unavailable | Environment; repair the declared prerequisite before the suite. |
| Intended identities are absent or skipped | Selection; fix the runner's selection before claiming a pass. |
| Intended regression executes and fails at its expected assertion before the fix | Expected regression failure; retain the failure and verify the same identity after the fix. |
| An injected gate is still held when a wait expires, or cleanup is incomplete | Harness; release and settle the held operations before investigating a product hang. |
| Intended tests execute with prerequisites and harness invariants satisfied, yet observable behavior violates the contract | Product failure; investigate the reproduced defect. This alone does not prove a historical incident cause. |

For controlled concurrency, assert the injected preconditions actually occurred
before relying on a race. Give each held operation an owned release path, bound
every wait, and use `finally` or the runner's teardown to release **all** gates
and await completion on success and failure. Record remaining held/in-flight
operations after cleanup. A timeout while a test still holds a prerequisite is
harness evidence, not proof that product code hangs.

The repository's `tests/plugins/gestalt/test-test-execution.sh` runs synthetic
examples using Node's native JUnit report. They distinguish absent selection,
all-skipped selection, expected before-fix failure, product assertion failure,
missing environment prerequisites and an intentionally held-gate timeout. The
executable fixture records preconditions and cleanup even for expected failures.
These are deterministic contract scenarios, not behavioral model evaluation.
