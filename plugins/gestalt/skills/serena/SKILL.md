---
name: serena
description: Navigate symbols, trace references, inspect diagnostics, and make structured code edits in the active workspace with verified managed Serena tools. Use only when the runtime supplies a working Codex-context Serena connection; retain native tools for unsupported languages.
---

# Serena workspace semantics

Gestalt supplies this conditional skill alongside a verified managed MCP
connection when the session profile selects it. Package discovery and a connected
tool catalog do not establish project language readiness. Use the existing
connection, always managed with `--context codex --mode editing`.

- Read Serena's initial instructions when exposed. On encountering a repository,
  assess readiness for the language and operations the task needs. A symbol
  overview for a known source file proves local symbol extraction only. Before
  relying on cross-file navigation, check diagnostics when available and verify
  a known definition/reference relationship against current source. An empty
  reference result is not evidence of no callers when indexing is incomplete.
- Decide whether symbol-cache warmup is useful for the task; do not require the
  user to request an index command. When prerequisites are satisfied and cache
  writes are permitted, run `gestalt serena index --cwd /absolute/workspace`
  through the managed command, then repeat the relevant semantic checks. Reuse
  working caches; do not scan every repository merely because it was opened.
  Read [managed commands and storage](references/commands.md) before indexing
  or preparing missing language inputs, especially for C/C++.
- On missing prerequisites, startup failures, unsupported languages, or failed
  indexing, report the specific limitation and use `rg` and native file tools
  for affected operations. Do not repeatedly index unchanged failing inputs.
  Routine indexing does not authorize installation, project or mode switching,
  service restarts, or wider permissions.
- Use symbol overview/search to locate the target, then read only the needed
  symbol bodies. Inspect references before changing an interface and diagnostics
  when the backend exposes them. Discover arguments from the live tool schema;
  use precise paths, symbol names and bounded result scopes.
- For authorized edits, prefer symbol-body replacement or insertion around a
  verified symbol when it fits the change. Read current source first, inspect
  the resulting diff and run the relevant checks. Use native edits for changes
  that do not fit the structured tools. Retrieval and an advertised editing
  tool grant no write authority: native filesystem restrictions and per-tool
  approvals remain binding. Collaboration plan-mode instructions prohibit edits
  even if the tool is listed; this is an agent instruction, not an OS mode bit.
  A denied tool call is not permission to retry through another transport.
- Keep operations within the active authorized workspace. Do not invoke project
  switching, mode management, or shell execution through Serena. Let the managed
  connection retain the session's native sandbox policy; never call an unconfined
  backend directly or replace per-tool prompt approvals with blanket approval.
- Use XERJ for broad cross-project prior art, retaining repository provenance;
  verify references against current local source before applying them. Serena
  supplies semantics for the active workspace. Use context-mode for large tool,
  diagnostic or file output when available.

Read [managed commands and storage](references/commands.md) also for operator
requests to diagnose or maintain Serena. Missing tools remain a bounded
limitation, not an implicit installation request.
