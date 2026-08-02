---
name: context-mode
description: Route large or uncertain command, file, test, log, API, documentation, browser, and MCP output through context-mode so only derived findings enter the conversation. Use for output analysis, filtering, counting, searching, indexing, or summarizing; keep edits and governing instruction reads on native tools.
---

# Context Mode

Keep large data out of the conversation while preserving complete evidence for
analysis.

## Routing contract

1. Read selected `SKILL.md`, governing `AGENTS.md`, plugin manifests, and files
   being edited with the host's native reader.
2. Use native commands when their output is known to be small and bounded.
3. Use context-mode when output may be large, is data-heavy, or needs repeated
   filtering. If context-mode is unavailable, capture output outside the
   conversation and report only the command, exit status, counts, and smallest
   useful failure excerpt.
4. Print derived findings, not raw datasets. Include exact paths, identifiers,
   line numbers, values, and exit status needed to verify the conclusion.
5. Use native edit tools for writes. Context-mode routing never authorizes a
   mutation, deletion, install, push, network call, or external side effect.

## Tool selection

| Need | Tool |
|---|---|
| Analyze command, API, test, build, or log output | `ctx_execute` |
| Analyze one file without loading it into conversation | `ctx_execute_file` |
| Run and summarize several independent commands | `ctx_batch_execute` |
| Store a file or directory for later queries | `ctx_index` |
| Query indexed content or session memory | `ctx_search` |
| Fetch and index external documentation | `ctx_fetch_and_index` |
| Inspect health, usage, or stored data | `ctx_doctor`, `ctx_stats`, `ctx_purge` |

Hosts may display generated prefixes around these short MCP tool names. Use the
tool actually exposed by the current host.

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

For a one-shot file question, use `ctx_execute_file`. For several follow-up
questions, use `ctx_index(path)` once and query it with `ctx_search`.

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
