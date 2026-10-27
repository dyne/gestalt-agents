# Reliable shell automation

## Shape and inputs

Use small named functions for validation, work, and cleanup, with a `main "$@"`
entry point for executable scripts. A Bash library should avoid running `main`
when sourced (for example, guard with `[[ ${BASH_SOURCE[0]} == "$0" ]]`) and avoid
leaking shell options/traps. Determine the script directory from `BASH_SOURCE[0]`
when necessary; distinguish the script's directory from the user's working
directory and define symlink behavior explicitly.

Parse short options with `getopts` or a checked `case` loop for long options.
Validate the presence and semantics of option values before shifting. Support
`--` for literal operands, a useful `--help`, nonzero usage errors, and an
explicit policy for unknown options. Avoid named-parameter parsers based on
`eval`; use a case statement or declared fields. Validate numeric bounds and
required files/directories before mutating anything.

Check dependencies with `command -v`, and probe versions only when a required
feature depends on them. Do not add automatic package installation. Keep logs
on stderr with stable levels; timestamps and structured JSON are useful for
long-running jobs, but unnecessary for every short script. Escape structured
logs with a real encoder and avoid secret values or full command tracing.

## Cleanup and signals

Create unique private temporary resources with `mktemp`; check creation before
using the path. Use task-specific names such as `task_tmp`, leaving `TMPDIR`
as the caller's preferred location. Register cleanup once resources can be
tracked; handle partial initialization safely. Restrict cleanup to exact paths
created by this run, with quoted arguments and no empty-path fallback.

An EXIT handler should capture the incoming status immediately, attempt cleanup,
and preserve a preexisting failure. If the work succeeded but required cleanup
failed, report that failure rather than silently claiming success. Signal
handlers can exit with a conventional signal status, allowing EXIT cleanup;
guard against recursive handlers. SIGKILL and power loss cannot be trapped, so
temporary-file safety also depends on permissions and recoverable design.

For children, track each `$!`, send TERM to owned active children, and collect
their statuses with explicit `wait` calls. Bound shutdown time; use KILL only
after verified failure to stop. A bare `wait` does not reliably aggregate all
child failures. Do not signal PID 0, an inferred process group, or a reused PID
without a verified ownership contract. Long-lived orchestration may be better
served by a process supervisor than a shell loop.

## File replacement and idempotency

For a replacement, create the temporary file in the destination directory, write
it completely, validate it, set intended permissions, then rename it into place.
A cross-filesystem move is not an atomic rename. Define symlink behavior and
metadata/ownership preservation. Atomic visibility is not crash durability;
fsync requirements need explicit handling if the use case demands them.

The [atomic-copy example](../examples/atomic-copy.sh) uses a destination-directory
temporary file and private output permissions. It deliberately does not preserve
the source's owner, mode, ACLs, or extended attributes, and does not claim crash
durability. It assumes a trusted destination directory, single writer, and no
concurrent replacement of the target. Hostile shared directories or concurrent
writers require stronger operations/locking than shell checks followed by rename.

Use `mkdir -p` and replace-or-update behavior where reruns should converge. Guard
append operations against duplicate entries using the format's real parser.
Separate "already desired" from "could not inspect" errors. A test followed by
a write is not concurrency protection; use the platform's supported lock or
transaction mechanism. `flock` is not universally available on macOS.

## Dry run and retries

Centralize side effects so dry-run follows the same plan without executing
mutations or external requests. Validate arguments and read needed state, then
print quoted operations. Bash `printf '%q'` is useful for diagnostic command
display; never feed the display string to `eval`. Test that the filesystem and
external-call fixture remain unchanged.

Retry only classified transient failures. Specify maximum attempts, bounded
backoff (with jitter when concurrent clients matter), per-attempt timeout, and
total time budget. Authentication errors and malformed input generally need
correction rather than retry. A network timeout may occur after a server
committed a write: require idempotency keys or an explicit reconciliation path
before retrying a non-idempotent request. Return a meaningful final failure and
do not hide it in logging or cleanup.

## Validation

Run `bash -n script.sh` or `sh -n script.sh` for the chosen dialect. Run available
ShellCheck with that dialect and repository configuration; explain justified
suppressions rather than silencing a whole class globally. If the linter is
missing, report that fact and continue useful syntax/behavior checks.

Use a temporary directory and stub PATH entries to test dependency/network/child
failure without affecting real services. Check spaces and leading dashes, missing
option values, empty input, permissions, partial writes, interrupt cleanup, repeat
execution, and dry-run behavior where applicable. Exercise all advertised host
environments when available; a Linux pass is not evidence of macOS portability.
