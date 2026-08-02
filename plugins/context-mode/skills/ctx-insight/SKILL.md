---
name: ctx-insight
description: Open the hosted context-mode Insight engineering analytics dashboard. Trigger when the user invokes ctx-insight or asks to open Insight, view productive-rate analytics, retry waste, blockers, or team role views.
---

# Context Mode Insight

Call `ctx_insight`, return its result, and provide
<https://context-mode.com/insight> as the manual fallback if the browser did not
open. Treat that page as the source of truth for current sign-in and pricing.
