# Stable CI overhead budgets

Run from `plugins/context-mode`:

```sh
npm run test:overhead -- --evidence-dir /absolute/evidence-directory
```

This gate runs the frozen candidate through production handlers in isolated
state, inventories repository-owned instruction paths and generated profiles in
a temporary agents directory, and exercises production dedup/overflow helpers.
It never calls a provider or changes installed profiles or the source session.
The normal `npm test` also runs its regression and negative-control tests;
`tests/ci.sh` runs the standalone gate before the package suite so an overhead
regression emits bounded diagnostics and retains its artifact immediately.

`fixtures/overhead-budgets.json` contains reviewed fixed ceilings, not values
regenerated from a candidate. The L2 contract applies to whole serialized
execute, execute_file, batch and search result envelopes: 2,048 UTF-8 bytes by
default, including metadata and escaping. Explicit expansion remains supported
through 65,536 bytes. Other evidence-tool envelopes use a separate report-text
budget and can exceed 2,048 bytes after envelope serialization; their measured
maximum is disclosed separately. They still contribute to every L9.1 retrieval
and overflow cost. This gate makes no claim that every tool has L2's envelope
limit.

The frozen initial retrieval denominator includes both broad and overlapping
queries plus indexing. Its independently observed baseline is 10,930 returned
bytes and 12,411 bytes including requests/descriptions. Fixed ceilings 5,465 and
6,205 preserve at least a 50% reduction. Full authorized overflow recovery and
late failures must survive. Bootstrap ceilings pin bytes **and** words for each
generated profile and complete root/executor/terminal-reviewer instruction path,
plus discovery metadata. Host-owned instructions and tool schema framing are
unobserved and excluded from this repository inventory.

CI fetches history and supplies the pull-request base (or calling push's prior
revision) through `OVERHEAD_BASE_REVISION`. A local comparison can use `--base
REVISION`. A nonexistent revision fails. The initial addition of this budget
file is distinguished from an unreadable existing file. Later numeric increases
or removed ceilings require an `amendment` containing `reason`,
`evidenceReference`, `reviewReference`, `previousBudgetsSha256` and affected
`metrics`. The digest is SHA-256 of the prior parsed budget's compact JSON, with
its original property order. Existing negative controls verify rejection when
this record is missing or stale. A reference is an assertion for the repository
reviewer to verify; this format check cannot authenticate a reviewer or replace
required code review. Never raise a ceiling merely to make a regression pass.

Query-window duplication, lost query attribution, instruction growth, unknown
response bytes and missing overflow fail the gate with concrete metric IDs.
The wake negative controls use an explicitly invented sanitized trace: repeated
unchanged status must not create accepted turns; two distinct accepted turns for
one actionable wake fail. Duplicate receipts for the same runtime turn count
once. This checks the budget contract, not a scheduler implementation. Mobile's
own `npm test` runs `wake-attribution.test.ts` against its production coordinator
and persistence; L9 consumes that pinned owner gate read-only. The Agents job
does not require a second repository checkout or pretend to execute Mobile.

Failure reports stay below 2,048 bytes, including escaped and multibyte text.
They retain the first actionable metric, total failure count and a digest-bound
complete JSON artifact with every failure. Storage/integrity failure explicitly
reports partial evidence and still fails. The GitHub workflow uploads these
artifacts from the runner's temporary directory on failure, retaining them seven
days. After expiry, rerun the gate; do not claim unavailable artifacts are
complete evidence. No live usage, quota, latency or production-readiness claim
follows from these checks.
