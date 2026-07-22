#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
script="$root/plugins/gestalt/skills/org-plan/scripts/org-plan"

command -v shellcheck >/dev/null 2>&1 || {
  printf 'shellcheck is required\n' >&2
  exit 127
}

shellcheck -S info "$script"
printf 'org-plan shellcheck passed\n'
