#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
node --test "$root/tests/plugins/gestalt/test-live-admission.mjs"
