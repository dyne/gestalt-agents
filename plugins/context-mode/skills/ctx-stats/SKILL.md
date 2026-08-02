---
name: ctx-stats
description: Show context-mode token use, context savings, and per-tool activity for the current session. Trigger when the user invokes ctx-stats or asks how much context-mode saved. This operation is read-only.
---

# Context Mode Stats

Call `ctx_stats` and return its complete formatted output unchanged. Add no more
than one sentence identifying the primary savings metric. If no calls are
recorded, say so.

`ctx_stats` never resets data. Use `ctx_purge` only when the user explicitly
requests deletion.
