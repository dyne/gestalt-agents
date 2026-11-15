#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
# Exercise the real Node entry point with isolated profiles and explicit npx
# fixtures. The native suite runs the same contract on all target systems.
node --test --test-reporter=tap --test-name-pattern="optional skills" \
  "$root/tests/repository/test-native-setup.mjs"
