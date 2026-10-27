# Consolidated skill decision scenarios

Use these cases for manual or independent behavioral review. Inspect decisions
and artifacts, not exact phrasing. Structural/fixture tests do not prove model
selection or instruction following.

| Request and context | Expected result |
|---|---|
| Add a CRUD endpoint to a small feature-first app | Coding extends one cohesive slice and entry-point test; no compulsory CQRS, rich aggregate, or interface tree |
| Model underwriting with conflicting meanings of Customer | Coding uses a provisional/expert-validated glossary, bounded contexts, core-domain reasoning, invariants, and integration contracts |
| Refactor a framework-bound endpoint without changing its API | Coding characterizes behavior, extracts a use case and useful ports, preserves adapter contracts, and migrates one flow |
| Make two balances update atomically in one database | Coding preserves the invariant; does not demand eventual consistency merely because two aggregates exist |
| Publish an event after a payment and local save | Coding recognizes external-effect failure, outbox limits, idempotency, and compensation/recovery |
| Review React and FastAPI security | Security loads both matching guides plus browser baseline, traces evidence, and writes prioritized findings with paths/lines; does not fix without authority |
| Fix the authorized access-control finding | Security implements and tests denial and legitimate access paths without asking again for already supplied approval |
| Find security bus-factor risks in a Rust repo | Security uses language-independent ownership tools, states history/filter definitions, and qualifies inferred ownership |
| Explain a CSS layout bug | Security does not start an audit merely because frontend code is present |
| Make a POSIX sh deployment script portable to macOS | Scripting uses POSIX constructs, checks tool differences, and avoids unconditional Bash strict-mode/arrays |
| Bash cleanup script fails with spaces and interrupted writes | Scripting quotes arguments, tracks exact owned resources, preserves failure, and verifies cleanup in fixtures |
| Retry a timed-out payment POST | Scripting requires an idempotency/reconciliation contract, bounded attempts, and a failure outcome |
| Stop whatever is listening on port 3000 | Scripting verifies identity and authority, then uses graceful scoped shutdown; no blind kill substitution |
