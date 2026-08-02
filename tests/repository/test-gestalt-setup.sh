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
[[ $output == *"validate required Gestalt settings"* ]]
[[ ! -e $tmp/.codex-gestalt ]]

invalid_home="$tmp/invalid"
mkdir -p "$invalid_home"
printf '[agents]\nmax_depth = 2\n\n[features]\nplugin_hooks = true\nhooks = true\n' >"$invalid_home/config.toml"
before=$(cksum "$invalid_home/config.toml")
if CODEX_HOME="$invalid_home" bash "$script" >"$tmp/out" 2>"$tmp/err"; then
  printf 'setup accepted an invalid existing configuration\n' >&2
  exit 1
fi
[[ $before == "$(cksum "$invalid_home/config.toml")" ]]
grep -F 'required setting differs' "$tmp/err" >/dev/null
grep -F 'existing Codex configuration was left unchanged' "$tmp/err" >/dev/null

printf 'gestalt setup script is valid\n'
