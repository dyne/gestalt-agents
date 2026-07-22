#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
vendor=${VENDOR_DIR:-"$root/plugins/context-mode"}
fixture=${FIXTURE:-"$root/tests/plugins/context-mode/fixtures/context-mode-codex-hardening-4b1348d.sha256"}
provenance=${PROVENANCE:-"$root/vendor/context-mode/UPSTREAM.md"}

python3 - "$vendor" "$fixture" "$provenance" <<'PY'
import hashlib
import os
import stat
import sys
from pathlib import Path

vendor, fixture, provenance = map(Path, sys.argv[1:])
pin = "4b1348d4bba530d26cfc73181a0c2f263923e334"
assert vendor.is_dir(), f"missing vendor: {vendor}"
assert fixture.is_file(), f"missing checksum fixture: {fixture}"
assert provenance.is_file(), f"missing provenance: {provenance}"
record = provenance.read_text()
for value in ("https://github.com/mksglu/context-mode", "codex-hardening", pin, "v1.0.169-56-g4b1348d", "Elastic-2.0"):
    assert value in record, f"missing provenance value: {value}"

expected = {}
for line in fixture.read_text().splitlines():
    mode, remainder = line.split(" ", 1)
    digest, relative = remainder.split("  ", 1)
    expected[relative] = (int(mode, 8), digest)

actual = {}
for directory, names, files in os.walk(vendor, followlinks=False):
    names[:] = [name for name in names if name != "node_modules"]
    for name in files:
        path = Path(directory, name)
        relative = str(path.relative_to(vendor))
        metadata = path.lstat()
        assert not stat.S_ISLNK(metadata.st_mode), f"vendored symlink is forbidden: {relative}"
        assert stat.S_ISREG(metadata.st_mode), f"non-regular vendor path: {relative}"
        actual[relative] = (stat.S_IMODE(metadata.st_mode), hashlib.sha256(path.read_bytes()).hexdigest())

assert actual == expected, (
    f"vendor differs from checksum: missing={sorted(expected.keys() - actual.keys())[:5]}, "
    f"extra={sorted(actual.keys() - expected.keys())[:5]}, "
    f"changed={[key for key in actual.keys() & expected.keys() if actual[key] != expected[key]][:5]}"
)
assert len(actual) == 609, f"expected 609 vendor files, found {len(actual)}"
assert sum(mode == 0o755 for mode, _ in actual.values()) == 15, "unexpected executable file count"
print("context-mode upstream vendor integrity is valid")
PY

test "${TEST_DRIFT_CASE:-0}" = 1 && exit 0

tmp=$(mktemp -d "${TMPDIR:-/tmp}/context-mode-vendor-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cp -a "$vendor" "$tmp/vendor"

expect_failure() {
  if TEST_DRIFT_CASE=1 VENDOR_DIR="$tmp/vendor" "$0" >"$tmp/out" 2>"$tmp/err"; then
    printf 'integrity test unexpectedly accepted: %s\n' "$1" >&2
    exit 1
  fi
}

rm "$tmp/vendor/LICENSE"
expect_failure deleted-file
cp -a "$vendor" "$tmp/vendor"
printf 'unexpected\n' >"$tmp/vendor/added-file"
expect_failure added-file
cp -a "$vendor" "$tmp/vendor"
printf 'changed\n' >>"$tmp/vendor/LICENSE"
expect_failure changed-content
cp -a "$vendor" "$tmp/vendor"
chmod 755 "$tmp/vendor/LICENSE"
expect_failure changed-mode
cp -a "$vendor" "$tmp/vendor"
rm "$tmp/vendor/LICENSE"
ln -s package.json "$tmp/vendor/LICENSE"
expect_failure symlink

printf 'context-mode upstream vendor drift checks are valid\n'
