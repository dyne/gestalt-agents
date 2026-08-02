#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
script="$root/gestalt-setup.sh"

assert_contains() {
  local actual=$1 expected=$2 contract=$3
  if [[ $actual != *"$expected"* ]]; then
    printf 'FAIL: %s\nexpected output to contain: %s\nactual output:\n%s\n' \
      "$contract" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_absent() {
  local path=$1 contract=$2
  if [[ -e $path ]]; then
    printf 'FAIL: %s\nunexpected path exists: %s\n' "$contract" "$path" >&2
    exit 1
  fi
}

bash -n "$script"
help=$(bash "$script" --help)
assert_contains "$help" "--prepare-only" "help documents prepare-only"
assert_contains "$help" "--dry-run" "help documents dry-run"
output=$(bash "$script" --prepare-only --dry-run)
assert_contains "$output" "install-runtime.mjs" "prepare-only invokes the external runtime installer"
assert_contains "$output" "context-mode external runtime is prepared" "prepare-only reports success"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/gestalt-setup-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
tmp_real=$(CDPATH='' cd -- "$tmp" && pwd -P)
output=$(env -u CODEX_HOME HOME="$tmp" bash "$script" --dry-run)
assert_contains "$output" "$tmp/.codex-gestalt" "dry-run uses the isolated default Codex home"
assert_contains "$output" "prepare-supervision" "dry-run prepares supervision profiles"
assert_contains "$output" "org-plan-supervisor.toml" "dry-run removes the retired supervisor profile"
assert_absent "$tmp/.codex-gestalt" "dry-run does not create the Codex home"

configured="$tmp/configured marketplace"
mkdir -p "$configured" "$tmp/bin"
cat >"$configured/gestalt-setup.sh" <<'SH'
#!/usr/bin/env bash
printf 'delegated home=%s args=' "$CODEX_HOME"
printf '<%s>' "$@"
printf '\n'
SH
cat >"$tmp/bin/codex" <<SH
#!/usr/bin/env bash
if [[ \$* == 'plugin marketplace list' ]]; then
  printf 'Marketplace  Path\n'
  printf 'dyne-gestalt-agents  %s\n' '$configured'
  exit 0
fi
exit 99
SH
chmod +x "$configured/gestalt-setup.sh" "$tmp/bin/codex"
configured_real=$(CDPATH='' cd -- "$configured" && pwd -P)
delegated=$(CODEX_HOME="$tmp/delegated-home" PATH="$tmp/bin:$PATH" bash "$script" --force)
assert_contains "$delegated" "continuing from configured marketplace $configured_real" \
  "setup delegates to the canonical configured marketplace"
assert_contains "$delegated" "delegated home=$tmp_real/delegated-home args=<--force>" \
  "setup preserves Codex home and arguments while delegating"

printf 'gestalt setup script is valid\n'
