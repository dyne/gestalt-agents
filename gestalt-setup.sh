#!/usr/bin/env bash
# Unix compatibility adapter; Node owns the setup transaction on every platform.
set -Eeuo pipefail
script_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec node "$script_dir/gestalt-setup.mjs" "$@"
