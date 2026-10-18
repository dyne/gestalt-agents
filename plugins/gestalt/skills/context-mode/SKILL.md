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
3. Do not invent aliases. Hosts may expose provider-prefixed names or a native
   equivalent rather than these spellings; use only the capability actually
   exposed by the current host. Resolve needed names/argument fields once per
   valid session; invalidate cached resolution after reconnect, tool-set change
   or unavailable-tool errors. Inspect relevant fields instead of whole catalogs.
4. Use context-mode for large or uncertain evidence. If it is unavailable,
   capture evidence outside the conversation and report only the command, exit
   status, counts, and smallest useful failure excerpt.
5. Print derived findings, not raw datasets. Include exact paths, identifiers,
   line numbers, values, and exit status needed to verify the conclusion.
6. Context-mode never writes and never authorizes a mutation, deletion,
   install, push, network call, or other external side effect.

## Tool selection

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

Use the methods actually exposed by the host, including provider prefixes.

For shipped `ctx_test_evidence`, use `operation: "github"` with a repository,
run and attempt, or `operation: "local"` with existing file paths and observed
command exits. It uses existing `gh` authentication and returns at most 2048
UTF-8 bytes. Retrieve overflow with `operation: "followup"`, its report ID and
`nextOffset`; use returned index sources for search. Unknown formats and
incomplete evidence remain uncertain. It does not run tests or wait for CI.

## Output rules

- In `ctx_execute` and `ctx_execute_file`, explicitly print the final findings;
  only standard output returns to the conversation.
- Analyze before printing. Do not print an entire JSON object, file, page,
  snapshot, or test log merely to inspect it.
- Use `ctx_index(path: ...)` for large local content. Use inline `content` only
  for small text composed in the current request.
- Batch related searches in one `ctx_search` call and use `source` whenever
  several indexed sources could match.
- Use two to four specific technical terms per search query.

## Files and browser output

For one large-file question use `ctx_execute_file`; for repeated questions,
index its path once and query with `ctx_search`. Native pre-edit reads still
apply.

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
- Do not add `$gestalt:context-mode` to an Org Plan `:SKILLS:` property
  when governing instructions define it as an implicit baseline.

## References

- [JavaScript and TypeScript patterns](./references/patterns-javascript.md)
- [Python patterns](./references/patterns-python.md)
- [Shell patterns](./references/patterns-shell.md)
- [Anti-patterns and common mistakes](./references/anti-patterns.md)
- [Browser workflows](./references/browser-workflows.md)
