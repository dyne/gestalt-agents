#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
node --test "$root/tests/repository/test-setup-api.mjs" "$root/tests/repository/test-setup-command-port.mjs" "$root/tests/repository/test-setup-rpc.mjs"
