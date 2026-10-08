# Managed Serena commands and storage

Use the Gestalt manager, not upstream configuration or a separately launched
Serena server. Inspect the managed installation without installing anything:

```sh
gestalt serena version
gestalt serena doctor --cwd /absolute/workspace
```

For an explicit installation, update or indexing request, consult
`gestalt --help` for the supported Serena arguments. Startup never authorizes an
installation or a full workspace scan. The runtime owns MCP startup:

```sh
gestalt serena mcp --cwd /absolute/workspace
```

The manager fixes `--context codex --mode editing`, disables dashboards and GUI,
and confines the exposed tool set to workspace navigation and structured edits.
A catalog handshake confirms connection only; a successful symbol overview
confirms language readiness. Do not use direct app-server `mcpServer/tool/call`
as evidence of edit authority: it lacks the native model tool-call permission
metadata required by the sandbox proxy. Missing or incompatible policy metadata
fails closed. Keep the runtime's prompt approvals and native permission profile.

The immutable executable descriptor is `$GESTALT_HOME/serena/active.json`.
Mutable configuration, project metadata, language-server caches, HOME/XDG data,
uv cache and temporary files belong under the canonical workspace's
`.gestalt/serena/`. A C++ compilation database remains project input, while the
managed clangd configuration points `compile_commands_dir` at its relocated copy
there. Do not create `~/.serena` or a project `.serena`, import Serena merely to
read its version, or add global write grants to accommodate language servers.
Report actual language/platform startup limitations and use native fallback.

## Verified runtime limits

Serena 1.7.0 was exercised on Linux x86_64 with managed Python 3.13.16 and
uv 0.12.23, using Python/Pyright and TypeScript 5.9.3 with
typescript-language-server 5.1.3. Cached language dependencies were provisioned
explicitly in disposable workspace state. C++ compilation-database relocation
was verified against the upstream transformer; a running clangd service and
macOS language startup were not verified.

With Codex 0.160.0 in the tested managed Linux environment, a restricted-network
profile timed out on native Python startup, including a cached offline-launcher
attempt. A separately configured network-enabled profile completed real CLI and
Mobile symbol operations under workspace-only writes. Do not infer readiness
from connection status or broaden a session's network policy to repair startup;
report the limitation and use native tools.
