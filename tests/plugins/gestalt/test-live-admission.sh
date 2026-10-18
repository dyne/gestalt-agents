#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
# The source guard intentionally refuses ancestry metadata changes. Separate
# files create/remove /tmp fixture roots, so run them sequentially rather than
# making one file's setup race another file's protected-directory observation.
node --test --test-concurrency=1 "$root/tests/plugins/gestalt/test-live-admission.mjs" "$root/tests/plugins/gestalt/test-live-installed-source.mjs" "$root/tests/plugins/gestalt/test-live-byte-observation.mjs"
