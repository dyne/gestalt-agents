# Org-plan startup diagnostics

`never` prohibits approval prompts; it does not grant MCP approval. Read-only
queries can succeed while a write-capable lifecycle call is rejected.
Do not switch to CLI calls to evade a denied MCP operation or change permissions
without authorization.

Setup checks effective Codex approval configuration against the installed
plugin manifest before reporting success. A launcher can repeat this read-only
check outside the agent sandbox before starting supervision:

```sh
node "$SKILL_DIR/../../scripts/check-org-plan-startup.mjs" --approval-policy never
```

`SKILL_DIR` is the loaded Org-plan skill directory. Supply the intended root
session policy: `never`, `on-request`, or `untrusted`. The checker reads the
current workspace's effective configuration, starts no turn, publishes no
signal, changes no permissions, and outputs only diagnostic codes.

Resolve `ORG_PLAN_APPROVAL_CONFLICT` by reviewing the server's approval mode
and explicit per-tool overrides. `ORG_PLAN_TOOL_DISABLED`,
`ORG_PLAN_SERVER_DISABLED`, and `ORG_PLAN_SERVER_SHADOWED` identify availability
or identity conflicts. `ORG_PLAN_STATUS_NOT_FORWARDED` means typed lifecycle
calls cannot publish to the configured Mobile session destination.

Run this host diagnostic outside the agent sandbox: a nested Codex process may
need runtime-file access unavailable to the root. A host supplying thread-level
MCP overrides must check those overrides too; this checker does not certify an
already-running thread's snapshot. A genuine unresolved authority requirement
uses the existing bounded permission-attention protocol.
