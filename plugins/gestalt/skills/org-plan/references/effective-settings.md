# Requested/effective executor handshake

Before a versioned L1 executor edits code, its trusted host adapter must call
`requireExecutorSettings` from `../scripts/org-plan-effective-settings.mjs` (or
enforce the same contract). A passing launch recipe is only a request. An
unavailable source or field remains unknown and blocks admission; never copy
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
