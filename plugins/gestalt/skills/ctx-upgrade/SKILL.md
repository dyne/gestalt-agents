---
name: ctx-upgrade
description: Repair the locally shipped context-mode installation, runtime bundles, hooks, settings, and plugin registration. Trigger when the user invokes ctx-upgrade or asks to repair context-mode. It never updates from upstream.
---

# Context Mode Local Repair

1. Do not invoke `ctx_upgrade` or any command that fetches GitHub, npm, or an
   upstream registry.
2. Derive the Gestalt repository root from this skill's plugin root and run its
   local `gestalt-setup.sh` with the requested repair options. The repository's
   versioned context-mode package is the only allowed repair source.
3. Inspect the command and summarize local build, installation, and Codex
   configuration effects before execution.
4. Verify the generated `context-mode-mcp.mjs` references a versioned plugin
   directory whose package version matches the directory name; then run
   `ctx-doctor`.
5. Build the result checklist from observed steps and actual local versions;
   mark failed or skipped steps accurately, and tell the user when a new
   session is required.
