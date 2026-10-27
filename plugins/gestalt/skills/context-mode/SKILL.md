---
name: context-mode
description: Route large or uncertain command, file, test, log, API, documentation, browser, and MCP output through context-mode so only derived findings enter the conversation. Use for output analysis, filtering, counting, searching, indexing, or summarizing; keep edits and governing instruction reads on native tools.
---

# Context Mode

Keep large data out of the conversation while preserving complete evidence for
analysis.

## Routing contract

Use native tools for bounded filesystem work; context-mode analyzes evidence
that is large, uncertain, or needs filtering, indexing, or repeated retrieval.

1. Use an available native reader for small bounded reads and always for
   governing `AGENTS.md`, selected `SKILL.md`, plugin manifests, and a file
   before editing it. This is pre-edit inspection, not large-file analysis.
2. Use native `create_file`, `edit_file`, or `apply_patch` for writes. Use
   native `exec_command` for mutations and short, bounded command output;
   use `write_stdin` only to continue a live native command session. Use
   `view_image` to inspect a local image. Do not use shell write tricks when a
   native editor is available.
3. Do not invent aliases. Use only exposed host names, including provider
   prefixes or native equivalents. Filter names/descriptions for the task, then
   inspect exact schemas only for chosen tools. Resolve needed names/argument
   fields once per valid session within this agent/runtime generation;
   invalidate cached resolution after reconnect, tool-set change or
   unavailable-tool errors. Inspect relevant fields instead of whole catalogs.
   Fresh children resolve independently; never inherit private parent bindings.
   Unavailable schemas use supported native fallback, never guessed arguments.
   Governing reads stay mandatory and native regardless of cached bindings.
4. Use context-mode for large or uncertain evidence. If it is unavailable,
   capture evidence outside the conversation and report only the command, exit
   status, counts, and smallest useful failure excerpt.
5. Print derived findings, not raw datasets. Include exact paths, identifiers,
   line numbers, values, and exit status needed to verify the conclusion.
6. Context-mode never authorizes a mutation, deletion, install, push, network
   call, or other external side effect. Ingestion/indexing store evidence only
   within already authorized runtime scope; source edits and Org mutations
   remain native operations.

## Tool selection

For broad or repeated source discovery within one repository or across repositories,
prefer lexical XERJ with a working service and fresh index coverage of the requested
scope; follow [XERJ provenance and fallback](../xerj/SKILL.md). Keep precise
known-file lookups, governing reads, current-file verification, Git and writes
native. Use ready Serena for local symbol relationships and structured edits.
Analyze large evidence with context-mode. Use no tool-call quota or blanket grep
ban. For broad native fallback, state a relevant coverage/readiness reason
without narrating every command.

| Need | Tool |
|---|---|
| One uncertain or large command, API, test, build, or log analysis | `ctx_execute` |
| One large file analysis without loading it in full | `ctx_execute_file` |
| Several independent large inspections | `ctx_batch_execute` |
| GitHub Actions evidence or existing authorized test logs | `ctx_test_evidence` |
| Durable local corpus for later retrieval | `ctx_index` |
| Indexed follow-up or session-memory query | `ctx_search` |
| External documentation to retrieve repeatedly | `ctx_fetch_and_index` |
| Inspect context-mode health, usage, or stored data | `ctx_doctor`, `ctx_stats`, `ctx_purge` |

For shipped `ctx_test_evidence`, use `operation: "github"` with a repository,
run and attempt, or `operation: "local"` with existing file paths and observed
command exits. It uses existing `gh` authentication and returns at most 2048
UTF-8 bytes. Retrieve overflow with `operation: "followup"`, its report ID and
`nextOffset`; use returned index sources for search. Unknown formats and
incomplete evidence remain uncertain. It does not run tests or wait for CI.
Completed GitHub captures reuse verified local bytes with their original
observation time; set `github.refresh: true` to revalidate remote state.
For an authorized shared report, use `operation: "reference"` with
`manifest: {path, sha256}`; it reauthorizes source reads and indexes in the
receiving session. A report ID alone grants no cross-session access.

## Output rules

- Target **2048 UTF-8 bytes** for routine analysis/search responses, including
  serialized metadata. In execute/file code, print derived findings: counts,
  first actionable failure, exact locators and references. Never dump raw
  catalogs, logs, JSON objects, pages or snapshots.
- Use the smallest sufficient set of related queries, starting with one when
  it answers the question. Scope `source` when known; use the default search
  `limit: 3`. Add focused queries after missing or contradictory results;
  there is no fixed query quota or one-shot restriction.
- For omitted evidence, retain complete authorized overflow and retrieve the
  failures/context needed for the decision. A preview is not full failure
  coverage; unavailable overflow remains incomplete evidence.
- For wider context, name the question, source/range and byte budget; then
  return to 2048 bytes. For exact budget/continuation/source-window fields,
  read [bounded retrieval](references/bounded-retrieval.md); use only exposed fields.
- Use `ctx_index(path: ...)` for large local content. Use inline `content` only
  for small text composed in the current request.

## Files and browser output

For one large-file question use `ctx_execute_file`; for repeated questions,
index its path once and query with scoped `ctx_search`. Reuse only identity-bound
artifacts; [bounded retrieval](references/bounded-retrieval.md#artifact-reuse)
defines provenance, invalidation and missing-source recovery. Native pre-edit
reads still apply.

An empty `rg` result does not establish absence: confirm the search root, ignored
paths and symlink targets. For a huge single-line JSON artifact, parse it into
bounded structural rows before retrieval; preserve the original file for later
questions. Gestalt traces use the
[capture and summary helpers](../self-debug/references/incident-capture.md).

When a browser or another tool can save output to a file, always request a
filename and process the saved file server-side:

```text
browser or data tool -> file -> ctx_execute_file(path)
                              or ctx_index(path) -> ctx_search
```

Do not pass a large tool response back through `ctx_index(content: ...)`; that
loads the same bytes into the conversation twice. See
[Browser workflows](./references/browser-workflows.md) when using Playwright
snapshots, console messages, or network requests.

## Org Plan execution

Context-mode transports evidence; it does not spawn agents, change plan state,
grant write ownership, or replace declared task skills.

- In solo execution, use it for large or uncertain reads and command output.
- In supervised execution, the executor returns concise evidence to the
  supervisor using Org's [evidence contract](../org-plan/references/evidence-report.md);
  the supervisor independently verifies it. Neither role relays raw logs upward.
- Treat every agent session as an independent context. Persist conclusions in
  the plan or a concise report instead of assuming another agent saw transient
  tool output.
- Plans may declare `$gestalt:context-mode` when relevant. It may also be used
  on demand without a declaration; governing routing requirements still apply.

## References

- [JavaScript and TypeScript patterns](./references/patterns-javascript.md)
- [Python patterns](./references/patterns-python.md)
- [Shell patterns](./references/patterns-shell.md)
- [Anti-patterns and common mistakes](./references/anti-patterns.md)
- [Browser workflows](./references/browser-workflows.md)
