#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

run_group() {
  local owner=$1 directory=$2 test_file

  while IFS= read -r -d '' test_file; do
    printf '[%s] %s\n' "$owner" "${test_file#"$root/"}"
    bash "$test_file"
  done < <(find "$directory" -maxdepth 1 -type f -name 'test-*.sh' -print0 | sort -z)
}

run_group repository "$root/tests/repository"
run_group gestalt "$root/tests/plugins/gestalt"
run_group context-mode "$root/tests/plugins/context-mode"
