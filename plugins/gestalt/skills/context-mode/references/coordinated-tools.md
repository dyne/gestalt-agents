# Coordinated source discovery and verification

Use this adoption guide with the runtime's exposed tools and schemas. Package
installation, an enabled skill, and an MCP handshake are different observations;
none alone proves that the intended repository has usable semantic references.
The tool skills remain authoritative for their operations and permissions.

## Route by intent

| Task | Route | Evidence required before relying on it |
| --- | --- | --- |
| Broad or repeated source discovery in one or several repositories | Lexical XERJ when its service and index cover the requested scope | Identify the source repositories, aliases and freshness; verify relevant hits in current files. |
| Exact known file, governing instructions, current source verification, Git or edits | Native tools | Read the authorized current path; account for dirty tracked and untracked files. |
| Local definitions, callers or structured semantic edits | Managed Serena when the needed operations work | Check the effective repository/build, a bounded overview, and a known definition/caller relationship. |
| Large or uncertain logs, tests, API results or several inspections | Context-mode analysis of saved evidence | Preserve the original, exact command/exit/counts, provenance and every failure locator. |
| One saved artifact question | File execution | Return bounded derived findings and retrievable references. |
| Repeated artifact questions or reviewer handoff | A scoped index or authorized manifest transfer | Reauthorize the original and verify its identity before reuse; receivers resolve their own tools and indexes. |

These are intent boundaries, not call quotas. For detailed provenance and native
fallback decisions see [XERJ](../../xerj/SKILL.md); for local semantic checks,
oversized-overview recovery and compilation inputs see
[Serena](../../serena/SKILL.md). Empty, stale, partial or unavailable indexes
justify a precise native fallback. A shared-content hit retains all aliases;
an alias from another checkout does not establish current local behavior.

## Interpret readiness per repository and operation

Connection readiness says that a runtime connected. Symbol readiness says that
an extraction operation succeeded. Reference readiness additionally needs usable
cross-file relationships in the intended repository. A successful overview can
coexist with broken references, unsupported languages or missing build inputs.
Narrow an oversized overview or choose a justified larger bound before treating
response sizing as a language failure. Check current source and configuration
before considering useful, authorized cache warmup.

In Mobile, **Unverified** covers unknown or unobserved readiness, **Stale** means
an observation was invalidated, and **Degraded** means unavailable. Repository,
build, runtime/generation and original observation time matter. Do not promote
connection readiness into symbol/reference coverage, or treat XERJ and Serena
as having the same coverage. Readiness never grants write authority.

## Diagnose safely

1. Resolve the intended repository/build and inspect the current status or
   startup observation. Preserve the runtime, attempt, physical thread and tool
   identities when supplied; unavailable child exit/signal details remain null.
2. Inspect read-only operator diagnostics: `gestalt xerj status`,
   `gestalt serena doctor --cwd /absolute/workspace`, or the exposed `ctx-doctor`
   capability. See the managed [XERJ commands](../../xerj/references/commands.md)
   and [Serena commands](../../serena/references/commands.md) for exact arguments.
3. Optional XERJ/Serena failure permits native work with the relevant coverage
   limitation. A configured required context-mode startup failure stops the
   affected startup; do not disguise it as optional or fabricate readiness.
   Saved-output fallback during an existing session follows the
   [routing contract](../SKILL.md#routing-contract) and its startup constraints.
4. Recheck only after relevant source, configuration, runtime or availability
   changes. Keep the original failure identity and observation time. Diagnosis
   does not authorize an installation, restart, project switch, index mutation
   or permission change. Mobile owns XERJ indexing; Serena warmup follows its
   existing useful-work and workspace-write conditions.

## Reuse evidence without refreshing its claims

The [bounded retrieval reference](bounded-retrieval.md) is the source of truth
for response fields, continuation, artifact reuse and fresh receivers. Retain
complete originals outside routine messages. Consume the authorized failure
pages needed for a claim, including each ID, cause and locator; an analysis tool
returning successfully cannot make the underlying tests pass.

Match repository, full candidate identity, source digest, exact command and
execution inputs before reusing results. HEAD alone misses dirty tracked and
untracked changes. A changed candidate invalidates an old passing result even
when the log bytes are unchanged. A missing or denied report stays unsupported;
remote freshness and another session's authorization must be checked separately.

## Interpret costs and older payloads

Mobile reports observed, correlated tool calls with explicit coverage. Missing
values remain unknown, measured zero remains zero, and partial observations do
not describe the entire session. Wrapper and inner-tool costs overlap; do not
add them into a session total. Provider usage snapshots do not establish
per-tool token charges or savings. The owning
[Mobile metric contract](https://github.com/dyne/gestalt-mobile/blob/ea8ad34ac93930d39fb8230cb262625fe48b47eb/docs/tool-efficiency-facts.md)
defines units, retention and correlation limits.

The additions are optional to older payload consumers: absent readiness,
startup diagnostics or efficiency snapshots leave existing activity usable.
New consumers show unknown/Unverified or omit unavailable details when reading
older events; they do not manufacture readiness, child exit codes or zero cost.
Resolve the live schema before sending newer arguments. Missing optional fields
are not evidence that an operation failed, succeeded or cost nothing.

## Reproduce the offline checks

With the repository's existing dependencies, run from `plugins/context-mode`:

```sh
npm run test:overhead -- --evidence-dir /absolute/isolated/evidence-directory
```

This Node entry point runs the existing envelope budgets, nine composed routing
scenarios, and seven controlled evidence cases repeated three times. Each pair
uses identical source/test facts and checks exact findings and locators. Reports
retain per-case improvements and regressions, discovery/schema delivery,
request/response envelopes, call/retry counts, completeness and descriptive local
elapsed time. A shorter answer that drops a required failure fails correctness.
Tiny evidence can cost more, and coordinated paths can require more calls.

The baseline read-file schema and providers are synthetic; evidence adapters,
schema serialization, bounded retrieval and indexing execute locally. Reports
disclose excluded transport framing and unobserved provider usage. Fixture data
and databases are removed after checks. These tests do not prove real-model
adherence, live tool readiness, production latency or a guaranteed saving, and
require no external corpus, service, credentials or model download.
