# L1 model policy schema v1

Plans with explicit L1 model choices declare `#+MODEL_POLICY_VERSION: 1` once in document
metadata before the first heading. Unknown versions, duplicate declarations,
misplaced declarations and policy fields without a version fail validation.
Legacy plans without the declaration or policy properties retain their existing
behavior and bytes; this is also the supported default for new ordinary plans.
Helpers do not infer settings from Effort prose, migrate
them, or insert defaults during reads or transitions.

Assurance is separate from requested settings. The optional document keyword
`#+MODEL_POLICY_ASSURANCE: configured` selects launch-validated compatibility.
Existing version-1 plans without that keyword use configured assurance without
rewriting their bytes or removing policy fields. Mobile discloses this migration
in admission/health. It does not attest runtime settings. An explicit
`#+MODEL_POLICY_ASSURANCE: runtime-attested` requires the strict receipt contract
and remains blocked on adapters without it. Never downgrade that explicit mode
without user authorization. Unknown, duplicate, misplaced or unversioned assurance
declarations fail validation. Assurance is never an L1/L2 drawer property.

Every v1 L1 drawer requires these properties exactly once:

| Property | Contract |
| --- | --- |
| `MODEL` | Supervisor-selected exact runtime model ID; bounded to 64 identifier characters, including provider namespaces |
| `REASONING_EFFORT` | Supervisor-selected effort supported by that model's runtime catalog; bounded to 24 lowercase identifier characters |
| `MODEL_RATIONALE` | Concrete supervisor selection rationale; rubric scores are advisory |
| `MODEL_FALLBACKS` | `none`, or ordered distinct policy IDs separated by single spaces; exclude selected model |
| `MODEL_ESCALATION_TRIGGER` | Observable evidence prompting reassessment; never automatic upgrade authority |

Each policy property value must contain 1–1024 UTF-8 bytes. L2 overrides are
prohibited. The document version is not an L1/L2 property. Existing Effort prose
remains required for compatibility; consumers use the explicit properties as
the machine contract, not inferred prose settings. Do not hand-edit lifecycle
or measurement fields while authoring model metadata.

An optional detailed effort rationale uses `EFFORT_NECESSITY_KIND`
(`unresolved-correctness` or `specific-reasoning`), `EFFORT_NECESSITY` (why medium
is inadequate for this task), `EFFORT_EVIDENCE`, `EFFORT_SCOPE`, and
`RETURN_TO_MEDIUM`. If supplied for xhigh, also provide `SCOPE_REASSESSMENT`.
Partial packets are rejected; medium still carries no higher-effort exception
properties. A supervisor's high/other effort choice needs no exception packet.
Model/effort syntax validation is not runtime availability validation: dispatch
still requires the exact catalog entry and supported effort. See the advisory
[selection rubric](model-selection.md).

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
