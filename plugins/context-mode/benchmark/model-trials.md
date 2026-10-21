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
