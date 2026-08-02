---
name: ctx-upgrade
description: Upgrade or repair a context-mode installation, runtime bundles, hooks, settings, and plugin registration. Trigger when the user invokes ctx-upgrade or asks to update or repair context-mode.
---

# Context Mode Upgrade

1. Call `ctx_upgrade` to obtain the proposed command.
2. Inspect the command and summarize its repository, network, build, install,
   and configuration effects. Do not run a command outside the user's requested
   upgrade scope.
3. Execute the command with the host shell tool.
4. Build the result checklist from observed steps and actual version numbers;
   mark failed or skipped steps accurately.
5. Tell the user whether a new session is required.

If `ctx_upgrade` is unavailable, derive the plugin root by going two
directories up from this skill and run:

```sh
CLI="<PLUGIN_ROOT>/cli.bundle.mjs"
[ -f "$CLI" ] || CLI="<PLUGIN_ROOT>/build/cli.js"
node "$CLI" upgrade
```
