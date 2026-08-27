#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
skill="$root/plugins/gestalt/skills/context-mode/SKILL.md"
passes=0

expect() {
  grep -F -- "$1" "$skill" >/dev/null || {
    printf 'missing routing scenario: %s\n' "$1" >&2
    exit 1
  }
  passes=$((passes + 1))
}

# Native small-edit and continuation scenarios.
expect 'available native `read_file`'
expect 'native `create_file`, `edit_file`, or `apply_patch`'
expect 'native `exec_command`'
expect 'native `write_stdin`'
expect 'native `view_image`'

# Large-analysis, corpus, and external-documentation scenarios.
expect 'One uncertain or large command, API, test, build, or log analysis | `ctx_execute`'
expect 'One large file analysis without loading it in full | `ctx_execute_file`'
expect 'Several independent large inspections | `ctx_batch_execute`'
expect 'Durable local corpus for later retrieval | `ctx_index`'
expect 'Indexed follow-up or session-memory query | `ctx_search`'
expect 'External documentation to retrieve repeatedly | `ctx_fetch_and_index`'

# Policy negatives: aliases, raw dumps, context-mode writes, and shell writes.
expect 'Do not invent aliases.'
expect 'Do not print an entire JSON object, file, page,'
expect 'Context-mode never writes and never authorizes a mutation'
expect 'Do not use shell write tricks when a'

printf 'context-mode routing scenarios passed: %s\n' "$passes"
