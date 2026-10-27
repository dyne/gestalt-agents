#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd -P)
python3 "$root/tests/plugins/gestalt/engineering-skills.py" "$root"
