# Executor assurance and requested/effective handshake

Select assurance from the validated document, separately from model/effort.
Version-1 plans without `MODEL_POLICY_ASSURANCE` use `configured` compatibility;
an explicit `runtime-attested` plan stays strict. Disclose compatibility once
at activation. Never remove policy fields or fabricate a receipt to activate.

## Configured compatibility

Before edits, validate the current L1's exact model/effort against the runtime
catalog and use the [supported launch recipe](executor-launch.md). Verify host
override support and inherited sandbox/approval policy. Retain canonical L1,
physical child thread/task identity and authorized replacement generation in
controller state. No attested child is required before launching that child.

For prelaunch catalog validation, read `gestalt_org_plan_health.executorLaunch`.
`validated:true` / `CATALOG_MATCH` reports exact model/effort support from the
owning runtime's `model/list`, with a normalized-content fingerprint and observation
time. It needs no child or server-issued catalog revision. The separate
`modelPolicy.catalogRevision:null` and `CHILD_NOT_LAUNCHED` describe child evidence,
not catalog availability. Never turn those expected pre-child unknowns into a
selection blocker or repeated attention request. A genuinely unavailable or
incompatible catalog remains a capability failure; do not manufacture a match.

A stale controller projection is separate from missing runtime attestation.
Use the [handoff recovery procedure](supervised-execution.md#controller-handoff-and-recovery)
to reconcile the existing physical writer before treating it as a capability
blocker. `executorBinding.authorizesExecution:false` means the observation does
not itself authorize a resume; it is not an admission denial.

On continuation, re-read the current policy and controller-owned child binding.
Reject stale/replaced bindings, changed authority and role mismatches. When the
supervisor deliberately changes its L1 model/effort, validate catalog support
and apply those settings to the same writer's next safe turn; old observed
settings do not veto the new choice. Do not edit under stale settings while a
change is pending or reuse a previous match as lasting authority. Mobile
rechecks automatic resume authority immediately before dispatch, including
Manual Off, replacement, plan changes and pending interaction fences.

Requested values never populate observed effective values. Missing runtime
metadata, receipt or settings revision remains unknown; it is not a reason for
repeated attention or approval. Health's `admitted:false` and `attested:false`
describe the strict receipt result; `executionAdmission.allowed` describes
controller admission in configured mode. `runtimeEnforcement:false` remains
truthful. Native collaboration spawn/followup calls are root-supervised, not
intercepted by Mobile; the root must check the launch recipe, identity and any
observed mismatch before those calls. This mode does not guarantee that every
runtime honored every request. Independent review, evidence gates, checkpoints
and terminal whole-branch review remain mandatory.

## Explicit runtime-attested mode

Before a strict L1 executor edits code, its trusted host adapter must call
`requireExecutorSettings` from `../scripts/org-plan-effective-settings.mjs` (or
enforce the same contract). A passing launch recipe is only a request. An
unavailable source or field remains unknown and blocks strict admission; never copy
the requested/root/profile setting into an effective field. No model-probe
turn, prompt export, setup write or permission change is required or authorized.

## Inputs and trust boundary

- `policy`: current validated L1 policy from the Org parser; exact version,
  model, reasoning effort and any documented necessity.
- `binding`: controller-owned `l1Id`, one-based `position`, exact child `threadId`,
  `executionEpoch` and current `settingsRevision`. The host creates a new opaque
  epoch for each launch/resume and binds it to the current canonical executor.
  Replacement authorization remains the supervision reference's responsibility.
- `catalog`: current authoritative `{source: "runtime", revision, models:
  [{id, reasoningEfforts}]}`. A tool-schema model suggestion is not a catalog.
- `runtime`: normalized child receipt with `source: "runtime-thread-metadata"`,
  `l1Id`, `position`, `threadId`, `executionEpoch`, `settingsRevision`,
  `policyDigest`, `model`, `reasoningEffort`, `catalogRevision` and `observedAt`.
  `executionPolicyDigest(policy)` binds exact execution settings and necessity.

The adapter obtains actual model/effort/settings revision from authoritative
child runtime metadata and binds the observation to controller-owned identity
and epoch. Catalog revision records the catalog against which that observation
was checked. Source labels in a plain object do **not** authenticate evidence:
only a trusted adapter may construct these inputs. Keep them out of model-owned
MCP arguments. Profile TOML, spawn requests, parent settings, catalog presence
and an executor's own assertion cannot establish effective child settings.
Missing runtime support stays unknown; do not invent a settings revision or
claim live integration from fixtures. Live Mobile binding/admission is separate
work, and no runtime enforcement capability is advertised by this pure module.

## Gate and bounded result

The handshake retains L1 identity, policy version/digest, requested/effective
model and effort, child binding, catalog revisions, original observation time,
unknown fields, a decision code and one action. Diagnostics contain no prompts,
assignments or full catalog. Bounded identity values include JSON escaping;
oversized/malformed evidence becomes null rather than a raw echo. Results fit
2048 UTF-8 bytes. Preserve detailed source evidence separately when needed.

Admission requires an allowed model and documented effort, available exact
catalog ID/effort, matching child/epoch/policy/settings/catalog revision,
observed actual model/effort matching the request, and an observation timestamp.
Astra, aliases, unsupported effort and all mismatches fail before edits. Missing
effort stays null even if medium was requested. Catalog changes require
revalidation; an allowed fallback requires a new explicit selection/binding,
never an implicit effective-model substitution.

On resume, refresh child settings, catalog and controller binding; the old
epoch cannot authorize work even when thread ID/model are unchanged. A changed
settings revision invalidates a prior receipt. Lifecycle-only plan changes do
not invalidate the execution-policy digest. Timestamps alone are never a
freshness proof; matching current host revisions and epoch establish the local
binding. The host must serialize admission with dispatch and invalidate it on
relevant changes; a retained MATCH report is not an enduring authorization.
Failed checks return a bounded actionable report and must not dispatch work.
Use existing lifecycle/attention rules only after safe recovery is exhausted.

The repository's synthetic fixtures exercise this contract and a guard before
a fake edit. They do not establish live runtime provenance, supported API fields,
effective launches, model quality, quota savings or installed-host behavior.
