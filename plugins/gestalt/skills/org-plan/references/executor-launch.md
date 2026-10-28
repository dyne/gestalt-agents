# Executor duties and model configuration

Use before launching a versioned L1. Executor duties belong to its assignment
and canonical supervision reference; a fixed model pin is a separate runtime
setting. Recommended source setup defaults are `gpt-6.1-sol` / `medium` for
both roles. Existing installed profiles and running sessions keep their settings.
The supervisor's explicit L1 model/effort takes precedence over those defaults.

## Supported default-agent recipe

When the actual spawn tool declares explicit model and reasoning-effort
overrides for `agent_type: default` with `fork_turns: none`, use that arrangement
for the L1's validated choices. Preserve canonical `task_name: l<a>`, sole-writer
ownership for the complete L1, required standalone first skill read, subsequent
supervision/AGENTS reads, exact optional skills, evidence/review/commit gates,
and the complete standalone assignment. Supply the executor bootstrap duties
as ordinary assignment text; selecting `default` alone does not confer them.

The pure `../scripts/org-plan-executor-launch.mjs` recipe takes the parsed policy,
one-based position, host tool-schema revision, permission context, executor
bootstrap and complete assignment. Pass `assurance: plan.modelPolicyAssurance`
from the validated parser result explicitly; absent v1 metadata resolves to
`configured`. Never rely on the helper default when the plan declares
`runtime-attested`. A strict recipe still requires the strict handshake before
edits. It emits this **request**, never a launch:

```json
{
  "agent_type": "default",
  "task_name": "l1",
  "fork_turns": "none",
  "model": "gpt-6-luna",
  "reasoning_effort": "medium",
  "message": "Executor bootstrap duties, then complete standalone L1 assignment"
}
```

After spawn, keep the writer in read-only bootstrap until the root verifies
its current canonical position and physical thread through health. This is an
automatic ownership handshake, not a new human approval. If the controller still
shows a completed predecessor, use the supervision reference's handoff recovery
and preserve this same new writer. An ordinary interrupt preserves resumability;
only actual closure makes its assignment terminal.

Use the selected model/effort and actual canonical position, not these example
values. Obtain the bootstrap from a verified executor role's
`developer_instructions` or the equivalent already-loaded executor contract.
Do not run profile setup to obtain it during supervision. The caller verifies
bootstrap provenance and supplies the canonical skill/reference/plan paths.

The normalized host descriptor is
`{source: "host-tool-schema", revision, forkTurnsNone: true, defaultAgent:
{modelOverride, reasoningEffortOverride, inheritsSandbox, inheritsApprovalPolicy},
executorRole: {agentType, fixed, model, reasoningEffort, inheritsSandbox,
inheritsApprovalPolicy}}`. Populate it from actual host declarations; fixtures
are not live support evidence. Unknown override or permission inheritance
support blocks this recipe. No new agent/profile/config file is created.

## Fixed roles and permissions

The recipe defaults to `auto`: prefer the supported default-agent override
route, and consider the fixed `org-plan-executor` role only as a last fallback
with pins exactly matching the chosen L1 settings. If a requested fixed role
conflicts but default-agent overrides are supported, select the default route.
Never pass an ineffective override to a fixed role, silently substitute its
defaults, or rewrite a global profile for each L1. If no route can honor the
explicit choice, report that concrete capability limitation.

Keep the parent's actual sandbox, approval policy and writable roots. The
recipe emits no permission overrides. It requires known inheritance, a writable
`workspace-write` executor context and an executor bootstrap without conflicting
permission pins. A read-only parent/role or unknown permission context is a
preflight limitation, never permission to broaden access. Host restrictions,
including writable roots and denied escalation, remain authoritative. Passing
this structural recipe establishes configured launch validation only. Under
explicit runtime-attested assurance, verify effective settings before edits
under the [runtime handshake](effective-settings.md). Do not infer them from a
profile, request, root model or successful fixture.

## Setup is separate

`prepare-executor --model MODEL --reasoning-effort EFFORT` and
`prepare-supervision --executor-model MODEL --reviewer-model MODEL
--executor-reasoning-effort EFFORT --reviewer-reasoning-effort EFFORT` pin explicit
choices during authorized setup only; both effort defaults are medium. High or
xhigh flags configure a pin, not a task-specific necessity rationale or launch
authorization. Versioned L1 validation requires the supervisor's exact choice,
rationale and runtime catalog support; higher effort is not a separate approval
gate. Configured mode applies the current choice at the next safe executor turn
and keeps requested and observed settings separate; strict mode additionally
requires effective match.
Keep transaction rollback, file modes and reviewer read-only sandbox unchanged.
Never run setup or mutate installed profiles/runtime as a per-L1 workaround.
