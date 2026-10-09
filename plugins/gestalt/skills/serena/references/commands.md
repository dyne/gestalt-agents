# Managed Serena commands and storage

Use the Gestalt manager, not upstream configuration or a separately launched
Serena server. Inspect the managed installation without installing anything:

```sh
gestalt serena version
gestalt serena doctor --cwd /absolute/workspace
```

For installation or update requests, consult `gestalt --help` for the supported
Serena arguments. Routine repository work does not authorize installation.
When the agent determines that symbol-cache warmup is needed for the task and
workspace writes are permitted, use:

```sh
gestalt serena index --cwd /absolute/workspace
```

Use the active canonical workspace, accounting for nested repositories; do not
switch the managed MCP project to perform warmup. Inspect the indexing result
for failed files and recheck the semantic operations needed by the task. A
successful command alone does not establish complete cross-file coverage.
The runtime owns MCP startup:

```sh
gestalt serena mcp --cwd /absolute/workspace
```

The manager fixes `--context codex --mode editing`, disables dashboards and GUI,
and confines the exposed tool set to workspace navigation and structured edits.
A catalog handshake confirms connection only; a successful symbol overview
confirms local extraction only. Verify a known cross-file relationship before
relying on references or definitions across files. Do not use direct app-server
`mcpServer/tool/call` as evidence of edit authority: it lacks the native model tool-call permission
metadata required by the sandbox proxy. Missing or incompatible policy metadata
fails closed. Keep the runtime's prompt approvals and native permission profile.

The immutable executable descriptor is `$GESTALT_HOME/serena/active.json`.
Mutable configuration, project metadata, language-server caches, HOME/XDG data,
uv cache and temporary files belong under the canonical workspace's
`.gestalt/serena/`. A C++ compilation database remains project input, while the
managed clangd setting `compile_commands_dir` specifies where Serena writes a
transformed copy when needed; it does not generate build commands or select an
arbitrary existing build database. Do not create `~/.serena` or a project
`.serena`, import Serena merely to read its version, or add global write grants
to accommodate language servers.
Report actual language/platform startup limitations and use native fallback.

## TypeScript project discovery

When symbols are readable but a known caller is missing, check which
`tsconfig.json` the language server discovers from the source file's directory.
A build command that explicitly selects `tsconfig.server.json` does not establish
that the editor discovers that configuration. A client-only root configuration
can leave server files outside the configured project, even though individual
document symbols work. Check that the discovered configuration includes both
the definition and its caller before warming caches.

For a split client/server repository, a scoped `src/server/tsconfig.json` that
extends the existing server configuration can make that project discoverable.
Use this only when it matches the repository layout; preserve its compiler
options, resolved include paths, and build entry points. Do not broaden the
client project or switch Serena projects to hide the missing server graph.
Recheck the original caller through Serena and run the repository's type and
build checks. A TypeScript language-service regression can verify discovery and
the caller relationship without depending on an installed Serena runtime.

## C/C++ readiness and indexing

Serena's project index requests document symbols and saves its LSP caches.
clangd also builds a semantic index from compilation commands. Cache warmup
cannot replace missing compiler flags, include paths, or generated headers.

Locate `compile_commands.json` and check that it covers the target source files
with valid paths, the required language standard, and the intended build
configuration. Check database discovery relative to the active workspace and
nested repository roots; a database left in a build directory is not necessarily
discoverable. Preserve separate build configurations rather than blindly
merging databases from sibling repositories.

When metadata is missing, use the repository's documented build configuration
to generate it and any needed headers if that preparation is within the task's
authorization and filesystem permissions. For CMake this typically means
configuring the appropriate build directory with
`-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`, not compiling the entire project. Preserve
existing build choices. If dependencies or permissions are missing, report the
specific prerequisite and continue with native source inspection.

After inputs are available, decide whether warmup is needed and verify the
result. Fallback compile commands, unresolved project headers, or a missed
known caller mean semantic readiness is still incomplete even if symbol bodies
are readable. Do not claim a full index from a few successful probes; report
the operations and scope actually verified.

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
