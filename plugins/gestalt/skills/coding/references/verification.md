# Verification, review, and incremental migration

Select checks that establish the requested contract and the boundaries changed.
Do not duplicate every test at every layer or require a fixed test pyramid ratio.

| Boundary | Evidence |
|---|---|
| Domain | Pure tests for valid/invalid transitions, value equality, invariants, and deterministic time/IDs |
| Use case | Fakes for ports; assert business results, failure handling, and meaningful side-effect contracts |
| Outbound adapter | Contract suite shared by real/fake implementations where valuable; real infrastructure for serialization, SQL, transactions, conflicts, and error mapping |
| Inbound adapter/slice | Register the actual route/job/CLI; verify parsing, validation, access rules, response/errors, and resulting state |
| Architecture | Existing dependency checks, import rules, or module visibility enforce important boundaries |
| End-to-end | A small set of critical user journeys and external integration seams |

For VSA, prefer feature tests through its public entry point with isolated test
data and observable outcomes. Add pure unit tests for complex rules and platform
tests for shared plumbing. For ports/adapters, unit fakes make orchestration
cheap to exercise, but do not prove the production adapter works.

Use repository-standard tools: Go `testing`/`httptest`, .NET test server or
`WebApplicationFactory`, Java/Kotlin framework test slices or integration tests,
TypeScript route test clients with the existing runner, Python `pytest` and the
framework's test client. Use testcontainers or equivalent isolated services when
available and appropriate; absence does not authorize installing Docker or
changing the host. Keep test fixtures/builders small and readable. Avoid a mock
assertion for every internal call when a result assertion proves the behavior.

For changed persistence or messaging, check rollback, concurrency, duplicate
delivery, failure after an external effect, and retry behavior as applicable.
Report unavailable integration dependencies rather than equating mock success
with production correctness.

## Migrate one behavior

1. Choose a high-change, bounded flow with a manageable blast radius.
2. Characterize its current response, side effects, and important failures.
3. Extract explicit input/output and a use-case boundary; place a facade/port
   around existing infrastructure without replacing it yet.
4. Move the rule/orchestration behind that boundary and wire existing entry
   points to it. Preserve protocol contracts and data compatibility.
5. Verify equivalence and the intended improvement. Use a reversible route
   switch when deployment risk warrants it; remove obsolete paths when safe.
6. Repeat only within the authorized scope. Do not turn one extraction into
   a whole-system rewrite.

For a review, report evidence and consequences instead of counting patterns.
Check whether domain language is coherent, contexts own their models, invariants
are protected, dependencies match the chosen design, and recovery is explicit.
Suggest the smallest change that addresses a demonstrated problem. Missing
patterns may be appropriate simplifications.
