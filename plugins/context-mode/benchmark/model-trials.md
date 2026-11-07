# Opt-in model comparison

This repository-only harness prepares controlled comparisons without dispatching
a model. Routine CI and the commands below use a fixed fake provider. Synthetic
numbers establish harness behavior, never model quality, provider usage, quota,
latency, or cost savings. Strict runtime attestation and native child interception
remain deferred; imported settings evidence still needs independent inspection.

From `plugins/context-mode`, generate the reproducible demonstration:

```sh
node_modules/.bin/tsx benchmark/model-trials.ts --fake /absolute/fake-trials.json
node_modules/.bin/tsx benchmark/model-trials.ts --summarize /absolute/fake-trials.json /absolute/fake-summary.json
```

Both commands write private JSON files and emit no trial payloads to the console.
The output contains `manifest` and `summary`. Read-only import accepts either this
envelope or a raw manifest. `--live` is unsupported and fails before writing an
output. There is no provider adapter, automatic launch, credential lookup or
network request. Do not treat `optIn: true` or an authorization reference as an
execution grant.

For a future explicitly authorized experiment, copy the existing
[planning template](../../gestalt/skills/org-plan/assets/model-comparison.template.json)
outside Git. Replace every placeholder with frozen real task inputs and exact
acceptance commands, working directories and criteria. The shared
[manifest contract](../../gestalt/skills/org-plan/references/model-comparison.md)
remains authoritative. Cover simple, bounded and multi-component tasks with the
same base, tools, dependency/environment fingerprints and acceptance checks for
every configuration. Schedule three repetitions per task/configuration, including
failed and cancelled trials. Use exact allowed model IDs, medium by default,
and independently verify availability and effective settings before any separately
authorized launch. This harness cannot establish that authority or launch work.

Retain every trial, retry, failure identifier, original observation time and
independent reviewer decision. List all expected actors, including supervisor,
executors, reviewers and retry attempts. Their per-actor counters must cover the
whole trial. The existing validator requires every counter key; unobserved values
remain null with a coverage reason. Each summary includes result, accounting,
acceptance and settings evidence references. Independently inspect these artifacts
before accepting a live comparison; format validity cannot authenticate evidence.

The fake runner executes 27 deterministic records: three task difficulties ×
three configurations × three repetitions. It deliberately includes one rejected
trial, one interrupted trial and retry attempts. `attempts` retains recovered
failure IDs and intermediate reviewer decisions separately from final trial
failures. Fake evidence is embedded under `artifacts`; each reference
`embedded:artifacts/KEY` identifies the JSON value whose compact UTF-8 JSON bytes
have the supplied SHA-256. `verifyEmbeddedEvidence` checks these digests. The
observation time and every counter are invented fixture values, labeled as such.

Summaries preserve failure/incomplete records and calculate median/min/max across
known samples, with expected, observed and missing counts. They never discard
failed trials. Imported records without an explicit `disjoint-trial-total`
accounting scope cannot produce all-agent sums. This scope is an assertion to
verify against accounting evidence, not proof from an agent ID. Known subtotals
remain labeled; unknown or missing agents/trials produce null totals. Cost per
accepted task uses costs from **all** trials, including failed work, retries and
reviewers, and is null when cost or acceptance coverage is incomplete. Recovered
attempt failure coverage is unknown when imported attempt records are absent.

Input/output and cache/reasoning counters stay separate. Context occupancy and
per-agent quota observations are never summed into cumulative costs or each
other. Non-null quota requires direct-provider evidence under the shared schema;
the fake runner leaves it null. No byte/token-to-quota conversion exists. Live
quality and savings remain unverified even after importing a format-valid file.

## Root, executor and solo adoption trial

Current status: **not-run**. This package has no live provider/dispatch adapter.
The current tool-economy runtime has no verified named-fork XERJ index coverage
or usable Python/MJS Serena reference navigation (its active server is Svelte).
Plan continuation does not authorize live provider quota. Supply an explicitly
authorized test runtime/provider adapter, task coverage and language readiness
before observing model adoption. Do not install, index, switch projects, start
services or spend quota to fill these gaps.

Use the existing fake adapter to check harness plumbing and the read-only import
for separately collected authorized comparisons. Neither executes a real trial.
For adoption, repeat these steps separately for `root`, `executor` and `solo`:

1. Freeze the source branch/base/HEAD and dirty diff, installed package revision,
   runtime/tool configuration, task inputs and exact outcome checks outside Git.
   Choose a covered broad discovery question, a supported symbol/caller question
   and an exact-file or unsupported-language fallback. Use the same acceptance
   criteria across roles; root work remains read-only and executor edits require
   their existing scope authority. Use disposable task fixtures for edits.
