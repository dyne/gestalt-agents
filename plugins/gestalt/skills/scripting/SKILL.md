---
name: scripting
metadata:
  adaptation_version: "1.0.0"
description: Write, review, debug, or refactor Bash/POSIX shell scripts, commands, CI/CD shell steps, and Linux/macOS automation. Covers quoting, pipelines, options, exit codes, traps, temporary files, processes, portability, and idempotency. Use for shell work, not unrelated tasks merely running on Linux.
---

# Gestalt Scripting

Make shell automation predictable for its intended interpreter, inputs, failure
paths, and side effects. This skill combines terminal operations and defensive
script design; it does not require another shell skill.

## Workflow

1. Identify the interpreter and minimum version, operating systems, calling
   environment, expected input/output, dependencies, and authorized effects.
   Inspect the existing script and callers. Preserve its public flags, stdout
   format, exit status contract, and sourced-library behavior unless changing
   them is part of the request.
2. Choose the simplest implementation. Use an existing project language when
   structured data or complex state makes shell fragile. For shell, select Bash
   features only when Bash is guaranteed; `sh` must use POSIX syntax.
3. Read [shell behavior](references/shell-behavior.md) for quoting, commands,
   pipelines, portability, and troubleshooting. Read [reliable automation](references/automation.md)
   for scripts with cleanup, mutation, concurrency, retries, or rerun requirements.
4. Implement explicit argument validation and error handling around important
   operations. Keep stdout for requested data and diagnostics on stderr. Bound
   retries and waits, and restrict cleanup/signals to resources this run owns.
5. Validate syntax using the actual interpreter, lint with available ShellCheck,
   and exercise relevant success and failure paths in a temporary workspace.
   For destructive or external operations, use fixtures/stubs or an existing
   dry-run mode until real execution is authorized.
6. Report behavior, portability assumptions, checks actually run, and unavailable
   tools. Do not claim runtime validation from `bash -n` alone.

## Essential rules

- Keep arguments as arguments: quote expansions and use Bash arrays with
  `"${args[@]}"`. Avoid `eval`, command strings, and parsing `ls`. Use NUL-delimited
  paths when filenames can contain whitespace/newlines; use a real JSON/CSV
  parser for structured data.
- `set -e` is context-dependent, not complete error handling. An executable Bash
  script can use `set -Eeuo pipefail`, but critical errors still need explicit
  status handling. Do not change a caller's shell options or traps from a sourced
  library without an explicit contract. POSIX `sh` does not provide Bash arrays,
  `[[ ... ]]`, or a portable `pipefail` option.
- Validate required option values before `$2` or `shift 2`; handle `--`, unknown
  options, empty values, and help. Check dependencies with `command -v`.
- Use task-specific variables, private `mktemp` resources, and cleanup that
  preserves failure status. Never repurpose `HOME`, `PATH`, or `TMPDIR` as a
  scratch variable. Avoid fixed `/tmp` filenames and broad cleanup paths.
- A dry run must skip mutations, not merely print a message before executing
  them. Make repeated execution converge where practical, and distinguish
  idempotency from an unsafe check-then-act race.
- Send TERM before KILL when stopping an owned process. Verify PID ownership;
  listening on a port or matching a process-name substring is not authorization
  to terminate it. Collect individual background statuses.
- Check HTTP failures and timeouts as well as process exit codes. Do not retry
  non-idempotent remote actions without a deduplication/recovery contract.
- Do not expose credentials via `set -x`, environment dumps, command arguments,
  or verbose network logs. Log enough context to diagnose the failed operation
  without printing secret values.

## Verification cases

Select cases relevant to the change: empty/missing arguments, filenames with
spaces/globs/leading dashes, missing dependency, failing pipeline stage, failed
write, interrupted run, repeated invocation, dry-run non-mutation, and child
failure. Check stdout/stderr and exit status, remaining temporary files/processes,
and the final filesystem state. A simple read-only one-liner does not need an
automation framework or an exhaustive test suite.

The [atomic-copy example](examples/atomic-copy.sh) demonstrates validated options,
strict-mode limits, status-preserving cleanup, dry-run, and a temporary file on
the destination filesystem. Read its documented limits before adapting it.

Attribution: [provenance](references/provenance.md).
