# CI overhead budgets

Run from `plugins/context-mode`:

```sh
npm run test:overhead -- --evidence-dir /absolute/evidence-directory
```

The gate runs frozen cases through production handlers in isolated state,
inventories repository-owned instruction paths and generated profiles in a
temporary agents directory, and exercises production dedup/overflow helpers.
It never calls a provider or changes installed profiles or the source session.
`tests/ci.sh` runs the gate before the package suite. `npm test` also runs its
regression and negative-control tests.

## Instruction growth policy

Instruction length is a maintenance signal, not a measure of instruction quality.
The former gate treated historical byte and word counts as exact maxima. One
extra byte could fail all three role paths even when it clarified a required
rule. Independent file limits and old experimental reduction assertions also
competed with that gate. That rewarded cosmetic shortening and made the
historical experiment a permanent restriction on future behavior.

Schema version 2 separates fixed reference sizes from generous hard ceilings:

- Report bytes, words, reference sizes, deltas and hard ceilings on every run.
- Growth **above 5%** of a fixed instruction reference emits a non-blocking CI
  warning. At or below 5%, size alone does not warn or fail.
- Rounded hard ceilings have roughly 25–40% headroom over the references. They
  catch large accidental duplication or unchecked expansion; exceeding them
  still fails CI. A proposed intentional increase needs an amendment and review.
- References never reset automatically to the latest measurement or PR base.
  Small changes accumulate against the same reference, so repeated small PRs
  cannot silently evade the warning. Raising or removing a reference also needs
  an amendment. Measurements missing or invalid remain failures.
- Profile and role limits live in `fixtures/overhead-budgets.json`. Org tests
  consume the same limits rather than imposing separate per-file word limits or
  requiring every release to beat old reduction experiments.

| Instruction inventory | Hard bytes | Hard words |
| --- | ---: | ---: |
| Root path | 70,000 | 9,500 |
| Executor path | 68,000 | 9,300 |
| Terminal-reviewer path | 65,000 | 8,900 |
| Reviewer profile | 5,000 | 700 |
| Executor profile | 2,600 | 400 |
| Discovery metadata | 5,500 | — |

The 5% warning and rounded ceilings are engineering judgments, not empirically
optimal prompt sizes or model context limits. They allow ordinary clarification
while keeping larger growth visible. They can be revised through review if
real task outcomes justify a different policy. Do not remove a necessary rule
merely to suppress a warning; explain what the additional instructions achieve.
Review startup order, role boundaries, required evidence and recovery behavior,
then check scenario regressions. Static scenarios do not establish live model
quality, latency, quota use or task success.

The inventory includes selected repository-owned instructions, required
references and generated profiles. Host instructions, tool schemas and user
conversation are unmeasured and excluded. Byte/word counts are reproducible
proxies, not model-token counts. No limits are imposed on user prompts or Org
plan length by this gate. Prior experiment fixtures remain historical evidence;
their old instruction-size improvement targets are no longer release gates.

## Strict response and correctness contracts

Instruction tolerance does not change response, retrieval or evidence contracts.
The declared L2 execute, execute_file, batch and search result envelopes remain
limited to 2,048 serialized UTF-8 bytes by default, including metadata and
escaping, with explicit expansion through 65,536 bytes. Other evidence-tool
envelopes have a separate report-text budget and may exceed 2,048 serialized
bytes; their maximum is reported separately. No claim is made that every tool
has the L2 envelope limit.

The frozen initial retrieval denominator includes broad and overlapping queries
plus indexing: 10,930 returned bytes and 12,411 including requests/descriptions.
Ceilings of 5,465 and 6,205 retain the existing 50% reduction contract. Complete
authorized overflow recovery and late failures must survive. Lost findings,
lost attribution, duplicate windows, missing measurements and broken expansion
remain hard failures. Instruction scenario and negative-control tests remain
mandatory; brevity cannot compensate for changed lifecycle semantics.

The wake negative controls use a sanitized synthetic trace: unchanged status
must not create accepted turns; distinct accepted turns for one actionable wake
fail. Duplicate receipts for the same runtime turn count once. This tests a
contract, not a scheduler implementation. Mobile owns the production
`wake-attribution.test.ts`; Agents does not simulate or execute its scheduler.

## Review and reporting

CI fetches history and supplies the PR base or prior push revision through
`OVERHEAD_BASE_REVISION`. Local comparisons can use `--base REVISION`.
A nonexistent or unreadable base fails. Initial budget introduction is distinct
from changes to an existing budget. Numeric increases or removed limits and
instruction references require an `amendment` with `reason`,
`evidenceReference`, `reviewReference`, `previousBudgetsSha256` and affected
`metrics`. The digest covers the prior parsed budget's compact JSON, preserving
property order. Metadata identifies the policy change for review; it does not
authenticate a reviewer or prove approval. The v2 migration documents its change
explicitly; subsequent changes need a new digest-bound amendment.

GitHub job summaries show a table of current instruction sizes and cumulative
deltas, including changes below the warning threshold. Every run retains a complete JSON report with measurements, instruction deltas,
warnings and failures. The console summary stays below 2,048 bytes and links to
that digest-bound artifact. Growth warnings also appear as GitHub annotations
(or plain stderr outside Actions); warnings alone leave the exit code zero.
Any hard failure or report-storage/integrity failure makes the exit code nonzero.
The workflow uploads overhead reports on success and failure and retains them
for seven days. After expiry rerun the gate; do not claim missing artifacts are
available evidence. No live usage or production-readiness claim follows from
these checks.
