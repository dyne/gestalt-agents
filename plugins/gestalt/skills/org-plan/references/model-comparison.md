# Opt-in same-task comparison manifest

Use [the template](../assets/model-comparison.template.json) to prepare controlled
trials only when explicitly authorized. `org-plan-model-comparison.mjs` validates
data without running a model, fetching evidence or granting execution authority.
The template contains obvious zero/REPLACE placeholders and records no trials;
pin actual inputs before any trial. Routine CI uses invented fixtures only.

For each representative task, freeze base SHA, tool/dependency/environment
digests and identical acceptance commands/criteria across configurations. Keep
three repetitions for each configuration, medium by default on every allowed
model tier. Higher effort requires the normal concrete necessity/return rule;
Astra and aliases are prohibited. An independent reviewer applies the same
acceptance gate to every trial. Revalidate catalog and effective settings before
authorized dispatch; this manifest is not runtime availability evidence.

Each trial retains task/configuration/repetition, `comparisonInputDigest(task)`,
status (`completed`, `failed`, `cancelled`, `incomplete`), accepted outcome,
retries, elapsed milliseconds, all failure IDs/count, and digest-bound result,
acceptance, effective-settings and accounting evidence with original observation times. Completed
outcomes require matching ACCEPT/REJECT evidence. Failed/cancelled trials stay
in the population; never discard them to improve an average. Unknown retry,
elapsed or acceptance fields are null and leave coverage partial.

List every expected agent ID and each observed agent's role and counters.
Missing agents and unknown roles keep coverage partial. Preserve **all** keys:
`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`,
`reasoningTokens`, `visibleResponseBytes`, `wrapperEnvelopeBytes`,
`contextOccupancyTokens`, `costUsd`, `accountQuotaTokens`. Use null with partial/
unknown coverage and a reason for unobserved values. Zero is an observation.
Counter/agent records cover the entire trial including retries and supervision.
Reference L1 accounting artifacts for cumulative/delta/reset/coverage semantics;
the validator is not another usage aggregator. Reasoning/cache counters are
subsets, not additive output/input costs; occupancy is distinct from cumulative
usage. Do not convert bytes or tokens into quota. Non-null account quota requires
direct-provider evidence, never an estimate. No prompts or transcripts belong
in this manifest or repository.

An agent record is `{id, role, coverage, unknownReason, counters, quotaEvidence}`;
the accounting evidence owns source identities and metric observation coverage.
Evidence objects retain `{reference, sha256, observedAt}`, with `decision` on
acceptance evidence and `source: "direct-provider-observation"` on quota evidence.
Live data requires an authorization evidence reference, but a reference alone
does not grant permission or prove provenance. Reject template placeholders in
non-template data; trusted execution remains outside this validator.

The bounded validation result reports expected/recorded/accepted/failed/missing
trials and coverage only. It always leaves live quality and savings unverified.
An authorized independent comparison must later inspect artifacts, all-agent
costs, accepted outcomes, retries and elapsed distributions before making any
quality or cost conclusion. The live runner and controlled experiments remain
separate work; local deterministic checks establish contract support only.