2. Verify connected XERJ catalog repository/path provenance and current coverage.
   Verify Serena's definition/reference relation against current source. Record
   missing prerequisites as `not-run`; an advertised tool or symbol overview
   alone does not establish reference readiness. Do not create missing inputs.
3. In the separately authorized runtime, observe one useful XERJ query, a Serena
   symbol operation and reference operation, and a correct native fallback per
   role. Retain selected operations, source revisions, useful locators, fallback
   reason and independent outcome-check references. Verify actual current files
   after retrieval. Reuse unchanged revision/artifact results only while source,
   permissions, runtime and task identities match; refresh affected evidence
   after a change. More calls or smaller output do not establish better outcomes.
4. Collect runtime/provider observation references and outcomes, including failed
   attempts. Keep unknown input/output usage and provider latency null; zero
   requires an observed counter with evidence. Keep instruction scalar deltas,
   host delivery bytes and provider inputs separate. Retain full evidence in its
   authorized private location; export structural metadata only, never prompts,
   model output, transcripts or environment values. Release and verify cleanup
   of every owned task fixture; preserve durable evidence.
5. Validate the structural report using the implemented command below, then
   independently inspect every referenced artifact, original observation time,
   source identity and outcome. Schema validity cannot authenticate a model or
   installation. Source tests and local invented-backend delivery remain distinct
   from real-model observations. No deployment or publication is performed.

From `plugins/context-mode` (existing local dependencies required):

```sh
node --import tsx benchmark/model-trials.ts --validate-adoption-report /absolute/adoption-report.json /absolute/adoption-verdict.json
```

This command reads the report, writes a private structural verdict and emits no
payload to stdout. Invalid reports fail before writing a verdict. It performs no
dispatch, evidence fetching or installation verification. Use a fresh output path.
Malformed JSON receives a static `MODEL_TRIAL_INPUT_INVALID` diagnostic without
parser excerpts; filesystem errors remain separate.
The existing `--summarize` comparison import is a separate format contract, not
an adoption admission gate: it rejects embedded fixture data labelled live, but
external references remain unverified and cannot establish real-model evidence.

Adoption report schema (all listed keys required; extra keys at any object level
are rejected):

- Top level: `schemaVersion: 1`, `evidenceKind` (`fixture`, `real-model` or
  `not-run`), `sourceRevision` (40 lowercase hex),
  `installedSourceEquivalence: "unverified"`, and `roles`.
- Exactly three role entries: `role` (`root`, `executor`, `solo`), `status`
  (`observed`, `not-run`), `missingInputs` (short prerequisite descriptions),
  `runtimeEvidence`, `outcome`, `operations` and `usage`.
- An observed role has empty `missingInputs`, runtime evidence, an outcome
  `{passed: boolean, evidence}`, and operations for all four pairs:
  `xerj/query`, `serena/symbol`, `serena/references`, `native/fallback`.
  Each operation has `tool`, `operation`, `sourceRevision`, `locator`,
  `fallbackReason` (nonempty only for fallback) and `evidence`.
- `usage` has `inputTokens`, `outputTokens`, `providerLatencyMs`, each
  `{value, evidence}`. Unknown means both null. Token counts are nonnegative safe
  integers; latency is finite nonnegative milliseconds, including fractions.
  Every observed value, including zero, requires provider evidence.
- Every evidence object is `{kind, reference, sha256, observedAt}` with a
  nonempty reference, 64 lowercase hex digest and original ISO UTC timestamp
  (`YYYY-MM-DDTHH:mm:ss[.SSS]Z`, optional one to three fractional digits).
  Real-model evidence kinds are respectively `runtime-observation`,
  `outcome-check`, `tool-observation`, `provider-observation`. Fixture reports
  use `fixture` evidence. Real reports reject `embedded:`, `fake-provider:` and
  `fixture:` references. Labels and hashes still need independent provenance review.
- A not-run role has nonempty `missingInputs`, null runtime/outcome, no operations
  and all-null usage. A `not-run` report contains only such roles. Other report
  kinds require at least one observed role and may retain unrun roles explicitly.

For the current not-run record, use all three roles with
`missingInputs: ["Authorized live provider adapter", "Verified task index and language reference readiness"]`.
No observed operations, outcome or usage can be inferred from passing offline
fixtures. The validator's verdict always leaves live adoption and installed
equivalence unverified; a positive live claim requires independent observations.
