#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
python3 - "$root" <<'PY'
import hashlib
import re
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
package = root / 'plugins/gestalt/skills/impeccable'
fixture = root / 'tests/plugins/gestalt/fixtures/impeccable-gestalt.sha256'
expected = {}
for line in fixture.read_text().splitlines():
    mode, remainder = line.split(' ', 1)
    digest, relative = remainder.split('  ', 1)
    assert relative not in expected, f'duplicate checksum path: {relative}'
    expected[relative] = (int(mode, 8), digest)
actual = {}
for path in package.rglob('*'):
    metadata = path.lstat()
    assert not stat.S_ISLNK(metadata.st_mode), f'symlink forbidden: {path}'
    if stat.S_ISDIR(metadata.st_mode):
        continue
    assert stat.S_ISREG(metadata.st_mode), f'regular file required: {path}'
    relative = path.relative_to(package).as_posix()
    actual[relative] = (stat.S_IMODE(metadata.st_mode), hashlib.sha256(path.read_bytes()).hexdigest())
    if path.suffix == '.md':
        for target in re.findall(r'\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)', path.read_text()):
            target = target.split('#')[0]
            if not target or re.match(r'[a-z]+:', target):
                continue
            resolved = (path.parent / target).resolve()
            assert resolved.is_relative_to(package.resolve()), f'escaping link: {path}: {target}'
            assert resolved.is_file(), f'missing relative resource: {path}: {target}'
assert actual == expected, 'adapted package paths, contents or modes differ from checksum fixture'
assert actual['scripts/impeccable'][0] == 0o755
assert not (root / 'skills').exists(), 'duplicate root skill container'
assert [p for p in (root / 'plugins').glob('*/skills/impeccable/SKILL.md')] == [package / 'SKILL.md']
for required in ('LICENSE', 'NOTICE.md', 'UPSTREAM.md', 'agents/openai.yaml',
                 'reference/ios.md', 'reference/android.md', 'reference/craft-floor.md',
                 'scripts/live-browser.js', 'scripts/modern-screenshot.umd.js',
                 'scripts/data/font-index.json'):
    assert required in actual, f'missing required packaged resource: {required}'
record = (package / 'UPSTREAM.md').read_text()
for identity in ('778c8a7b71ccd5bfe3ca6ac68c15d9d872d0f87d',
                 'b593626bffd40e404c9e8b7972628660e210dbf4',
                 '4.1.0-gestalt.1', 'gestalt-live-1', '0.1.11', '4.0.0', 'Apache-2.0'):
    assert identity in record, f'missing compatibility/provenance identity: {identity}'
assert 'Apache License' in (package / 'LICENSE').read_text()
assert 'ehmo' in (package / 'NOTICE.md').read_text()
print(f'Impeccable package integrity, modes and relative resources passed ({len(actual)} files)')
PY
ruby "$root/scripts/validate-codex-packages.rb" "$root/plugins/gestalt"
