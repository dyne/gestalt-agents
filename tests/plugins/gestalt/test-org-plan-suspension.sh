#!/usr/bin/env bash
set -Eeuo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
node "$root/tests/plugins/gestalt/test-org-plan-suspension.mjs"

# macOS /var resolves to /private/var. Exercise an aliased temporary parent on
# every platform so status assertions always compare canonical fixture paths.
temporary=$(mktemp -d "${TMPDIR:-/tmp}/org-suspension-parent.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
mkdir -- "$temporary/real"
ln -s -- "$temporary/real" "$temporary/alias"
TMPDIR="$temporary/alias" node "$root/tests/plugins/gestalt/test-org-plan-suspension.mjs"
