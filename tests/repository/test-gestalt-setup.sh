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

printf 'gestalt setup script is valid\n'
