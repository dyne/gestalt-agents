#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
node --test --test-reporter=tap "$root/tests/repository/test-native-setup.mjs" "$root/tests/repository/test-native-helpers.mjs"
