#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$root/gestalt-setup.sh"

bash -n "$script"
help=$(bash "$script" --help)
[[ $help == *"--prepare-only"* ]]
[[ $help == *"--dry-run"* ]]
output=$(bash "$script" --prepare-only --dry-run)
[[ $output == *"prepare-runtime.mjs"* ]]
[[ $output == *"context-mode source is prepared"* ]]

printf 'gestalt setup script is valid\n'
