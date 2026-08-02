#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
script="$root/gestalt-setup.sh"

bash -n "$script"
help=$(bash "$script" --help)
[[ $help == *"--prepare-only"* ]]
[[ $help == *"--dry-run"* ]]
output=$(bash "$script" --prepare-only --dry-run)
[[ $output == *"prepare-runtime.mjs"* ]]
[[ $output == *"context-mode source is prepared"* ]]

tmp=$(mktemp -d "${TMPDIR:-/tmp}/gestalt-setup-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
output=$(env -u CODEX_HOME HOME="$tmp" bash "$script" --dry-run)
[[ $output == *"$tmp/.codex-gestalt"* ]]
[[ $output == *"prepare-supervision"* ]]
[[ $output == *"org-plan-supervisor.toml"* ]]
[[ ! -e $tmp/.codex-gestalt ]]

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
delegated=$(CODEX_HOME="$tmp/delegated-home" PATH="$tmp/bin:$PATH" bash "$script" --force)
[[ $delegated == *"continuing from configured marketplace $configured"* ]]
[[ $delegated == *"delegated home=$tmp/delegated-home args=<--force>"* ]]

printf 'gestalt setup script is valid\n'
