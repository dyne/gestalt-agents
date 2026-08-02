---
name: ctx-index
description: Index a local file or directory into context-mode's FTS5 knowledge base for focused later retrieval. Trigger when the user invokes ctx-index or wants persistent search over project files without rereading raw content.
---

# Context Mode Index

1. Use the provided path. Ask only when no path is given and the intended root
   cannot be inferred safely.
2. Call `ctx_index` with `path`, a descriptive `source`, and conservative
   bounds. Do not send large inline `content`.
3. Exclude dependency directories, build output, generated files, and secrets.
4. Ask before raising `maxFiles` above 500.
5. Report the source label, indexed file or section count, and an example
   `ctx_search` call scoped to that source.

For a repository, start with `maxDepth: 5` and `maxFiles: 200`. If the MCP tool
is unavailable, run `context-mode index <path> --source <label>`.
