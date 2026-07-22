#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/test-runner.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
fixture_root="$tmp/fixture root"

mkdir -p "$fixture_root/tests/repository" "$fixture_root/tests/plugins/gestalt" "$fixture_root/tests/plugins/context-mode"
cp "$root/tests/run.sh" "$fixture_root/tests/run.sh"
chmod +x "$fixture_root/tests/run.sh"

write_test() {
  local path=$1 body=$2
  printf '#!/usr/bin/env bash\n%s\n' "$body" >"$path"
  chmod +x "$path"
}

write_test "$fixture_root/tests/repository/test-b.sh" 'printf repo-b'
write_test "$fixture_root/tests/repository/test-a.sh" 'printf repo-a'
write_test "$fixture_root/tests/plugins/gestalt/test-a.sh" 'printf gestalt-a'
write_test "$fixture_root/tests/plugins/context-mode/test-a.sh" 'printf context-a'

output=$(bash "$fixture_root/tests/run.sh")
expected=$'[repository] tests/repository/test-a.sh\nrepo-a[repository] tests/repository/test-b.sh\nrepo-b[gestalt] tests/plugins/gestalt/test-a.sh\ngestalt-a[context-mode] tests/plugins/context-mode/test-a.sh\ncontext-a'
test "$output" = "$expected"

write_test "$fixture_root/tests/repository/test-c.sh" 'exit 7'
if bash "$fixture_root/tests/run.sh" >"$tmp/out" 2>"$tmp/err"; then
  printf 'runner must stop on a failing test\n' >&2
  exit 1
fi
test "$(cat "$tmp/out")" = $'[repository] tests/repository/test-a.sh\nrepo-a[repository] tests/repository/test-b.sh\nrepo-b[repository] tests/repository/test-c.sh'
test "$(cat "$tmp/err")" = ''

printf 'test runner contract is valid\n'
