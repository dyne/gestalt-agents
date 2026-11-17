# Context-mode session scratch

Context-mode consumes the shared Gestalt version 1 and 2 contexts in
`GESTALT_SESSION_TMP_CONTEXT`. Mobile and the launcher allocate owners; this
package validates them and publishes delegated execution borrower leases. The v1 JSON locator contains
`schemaVersion: 1`, canonical `workspacePath`, `ownerId`, `directory` and
`markerPath`. Owners live at `<workspace>/tmp/sessions/<ownerId>/`, with a
`.gestalt-owner.json` marker. The resolver rejects links, foreign UID,
nonprivate managed directories, invalid markers, and inactive/invalid primary
CLI or service leases. It preserves an existing user `tmp` parent's modes.
Present but invalid context fails visibly, without path-bearing diagnostics or
fallback to another temporary root.

In v2, `directory` still identifies durable workspace metadata and leases. A
`runtime` binding names a separate private physical payload root under
`<canonical /tmp>/gs-<uid>/<20 random hex digits>`. Both markers, current user,
permissions, canonical paths and device/inode/birth identity must agree. Aliases,
copied/replaced roots, retiring records and partial metadata are rejected. The
producer caps the root at 48 encoded bytes independently of workspace depth.
Linux permits 107 pathname bytes plus NUL; macOS checks reserve
NUL within 104 bytes. This leaves at least 55 appended bytes including separators
for Bitcoin/Chrome patterns; arbitrary third-party suffixes still need bounds.
Canonicalization keeps the physical pathname short. All components must support
v2 before use; retained v1 owners are validated without relocation. Sandbox and
approval restrictions remain unchanged. Persistent state never moves to runtime
scratch, and context-mode never retires a session's root itself.
Borrower publication/release also claims the shared workspace publication fence
before containment and owner fences, and checks logical/temporary ancestors
before and after publication. Final Forget holds that fence through durable
finalization; existing or replaced claims cannot be adopted or expired.

Managed subprocesses inherit exactly this context and `TMPDIR`, `TMP`, `TEMP`
set to the validated physical root in v2, or owner directory in v1. Each executor invocation creates its own
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
auth, installations, dependency caches, browser profiles, Serena caches and
legacy Xerj index data are persistent. Destination-local atomic installation staging remains beside
its destination; changing temporary routing does not grant deletion authority.
The runtime installer's `.stage-*` tree and its `.context-mode-prepare-tmp`
remain an installation transaction beside the persistent runtime destination.

The canonical Gestalt context-mode skill and generated Codex SessionStart/child
reminders state this boundary. Native MCP setup forwards only the additional
`GESTALT_SESSION_TMP_CONTEXT`, `TMPDIR`, `TMP`, `TEMP` allowlist entries; hooks
inherit and validate the same context. The default context-mode test command
includes the session scratch regressions; selected existing server/preload
regressions supplement that gate.
