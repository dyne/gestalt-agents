---
name: xerj
description: Discover related implementations, prior art, and engineering knowledge across indexed repositories with xerj. Use only with working xerj tools. Treat results as reference material, identify their source repository, and verify current code before applying findings locally.
---

# xerj global engineering knowledge

Gestalt supplies this skill only to runtimes with verified xerj tools. It is a
conditional capability, not an optional Org Plan milestone dependency. Read
[the command reference](references/commands.md) when using the managed CLI or
choosing retrieval arguments.

- Search across indexed repositories for related implementations and prior art.
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
- Discover available indexes with `xerj_map`, then search relevant indexes or
  a catalog-verified index glob with a specific query and a small result limit.
  Read `xerj_map` before constructing field-specific query DSL. Prefer lexical
  search; do not enable external reranking or model downloads implicitly.
  Peer-corpus `xerj_code_search` uses a separately identified corpus; retain
  its provenance and licence warnings.
- Cite the source repository and path when describing prior art. Resolve
  relative paths against the source repository, never the current workspace.
  Before claiming current local behavior or editing, inspect the actual target
  repository and verify that the reference applies. If its source is unavailable,
  label the result as an indexed reference with unverified freshness. A no-match
  is not proof of absence; check the explicitly targeted repository directly.
- If tools become unavailable mid-task, report that bounded limitation and
  continue with `rg` and file reads. Do not repeatedly restart or repair the
  service; readiness is rechecked at the next runtime boundary.

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
