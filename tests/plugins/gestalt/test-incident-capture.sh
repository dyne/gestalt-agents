#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
python3 "$root/tests/plugins/gestalt/incident-capture-fixtures.py" \
  "$root/plugins/gestalt/skills/self-debug/scripts/capture-incident.py" \
  "$root/plugins/gestalt/skills/self-debug/scripts/summarize-incident.py"
