#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
node --test "$root/tests/repository/test-managed-runtime.mjs"
