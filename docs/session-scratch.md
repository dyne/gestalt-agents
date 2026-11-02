# Context-mode session scratch

Context-mode consumes the shared Gestalt version 1 context in
`GESTALT_SESSION_TMP_CONTEXT`. Mobile and the launcher allocate owners; this
package only validates and consumes them. The JSON locator contains
`schemaVersion: 1`, canonical `workspacePath`, `ownerId`, `directory` and
`markerPath`. Owners live at `<workspace>/tmp/sessions/<ownerId>/`, with a
`.gestalt-owner.json` marker. The resolver rejects links, foreign UID,
nonprivate managed directories, invalid markers, and inactive/invalid primary
CLI or service leases. It preserves an existing user `tmp` parent's modes.
Present but invalid context fails visibly, without path-bearing diagnostics or
fallback to another temporary root.

Managed subprocesses inherit exactly this context and `TMPDIR`, `TMP`, `TEMP`
set to its validated owner directory. Each executor invocation creates its own
`.ctx-mode-*` child and removes only that child after foreground completion.
Background execution retains its files. Crashes can leave attributed children;
the resolver never sweeps siblings, changes leases, or infers cleanup authority
from PID or age. Session scratch remains available until explicit lifecycle
cleanup, including across Mobile stop/reopen.

Executor scripts, transient fetch output, filesystem-tracking preloads,
default temporary databases, upgrade/probe scratch, and MCP readiness sentinels
use this owner. Producer and readiness hooks use the same sentinel resolver.
Node batch preload paths are quoted for spaces. Managed TypeScript's `tsx`
fallback uses its Node loader instead of the CLI's length-limited Unix socket.
Filesystem mount and sandbox restrictions still apply.

Without the context variable, standalone behavior remains unchanged: general
scratch uses `os.tmpdir()` and honors operator temporary settings; the executor
retains its legacy OS temporary-root discovery (bypassing ambient `TMPDIR`),
and Unix readiness uses `/tmp` (or its explicit test override). No selected
workspace is inferred from cwd. The standalone `tsx` CLI is unchanged.

Workspace `.gestalt/context-mode` databases, evidence, source maps and session
state retain their existing persistent storage rules. Source, Git, history,
auth, installations, dependency caches, browser profiles and Serena/XERJ indexes
are persistent. Destination-local atomic installation staging remains beside
its destination; changing temporary routing does not grant deletion authority.
The runtime installer's `.stage-*` tree and its `.context-mode-prepare-tmp`
remain an installation transaction beside the persistent runtime destination.

The canonical Gestalt context-mode skill and generated Codex SessionStart/child
reminders state this boundary. Native MCP setup forwards only the additional
`GESTALT_SESSION_TMP_CONTEXT`, `TMPDIR`, `TMP`, `TEMP` allowlist entries; hooks
inherit and validate the same context. The default context-mode test command
includes the session scratch regressions; selected existing server/preload
regressions supplement that gate.
