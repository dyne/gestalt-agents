#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
node "$root/tests/plugins/gestalt/test-org-plan-mcp.mjs"
