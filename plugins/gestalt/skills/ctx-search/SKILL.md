---
name: ctx-search
description: Search context-mode's FTS5 knowledge base for indexed project files, documentation, or session memory. Trigger when the user invokes ctx-search or asks focused follow-up questions about previously indexed content.
---

# Context Mode Search

1. Use the smallest sufficient `queries` array; one focused query can suffice.
2. Use two to four specific technical terms per query.
3. Set `source` when the requested project or document label is known.
4. Start with the default `limit: 3`. Follow up missing or contradictory results
   with focused queries; expand only the needed source window and byte budget
   under the [routing contract](../context-mode/SKILL.md#output-rules).
5. If the index is empty, tell the user to run `ctx_index` first.

If the MCP tool is unavailable, run
`context-mode search <query> --source <label> --limit 3`.
