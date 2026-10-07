#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
python3 "$root/tests/plugins/gestalt/test-execution-scenarios.py" "$root"
