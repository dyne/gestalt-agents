---
name: ctx-purge
description: Permanently delete context-mode data for one session or an entire project. Trigger only when the user invokes ctx-purge or explicitly asks to wipe indexed content, session records, events, or context-mode statistics.
---

# Context Mode Purge

Choose an explicit scope before deleting anything:

| Scope | Required call | Deleted | Preserved |
|---|---|---|---|
| One session | `ctx_purge({confirm: true, sessionId: "<id>"})` | matching session rows and FTS5 chunks | sibling sessions, project statistics, store file |
| Project | `ctx_purge({confirm: true, scope: "project"})` | all indexed content, all session rows, events, and statistics | nothing in the project's context-mode store |

1. If session scope is requested without an ID, ask for the session ID.
2. Before project scope, name every category that will be deleted and obtain
   explicit confirmation for that scope.
3. Never combine `sessionId` with `scope: "project"`.
4. Call `ctx_purge` only after the required choice and confirmation.
5. Report exactly what the tool deleted and what it preserved.

There is no undo. `/clear`, `/compact`, and `ctx_stats` do not delete stored
context-mode data.
