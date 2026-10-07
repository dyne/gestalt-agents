---
name: xerj
description: Retrieve relevant code or documents from a verified local xerj index when locating implementations, tracing a concept across files, or answering questions about indexed material. Use only when the session supplies working xerj tools; confirm results against current sources.
---

# xerj retrieval

Gestalt supplies this skill only to runtimes with verified xerj tools. It is a
conditional capability, not an optional Org Plan milestone dependency. Read
[the command reference](references/commands.md) when using the managed CLI or
choosing retrieval arguments.

- Establish the current repository root and the intended index. Check catalog
  metadata and returned source paths against that root; an index name alone
  does not prove repository identity. Do not use another checkout's results as
  evidence about this one.
- A ready backend can have no indexed repository. An empty catalog or a missing
  autoindex catalog means retrieval lacks that material, not that source files
  do not exist. Continue with `rg` and direct file reads.
- Indexing writes state and may take substantial time. Run it only when the
  user explicitly asks to index the identified repository. Never install,
  start services, download models, run upstream `init`, or broadly autoindex
  workspaces to satisfy an ordinary search request. Startup belongs to the
  manager, not to model instructions.
- Check freshness using available catalog timestamps and current source
  contents. Dirty files and edits after indexing can make hits stale. If
  freshness or identity cannot be established, use hits only as possible
  locators and verify the current files; use `rg` when that is more direct.
- Search the identified index with a specific query and a small result limit.
  Read `xerj_map` before constructing field-specific query DSL. Prefer lexical
  search; do not enable external reranking or model downloads implicitly.
  Peer-corpus `xerj_code_search` is separate from searching the current project;
  retain its provenance and licence warnings.
- Open the current source at each relevant path before claiming behavior,
  citing a line, or editing. A no-match is a retrieval result, not proof of
  absence. Confirm absence with direct repository search.
- If tools become unavailable mid-task, report that bounded limitation and
  continue with `rg` and file reads. Do not repeatedly restart or repair the
  service; readiness is rechecked at the next runtime boundary.

xerj retrieves indexed source material. Context-mode analyzes large command,
file, or tool output and keeps that output out of conversational context. Use
context-mode for large retrieval responses when available; it does not make a
stale or unrelated index authoritative.
