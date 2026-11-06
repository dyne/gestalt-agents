---
name: xerj
description: Use XERJ for bounded lexical queries during broad or repeated source discovery in fresh covered repositories. Preserve provenance and aliases, verify current source, and keep exact known-file lookup native.
---

# xerj global engineering knowledge

Gestalt supplies this skill only to runtimes with verified xerj tools. It is a
conditional capability. Org Plans may declare `$gestalt:xerj` when relevant,
and executors may use it on demand without a declaration; neither bypasses
runtime readiness or index coverage checks. Read
[the command reference](references/commands.md) when using the managed CLI or
choosing retrieval arguments.

- Prefer lexical XERJ over broad or repeated grep/rg/ag discovery when fresh
  indexes cover the requested single-repository or multi-repository scope.
  Keep precise known-file lookup native. This is intent-based routing, with no
  tool-call quota or blanket grep ban.
  Search across indexed repositories for related implementations and prior art.
  Do not assume retrieved code belongs to the current repository. Treat it as
  reference material unless the task explicitly concerns its source repository.
  Identify that repository from catalog root metadata, index provenance, and
  source paths; an index name or relative filename alone is insufficient.
- A ready backend can have no indexed repository. An empty catalog or a missing
  autoindex catalog means retrieval lacks that material, not that source files
  do not exist. Continue with `rg` and direct file reads.
- Mobile owns root-wide indexing and watching outside agent sessions. Do not
  autoindex, start services, install tools, or download models for a retrieval
  request. Missing/stale material is a limitation to report, not authority to
  widen the sandbox or index another tree.
- Check freshness using available catalog timestamps and current source
  contents. Dirty files and edits after indexing can make hits stale. If
  freshness or identity cannot be established, use hits only as possible
  locators and verify the current files; use `rg` when that is more direct.
- Cite the source repository and path when describing prior art. Resolve
  relative paths against the source repository, never the current workspace.
  Before claiming current local behavior or editing, inspect the actual target
  repository and verify that the reference applies. If its source is unavailable,
  label the result as an indexed reference with unverified freshness. A no-match
  is not proof of absence; check the explicitly targeted repository directly.
- If tools become unavailable mid-task, report that bounded limitation and
  continue with `rg` and file reads. Do not repeatedly restart or repair the
  service.

## Retrieval workflow

1. Identify the requested repository/fork and discovery scope. Exact known-file
   lookup stays native. Reuse readiness only for the same scope, source/configuration
   fingerprints, catalog and tool/runtime generation; retain its observation time.
2. If coverage is unverified, inspect `xerj_map` and available root/index metadata,
   then compare current source. Counts alone prove neither identity nor freshness.
   Reuse an unchanged verified map; do not remap before each query.
3. With suitable coverage, perform `xerj_search` against the relevant indexes or
   catalog-verified glob using a task-specific lexical query and `size: 5`.
   Mapping is preparation, not the retrieval result. Read the map before field DSL;
   leave external reranking and model downloads disabled. Peer `xerj_code_search`
   requires an identified corpus and preserved provenance/licence warnings.
4. Verify useful hits in current target files, retaining repository, all aliases
   and dirty-source differences. A no-match requires direct current-source checks
   in the requested scope before an absence claim. Continue the requested work
   using those verified findings, rather than ending at readiness.
5. For stale, empty, missing, partial or unavailable coverage, record one concrete
   limitation and continue natively. Reuse that fallback without repeating probes
   or explanations until affected source/configuration, scope, catalog or runtime
   changes; refresh only the invalidated evidence. Fresh executors resolve their
   own tools and readiness.

All workspaces share `$CODEX_HOME/xerj-data` (default
`~/.codex-gestalt/xerj-data`). Shared storage does not make reference material
authoritative for every repository or authorize indexing additional repositories.

xerj retrieves indexed source material. Context-mode analyzes large command,
file, or tool output and keeps that output out of conversational context. Use
context-mode for large retrieval responses when available; it does not make a
stale or unrelated index authoritative.

Use Serena, when available, for semantic navigation, symbol relationships and
structured modifications in the active workspace. XERJ does not replace it.
The indexing scope never grants permission to modify files outside the active
workspace. Retain every `ax_paths` alias when comparing identical files across
forks; do not attribute a shared content hit only to its canonical `ax_path`.
