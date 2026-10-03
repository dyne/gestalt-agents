---
name: ctx-doctor
description: Diagnose context-mode runtime, dependency, spawned MCP handshake, hook, FTS5, plugin registration, version, and startup problems. Trigger when the user invokes ctx-doctor or reports that context-mode is missing, unhealthy, or failing to start.
---

# Context Mode Doctor

1. Derive the Gestalt plugin root by going two directories up from this skill
   and run its version-aware doctor bridge:

```sh
node "<PLUGIN_ROOT>/scripts/ctx-doctor.mjs"
```

2. Return the command, exit status, and complete diagnostic report unchanged.
3. Preserve its `[OK]`, `[FAIL]`, and `[WARN]` prefixes. A missing, disabled, or
   incorrectly versioned `gestalt:` skill is a failure, not a warning.
