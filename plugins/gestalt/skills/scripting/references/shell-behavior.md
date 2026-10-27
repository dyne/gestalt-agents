# Shell behavior and terminal operations

## Interpreter and portability

Use a Bash shebang for Bash syntax; use `#!/bin/sh` only for portable shell.
macOS's system Bash may lack modern Bash features; confirm the supported version
before using associative arrays, `mapfile`, namerefs, or newer `wait` options.
GNU and BSD tools differ (`sed -i`, `stat`, `date`, `readlink -f`, `timeout`).
Do not assume installing GNU utilities is authorized. Prefer a portable approach
or state the dependency.

Shell pipelines carry bytes/text, unlike PowerShell object pipelines. Prefer
structured parsers for JSON or CSV containing quoting/newlines. `cut -d,` is only
suitable for a deliberately simple delimiter format, not general CSV.

## Arguments, expansion, and input

```bash
args=(--output "$output_file" -- "$input_file")
tool "${args[@]}"
printf '%s\n' "$value"
while IFS= read -r line || [[ -n $line ]]; do
    printf '%s\n' "$line"
done < "$input_file"
```

Use `printf '%s'` for arbitrary strings, not a user-controlled format string.
Quote command substitution and distinguish unset from empty: `${value-default}`
defaults only when unset, `${value:-default}` also defaults when empty, and
`${value:?message}` rejects either. Use an unset-safe expansion with `set -u`.
Never interpolate untrusted input into executable shell text. `--` terminates
options only for commands that support it; otherwise normalize/prefix paths.

For filenames, use `find ... -print0` with a NUL-aware consumer or Bash globs
with an explicit no-match policy (`nullglob` in a controlled scope, or an
existence check). Quoting preserves newlines inside individual arguments;
line-oriented command output does not. Avoid `for f in $(find ...)`.

Command substitution strips trailing newlines. Assign separately from `local`
so a builtin does not hide the producer's status:

```bash
local result rc
if result=$(produce_value); then
    consume_value "$result"
else
    rc=$?
    return "$rc"
fi
```

## Status and pipelines

| Construct | Behavior |
|---|---|
| `a; b` | Runs `b` regardless of `a`'s status |
| `a && b` | Runs `b` only after success |
| `a || b` | Runs `b` only after failure; recovery can mask the original status |
| `a \| b` | Connects stdout; normally reports the final command's status |
| `if command; then ... else ... fi` | Handles expected success/failure explicitly |

With Bash `pipefail`, a pipeline reports its rightmost nonzero status. An
intentional early consumer exit (`head`, `grep -q`) can cause upstream SIGPIPE;
decide whether that outcome is expected instead of ignoring every failure.
Capture `PIPESTATUS` immediately when individual stages matter. Pipeline loops
often execute in subshells, so variable assignments may not survive.
Process-substitution failures are not automatically covered by `pipefail`;
materialize/check the producer first if completeness matters.

`errexit` is suppressed in several conditional contexts, including functions
called as tests. `ERR` traps have similar exceptions; `-E` inherits the trap but
does not make every failure trap. Command-substitution inheritance differs with
shell settings/version. Explicitly check critical commands. `((count++))` returns
failure when its previous value is zero; use `count=$((count + 1))` for arithmetic
that should not influence control flow.

Capture `$?` before another command replaces it. Inside the branch of
`if ! command`, `$?` is the inverted status; use `if command; then ... else rc=$?`
when preserving the original failure. Do not use `|| true` except for a specific,
documented best-effort operation whose failure can safely be ignored.

## Files, processes, environment, and networking

- Inspect/search with targeted reads and the environment's preferred search
  tools. Use `head`, `tail`, `wc`, `sort`, `uniq`, and `awk` for appropriate text
  formats. Use the project's native editor for edits where available; account
  for platform differences before an in-place `sed` transformation.
- Inspect capacity with `df` and `du`; enumerate exact paths before a destructive
  operation. A quoted path prevents splitting, not deletion of the wrong target.
- Inspect processes with `ps`/`pgrep` and listeners with an available `lsof` or
  platform equivalent. Confirm identity and ownership before signaling. `jobs`,
  `fg`, and shell job specifications concern that shell's jobs, not a global task
  manager. Keep `$!` for children launched by the script.
- Use `VAR=value command` for a one-command environment; `export` changes child
  environments for the remaining shell. Inspect only needed variables. Bash
  variables are case-sensitive; avoid clobbering system variables for task data.
- For downloads/API calls, use available `curl` failure handling plus connection
  and total timeouts; verify expected content and authenticity when relevant.
  Store output in a temporary destination until validation succeeds. HTTP 4xx/5xx
  can otherwise appear as successful downloads. Use a JSON encoder or body file
  for complex request data, and do not execute downloaded content implicitly.
- `nc`, `ip`, `ifconfig`, and port probes vary by platform. A reachable port
  does not establish application health or ownership.
