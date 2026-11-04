# Context-mode session scratch

Context-mode consumes the shared Gestalt version 1 context in
`GESTALT_SESSION_TMP_CONTEXT`. Mobile and the launcher allocate owners; this
package validates them and publishes delegated execution borrower leases. The JSON locator contains
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
Background execution retains its files. Each managed operation publishes a
private v1 borrower before writing scripts or spawning any runtime; compilation
and execution share that claim. Publication/release use the same outermost-first
containment locks and owner controller/association fences as Mobile and Launcher.
The primary marker and other borrowers are never rewritten. A claim is released
only after operation completion and confirmed absence of every owned execution
group. Leader exit, a TERM request or an MCP response alone cannot release it.
Session scratch remains available until explicit lifecycle
cleanup, including across Mobile stop/reopen.

MCP shutdown drains foreground, compiler and background groups for up to 3.5
seconds, escalating only while the original leader is live. Busy metadata,
unknown group probes, an interrupted shutdown or a crash retain the durable
claim. While the MCP remains alive it retries read-only absence checks and lease
publication; a later confirmed release unblocks cleanup. After its death an
unknown claim can keep Forget retryable but blocked: this package does not
reclaim leases by age/PID or claim to recover crash ownership automatically.
Windows group absence cannot currently be established, so managed claims there
remain conservative. Standalone execution retains its existing behavior.
Delegated publishing supplies protection, never cleanup authority; only the
owning Mobile/Launcher lifecycle can retire owner directories.

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
