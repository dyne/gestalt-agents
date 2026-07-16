#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
vendor="$root/plugins/superpowers/skills"
manifest="$root/tests/fixtures/superpowers-6.1.1-dyne.2.sha256"

python3 - "$root" "$vendor" "$manifest" <<'PY'
import hashlib
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
vendor = Path(sys.argv[2])
manifest = Path(sys.argv[3])
assert not (root / "skills").exists(), "root skills copy must not exist"

expected = {}
for line in manifest.read_text().splitlines():
    mode, remainder = line.split(" ", 1)
    digest, relative = remainder.split("  ", 1)
    expected[relative] = (int(mode, 8), digest)

actual = {}
for path in vendor.rglob("*"):
    assert not path.is_symlink(), f"vendored symlink is forbidden: {path}"
    if path.is_file():
        actual[str(path.relative_to(vendor))] = (
            stat.S_IMODE(path.lstat().st_mode),
            hashlib.sha256(path.read_bytes()).hexdigest(),
        )
assert actual.keys() == expected.keys(), (
    f"vendored file set differs: missing={sorted(expected.keys() - actual.keys())}, "
    f"extra={sorted(actual.keys() - expected.keys())}"
)
for relative, metadata in expected.items():
    assert actual[relative] == metadata, f"mode or content differs: {relative}"
PY

printf 'adapted superpowers package integrity is valid\n'
