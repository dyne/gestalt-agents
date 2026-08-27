---
name: context-mode
description: Route large or uncertain command, file, test, log, API, documentation, browser, and MCP output through context-mode so only derived findings enter the conversation. Use for output analysis, filtering, counting, searching, indexing, or summarizing; keep edits and governing instruction reads on native tools.
---

# Context Mode

Keep large data out of the conversation while preserving complete evidence for
analysis.

## Routing contract

Choose the host-native filesystem tool first when the operation reads or
changes the workspace. Use context-mode only to analyze evidence that is large,
uncertain, or needs filtering, indexing, or repeated retrieval.

1. Use an available native `read_file` for small bounded reads and always for
   governing `AGENTS.md`, selected `SKILL.md`, plugin manifests, and a file
   before editing it. This is pre-edit inspection, not large-file analysis.
2. Use native `create_file`, `edit_file`, or `apply_patch` for writes. Use
   native `exec_command` for mutations and short, bounded command output;
   use `write_stdin` only to continue a live native command session. Use
   `view_image` to inspect a local image. Do not use shell write tricks when a
   native editor is available.
3. Do not invent aliases. Hosts may expose provider-prefixed names or a native
   equivalent rather than these spellings; use only the capability actually
   exposed by the current host.
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
| Small bounded filesystem read, governing instruction, manifest, or file about to edit | available native `read_file` |
| Create or edit a workspace file | available native `create_file`, `edit_file`, or `apply_patch` |
| Mutation or short bounded command | native `exec_command` |
| Continue a running native command | native `write_stdin` |
| Inspect a local image | native `view_image` |
| One uncertain or large command, API, test, build, or log analysis | `ctx_execute` |
| One large file analysis without loading it in full | `ctx_execute_file` |
| Several independent large inspections | `ctx_batch_execute` |
| Durable local corpus for later retrieval | `ctx_index` |
| Indexed follow-up or session-memory query | `ctx_search` |
| External documentation to retrieve repeatedly | `ctx_fetch_and_index` |
| Inspect context-mode health, usage, or stored data | `ctx_doctor`, `ctx_stats`, `ctx_purge` |

Context-mode MCP methods can appear with a generated provider prefix. The short
names in this table describe their role; use the provider-prefixed method that
the host exposes.

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

For a one-shot question about a large file that will not be loaded in full, use
`ctx_execute_file`. For several follow-up questions, use `ctx_index(path)` once
and query it with `ctx_search`. Read a small file or any file before editing it
with the native reader instead.

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
  supervisor; the supervisor and director never relay raw logs upward.
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
