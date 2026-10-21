# L1 model policy schema v1

New plans explicitly declare `#+MODEL_POLICY_VERSION: 1` once in document
metadata before the first heading. Unknown versions, duplicate declarations,
misplaced declarations and policy fields without a version fail validation.
Legacy plans without the declaration or policy properties retain their existing
behavior and bytes; helpers do not infer settings from Effort prose, migrate
them, or insert defaults during reads or transitions.

Every v1 L1 drawer requires these properties exactly once:

| Property | Contract |
| --- | --- |
| `MODEL` | Exact `gpt-6-luna`, `gpt-6-sol` or `gpt-6.1-sol`; no aliases or Astra |
| `REASONING_EFFORT` | Explicit `medium` (authoring default), `high` or `xhigh` |
| `MODEL_RATIONALE` | Concrete selection rationale, including task scores/explanations from the rubric |
| `MODEL_FALLBACKS` | `none`, or ordered distinct policy IDs separated by single spaces; exclude selected model |
| `MODEL_ESCALATION_TRIGGER` | Observable evidence prompting reassessment; never automatic upgrade authority |

Each policy property value must contain 1–1024 UTF-8 bytes. L2 overrides are
prohibited. The document version is not an L1/L2 property. Existing Effort prose
remains required for compatibility; consumers use the explicit properties as
the machine contract, not inferred prose settings. Do not hand-edit lifecycle
or measurement fields while authoring model metadata.

High and xhigh additionally require `EFFORT_NECESSITY_KIND`
(`unresolved-correctness` or `specific-reasoning`), `EFFORT_NECESSITY` (why medium
is inadequate for this task), `EFFORT_EVIDENCE`, `EFFORT_SCOPE`, and
`RETURN_TO_MEDIUM`. Xhigh also requires `SCOPE_REASSESSMENT`. Medium carries no
higher-effort exception properties. Complexity, risk, protocol work, model tier,
review rejection or retries alone do not justify higher effort; review the
evidence, not merely field presence. See [selection rubric](model-selection.md).

Describe/next expose a bounded policy summary with exact model, effort, version,
fallback IDs, exception flag, and UTF-8-safe excerpts of rationale (160 bytes)
and escalation trigger (128 bytes). Full validated values remain in the
fingerprinted L1 drawer and observable transition properties. Abbreviated
summaries are not full evidence. Schema validation does not establish runtime
model availability, supported effort or effective launch settings.

An attached consumer must assert `l1-model-policy-v1` through the existing
trusted capability channel before versioned mutations or publication. This is
independent of `suspension-v1`/`nested-suspension-v1`; all applicable capabilities
are required. The assertion promises parser/retention support only, not launch
enforcement. Do not advertise runtime enforcement until its separate checks are
wired. Explicit embedded capability arrays replace ambient assertions; no
capability is accepted as an MCP tool argument. Publication retains status
schema version 1 and adds `modelPolicyVersion: 1` and `requiredCapabilities`.
Legacy publications retain their shape. Failed negotiation writes neither plan
nor status; invalid schema fails before any transition write. Offline operations
without a destination remain supported and never authorize incompatible live
consumption. Keep the already-running source session and installed setup intact.
