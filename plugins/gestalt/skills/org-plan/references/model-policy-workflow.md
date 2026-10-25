# Model policy through handoff and recovery

Read for versioned policy authoring, assignments, follow-ups, recovery and
review. Before dispatch also read the [launch contract](executor-launch.md) and
[effective-settings gate](effective-settings.md). These conditional references
add v1 policy instructions; legacy common-path byte totals do not measure their
loaded cost. They never change installed setup or an unrelated/source session.

## Authoring and packet

This workflow applies to versioned L1 model choices. Existing v1 plans without
an assurance keyword use disclosed `configured` compatibility: validate launch
settings, catalog support, permission inheritance and controller-owned executor
identity. Missing runtime receipts do not block ordinary supervision. Requested
settings remain requests; observed configured settings retain their source and
unknown fields. This is cooperative supervision, not native child pre-spawn
enforcement. Mobile's host guards reject observed mismatches on automatic resume.

An explicit `MODEL_POLICY_ASSURANCE: runtime-attested` remains strict and fails
clearly when the adapter lacks receipts/revisions. Do not silently downgrade it.
The Codex 0.164.0 adapter can request launch overrides and read configured thread
metadata, but has no runtime-issued settings revision/receipt contract.
`runtimeEnforcement` remains false. Repeated attention resolution or authorization
cannot supply a missing capability. Preserve manual Off.

Before handoff, each versioned L1 explicitly chooses its lightest adequate validated
model and `medium` reasoning. Follow the [rubric](model-selection.md) and
[schema](model-policy-schema.md), recording all five scores/explanations in its
rationale. Simple mechanical tasks may select `gpt-6-luna`; bounded work may use
`gpt-6-sol`, and multi-component work may use `gpt-6.1-sol`. No Astra or aliases.
Validate exact IDs and effort support against the authoritative runtime catalog.
For existing-policy execution, use the pre-child `executorLaunch` health result
as described in the rubric. Missing child `modelPolicy.catalogRevision` does not
block configured selection, and a server-issued catalog revision is not required.
Authoring a plan never authorizes execution.

Keep one policy packet with the assignment and continuity evidence:

```text
Policy: {version}; L1 {position}/{id}; {exact model}/{explicit effort}.
Rationale: {complete scores/explanations and selection rationale}.
Fallbacks: {exact ordered IDs or none}; trigger: {concrete escalation evidence}.
Necessity: {kind, why medium is inadequate, evidence, affected scope,
            return-to-medium condition; xhigh also scope reassessment}, or none.
Source: {current authoritative plan/section and complete policy reference/digest}.
Assurance: {configured or runtime-attested; explicit declaration or v1 migration}.
Admission: {validated launch recipe, controller child binding/epoch, observed
            settings/catalog/time and evidence reference; strict receipt only
            when runtime-attested}, preserving every unavailable field as unknown.
```

Use exact full values, not inferred Effort prose or model-tier defaults. When
values exceed the routine report budget, use an authorized complete packet
reference with digest/size and require the recipient to read it before edits.
A bounded describe excerpt is navigation, not the full rationale or exception.
The execution-policy digest binds settings/necessity; it does not replace a
complete packet/reference for rationale, fallback or trigger. Full assignments
still include all existing scope, optional skills, startup, authority and gates.

## Continuation decisions

Read the current policy and packet once per relevant change/recovery. Preserve
exact choices and rationale on follow-up; omit no higher-effort exception.
Current Org/host evidence outranks retained assertions. Do not infer settings
from the supervisor, an old assignment, rejected review or retry count.

| Event | Required action |
| --- | --- |
| Compaction or resume | Resume the same executor; read the full current policy and its packet, compare choices/rationale, refresh the assurance check for the current child/epoch before edits. Configured mode revalidates launch settings and controller ownership; strict mode refreshes the effective handshake. Keep missing evidence unknown. |
| REJECT | Return unchanged findings to the same writer and same uncommitted diff; retain policy/necessity, repair and rerun gates. A rejection or retry alone never raises effort. |
| Dependency reopen | Use `suspend-reopen`/`resume`; preserve each L1 policy and rationale, one writer and dependency review gates. Refresh admission for resumed scope; never overwrite a dependency's choice with its consumer's. |
| User policy change | Hold affected dispatch; apply the user's authorized change through existing plan/lifecycle rules, validate policy/catalog and update the complete packet. Preserve writer/replacement authority and refresh evidence under the selected assurance mode. Never rewrite profiles or silently substitute settings. |

Lifecycle-only changes do not change selected model/effort. A stale or incomplete
packet requires bounded retrieval and current verification, not reconstruction
of a conversation. A genuinely observed mismatch blocks further edits until
safely resolved. In configured mode, missing runtime fields stay unknown and do
not create another approval prerequisite; strict mode still requires its full
receipt. Material replanning still follows existing authority;
no automatic agent replacement, task split or new progress approval is added.

## Effort decisions

Medium is preferred across all model tiers, including Luna. Stronger models,
difficult milestones, concurrency/protocol risk, elapsed time, rejected reviews
and retries alone never justify high. A higher-effort exception needs a concrete
unresolved correctness issue after focused investigation, or a specific
reasoning requirement that medium cannot adequately address. Retain evidence,
affected scope, why medium is inadequate and an observable return-to-medium
condition; reassess scope before xhigh. Max/ultra are outside policy.

Escalate only affected work, preserving one writer, allowed model ceiling,
permissions and current catalog/effective checks. Return to medium once the
recorded condition is met; update the packet and recheck actual settings.
Selection remains a quality hypothesis. All required tests, independent review,
full L1 gates and failure evidence remain mandatory.
Prepare opt-in [comparisons](model-comparison.md) separately; never spend live
model quota without explicit authorization.

## Supervisor and terminal reviewer

Supervisor settings are independent of each child's policy. A supervisor model,
effort or change cannot establish child effective settings or revise an L1.
Root review checks the exact current packet, assurance and requested/observed
evidence. Unsupported necessity or observed mismatches require correction.
Unknown settings do not imply attestation or prevent configured-mode review.

After all L1s are REVIEWED and no writer remains, launch `final_review` with
`agent_type=default`, `fork_turns=none`, explicit `model=gpt-6.1-sol` and
`reasoning_effort=medium`. Never inherit Astra, even from an Astra supervisor.
Validate availability/effort and the reviewer's explicit launch recipe before
review. Apply the plan's assurance: strict requires effective evidence; configured
retains unknown observations without blocking. Keep terminal identity distinct
from L1 executor bindings. No supported non-Astra launch means a preflight
limitation, never silent inheritance or a live profile rewrite. Any authorized
effort exception still requires concrete necessity and a return condition.
Preserve terminal duties, permissions, sole-writer P0/P1 correction authority,
independent acceptance and final gates from the supervision reference.
