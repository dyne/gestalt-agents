---
name: serena
description: Navigate symbols, trace references, inspect diagnostics, and make structured code edits in the active workspace with verified managed Serena tools. Use only when the runtime supplies a working Codex-context Serena connection; retain native tools for unsupported languages.
---

# Serena workspace semantics

Gestalt supplies this conditional skill alongside a verified managed MCP
connection when the session profile selects it. Package discovery and a connected
tool catalog do not establish project language readiness. Use the existing
connection, always managed with `--context codex --mode editing`.

## Operation workflow

- Read Serena's initial instructions when exposed. Identify the requested
  operation and reuse its identity-bound readiness below. A connection proves
  neither extraction nor references; an overview proves local extraction only.
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
- Discover arguments from the live schema; keep paths, symbols and output bounded.
  Perform the requested useful operation, then continue the task:

  | Need | Operation and required evidence |
  |---|---|
  | Find a definition or read its body | Locate the symbol, then retrieve its definition/body. Local extraction suffices; unrelated callers are not a prerequisite. |
  | Analyze callers or interface impact | Query references; check diagnostics when exposed and verify a known definition/reference relationship against current source. Empty references do not prove no callers. |
  | Replace a body or insert around a symbol | Read current source natively; use the fitting structured edit on the verified symbol when authorized. Interface changes also require verified references. Inspect the diff and run relevant checks. |
  | Edit prose or text without a fitting symbol operation | Use native edits. |
- Retrieval and an advertised editing
  tool grant no write authority: native filesystem restrictions and per-tool
  approvals remain binding. Collaboration plan-mode instructions prohibit edits
  even if the tool is listed; this is an agent instruction, not an OS mode bit.
  A denied tool call is not permission to retry through another transport.
- Keep operations within the active authorized workspace. Do not invoke project
  switching, mode management, or shell execution through Serena. Let the managed
  connection retain the session's native sandbox policy; never call an unconfined
  backend directly or replace per-tool prompt approvals with blanket approval.
- Use scoped `rg` and current source reads for broad or repeated source discovery,
  including across repositories, retaining repository provenance and path aliases;
  verify references against current local source before applying them. Serena
  supplies semantics for the active workspace. Use context-mode for large tool,
  diagnostic or file output when available.

Read [managed commands and storage](references/commands.md) also for operator
requests to diagnose or maintain Serena. Missing tools remain a bounded
limitation, not an implicit installation request.

## Query recovery and scope

A too-long overview is a query-sizing result, not unavailability. Narrow the
path, symbol or depth and read the needed body; alternatively increase the
bounded budget with a task-specific reason. Recheck the requested operation.
An overview alone never establishes usable references or semantic edit readiness.

Bind readiness and failed probes/warmup to the actual repository/fork, build
variant, relevant source/configuration fingerprints and tool/runtime generation.
Reuse a failure for unchanged inputs; recheck after those inputs change. Never
transfer readiness or a cached failure between forks or build variants. Verify
the known definition/reference relation in current source before relying on it.
Reuse successful observations with their original time too; do not repeat an
overview before each useful operation. Keep extraction and reference evidence
separate: a changed caller invalidates its graph, not an unchanged local body;
a disconnected runtime or fresh executor invalidates that runtime's bindings.
Missing prerequisites retain native fallback without installation or project
switching. For C/C++, verify the target repository/build's compilation database,
flags and generated headers using the linked command reference; a sibling
database or transformed cache is not evidence of those inputs.
