# L1 model selection rubric

Use while authoring each L1, before handoff. A selection is a hypothesis about
the lightest adequate model, validated by accepted outcomes and tests; model
names or lower response bytes alone do not establish savings. This rubric does
not change an installed profile or prove effective launch settings.

## Score the task

Record a score and task-specific explanation for each axis. Higher scores mean
more reasoning burden; test strength is scored as weakness.

| Axis | 0 | 1 | 2 |
| --- | --- | --- | --- |
| ambiguity | Exact requirements and known approach | Local investigation required | Competing interpretations or unresolved design |
| scope | Mechanical or trivial local edit | Bounded implementation in one component | Multiple interacting components |
| coupling | Independent change | One known interface | Coupled producers/consumers or protocols |
| correctnessRisk | Easily reversible, limited impact | Meaningful behavioral regression possible | Critical invariant or costly failure |
| testWeakness | Direct, deterministic acceptance checks | Some integration/manual evidence needed | Weak oracle or substantial untested behavior |

Start with `gpt-6-luna` for all-zero scores, including simple mechanical executor
tasks. Start with `gpt-6-sol` for bounded work with a total at most five, unless
scope or coupling is two. Use `gpt-6.1-sol` for the remaining multi-component or
reasoning-heavy cases. A narrow high-risk task can still use Sol with medium;
concurrency/protocol work does not automatically require high effort. Reduce
ambiguity or improve tests when practical before paying for a larger model.

## Validate the selection

For every L1 retain: scores/explanations, exact model and effort, concrete
rationale, ordered allowed fallback IDs (or explicitly none), and an observable
escalation trigger. Prefer `medium` on **every** tier. The only model IDs in this
policy are `gpt-6-luna`, `gpt-6-sol`, and `gpt-6.1-sol`; never Astra or API aliases.
User constraints may narrow this pool but cannot widen it. A conflicting ceiling
requires an actionable preflight failure, not a silent downgrade.

Validate availability and effort support against the actual runtime catalog's
exact IDs, supported efforts and revision. The pure contract in
`../scripts/org-plan-model-policy.mjs` consumes a normalized snapshot
`{source: "runtime", revision, models: [{id, reasoningEfforts}]}`. The caller
must obtain that snapshot from authoritative runtime metadata and retain its
provenance; a fixture, guessed list, tool-schema suggestion or profile default
is not live availability evidence. Missing catalog/revision stays unknown and
blocks selection. No model probe turns or live setup mutations are needed.

When the preferred model is unavailable, only an explicitly allowed, available
fallback at least as capable under this rubric may be used, with a recorded
reason. All fallback IDs must satisfy the user's ceiling; an unavailable unused
fallback remains unavailable, never a promise. If the runtime lacks the
requested effort, stop rather than silently raising effort. A task legitimately
rescored after investigation requires a new rationale and validation.

## Effort exceptions

Use `high` only for an unresolved correctness issue after focused investigation,
or a specific reasoning requirement that medium cannot adequately address.
Record the kind (`unresolved-correctness` or `specific-reasoning`), why medium is
inadequate for this task, evidence of that need, affected scope, and an observable
return-to-medium condition. For `xhigh`, also document a scope reassessment.
`max` and `ultra` are outside this policy. Complexity labels, concurrency,
elapsed time, model tier, retries or rejected reviews alone are insufficient.
Never infer necessity merely from a nonempty rationale: review the evidence.

Example: a focused trace exposes two plausible orderings that violate an
ownership invariant and medium investigation has not resolved the proof. High
may cover that invariant analysis; return to medium once the ordering is proven
and a deterministic regression test captures it. Preserve one writer and the
allowed model ceiling. Escalation triggers identify evidence to reassess, not
permission to auto-upgrade or to bypass verification.
