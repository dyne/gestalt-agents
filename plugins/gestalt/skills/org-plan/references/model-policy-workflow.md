# Model policy through handoff and recovery

Read for versioned policy authoring, assignments, follow-ups, recovery and
review. Before dispatch also read the [launch contract](executor-launch.md) and
[effective-settings gate](effective-settings.md). These conditional references
add v1 policy instructions; legacy common-path byte totals do not measure their
loaded cost. They never change installed setup or an unrelated/source session.

## Authoring and packet

This workflow applies only to an explicitly requested strict model policy.
Use the [ordinary plan format](plan-format.md) otherwise. Parser/retention
capability alone does not establish runtime enforcement. Check the trusted
host's runtime support during authoring; unavailable support means a draft,
not a supervision-ready handoff. Preserve existing strict policies on recovery.
Agents 2.19.0 and Mobile 0.55.0 advertise `runtimeEnforcement: false`; Codex
0.161.0 configured thread settings do not supply the required runtime revision.
Explain this limitation during authoring when strict policy is explicitly
requested. Never remove an existing policy without user authorization.

Before handoff, each versioned L1 explicitly chooses its lightest adequate validated
model and `medium` reasoning. Follow the [rubric](model-selection.md) and
[schema](model-policy-schema.md), recording all five scores/explanations in its
rationale. Simple mechanical tasks may select `gpt-6-luna`; bounded work may use
`gpt-6-sol`, and multi-component work may use `gpt-6.1-sol`. No Astra or aliases.
Validate exact IDs and effort support against the authoritative runtime catalog.
Authoring a plan never authorizes execution.

Keep one policy packet with the assignment and continuity evidence:

```text
Policy: {version}; L1 {position}/{id}; {exact model}/{explicit effort}.
Rationale: {complete scores/explanations and selection rationale}.
Fallbacks: {exact ordered IDs or none}; trigger: {concrete escalation evidence}.
Necessity: {kind, why medium is inadequate, evidence, affected scope,
            return-to-medium condition; xhigh also scope reassessment}, or none.
Source: {current authoritative plan/section and complete policy reference/digest}.
Admission: {requested/effective receipt, child binding/epoch, catalog revision,
            original observation time and evidence reference}, or unknown.
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
| Compaction or resume | Resume the same executor; read the full current policy and its packet, compare choices/rationale, refresh the effective handshake for the current child/epoch before edits. Keep missing evidence unknown. |
| REJECT | Return unchanged findings to the same writer and same uncommitted diff; retain policy/necessity, repair and rerun gates. A rejection or retry alone never raises effort. |
| Dependency reopen | Use `suspend-reopen`/`resume`; preserve each L1 policy and rationale, one writer and dependency review gates. Refresh admission for resumed scope; never overwrite a dependency's choice with its consumer's. |
| User policy change | Hold affected dispatch; apply the user's authorized change through existing plan/lifecycle rules, validate policy/catalog and update the complete packet. Preserve writer/replacement authority and refresh effective evidence. Never rewrite profiles or silently substitute settings. |

Lifecycle-only changes do not change selected model/effort. A stale or incomplete
packet requires bounded retrieval and current verification, not reconstruction
of a conversation. A changed or unknown effective setting blocks further edits
until safely resolved. Material replanning still follows existing authority;
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
Root review checks the exact current packet and requested/effective evidence;
unverified settings or unsupported necessity require correction, not acceptance.

After all L1s are REVIEWED and no writer remains, launch `final_review` with
`agent_type=default`, `fork_turns=none`, explicit `model=gpt-6.1-sol` and
`reasoning_effort=medium`. Never inherit Astra, even from an Astra supervisor.
Validate availability/effort and authoritative effective reviewer settings
before review; unknown evidence blocks dispatch. Keep terminal identity distinct
from L1 executor bindings. No supported non-Astra launch means a preflight
limitation, never silent inheritance or a live profile rewrite. Any authorized
effort exception still requires concrete necessity and a return condition.
Preserve terminal duties, permissions, sole-writer P0/P1 correction authority,
independent acceptance and final gates from the supervision reference.
