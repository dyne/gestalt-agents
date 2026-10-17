#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
launcher="$root/plugins/gestalt/skills/impeccable/scripts/impeccable"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/impeccable-launcher.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/bin" "$tmp/runtime with spaces"
cat >"$tmp/bin/gestalt" <<'SH'
#!/bin/sh
test "$*" = 'impeccable path' || exit 99
test "${TEST_MISSING:-0}" = 0 || exit 7
printf '%s\n' "$TEST_ENGINE"
SH
cat >"$tmp/runtime with spaces/impeccable" <<'SH'
#!/bin/sh
printf '%s\n' "$IMPECCABLE_SKILL_DIR" "$IMPECCABLE_SELF" "$@"
SH
chmod 755 "$tmp/bin/gestalt" "$tmp/runtime with spaces/impeccable"
export TEST_ENGINE="$tmp/runtime with spaces/impeccable"
export PATH="$tmp/bin:$PATH"
output=$(IMPECCABLE_BIN=/untrusted/override "$launcher" context --target 'app with spaces')
expected=$(printf '%s\n' "$root/plugins/gestalt/skills/impeccable" "$launcher" context --target 'app with spaces')
test "$output" = "$expected"
if TEST_MISSING=1 "$launcher" context >"$tmp/out" 2>"$tmp/err"; then
  printf 'missing managed runtime was accepted\n' >&2; exit 1
else
  test "$?" = 7
fi
if TEST_ENGINE=relative "$launcher" context >"$tmp/out" 2>"$tmp/err"; then
  printf 'relative managed executable was accepted\n' >&2; exit 1
fi
for command in live live-poll live-accept livefoo generate hooks hook-admin hook-before-edit pin install update skills link --cwd --; do
  if "$launcher" "$command" >"$tmp/out" 2>"$tmp/err"; then
    printf 'unmanaged side effect accepted: %s\n' "$command" >&2; exit 1
  fi
  test ! -s "$tmp/out"
done
# The pinned native parser dispatches its first token, not a later global verb.
# The wrapper rejects unsupported leading forms before resolving any engine.
if TEST_MISSING=1 "$launcher" --cwd "$tmp" live-poll >"$tmp/out" 2>"$tmp/err"; then
  printf 'leading option reached a controller\n' >&2; exit 1
else
  test "$?" = 2
fi
for flag in --help -h --version -v; do
  output=$("$launcher" "$flag" live-poll)
  test "$output" = "$(printf '%s\n' "$root/plugins/gestalt/skills/impeccable" "$launcher" "$flag" live-poll)"
done
printf 'Impeccable launcher uses only managed runtime and rejects duplicate controllers\n'
