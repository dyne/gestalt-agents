#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
python3 - "$root/plugins/gestalt/skills/impeccable" <<'PY'
import re
import sys
from pathlib import Path

skill = Path(sys.argv[1])
entry = (skill / 'SKILL.md').read_text()
native = ' '.join((skill / 'reference/native-session.md').read_text().split())
# Static instruction scenarios check the route available to an agent before
# context loading. They do not claim model execution or native runtime proof.
assert entry.index('reference/native-session.md') < entry.index('## Setup')
for route in ('live', 'generate', 'live-setup'):
    text = (skill / f'reference/{route}.md').read_text()
    assert '[native-session.md](native-session.md)' in text
    assert 'second CLI poll loop' in text
scenarios = {
    'absent runtime': ('gestalt impeccable status --json', 'missing/disabled',
                       'Ordinary design work', 'without a runtime'),
    'no Caddy': ('Missing Caddy', 'leave Live unavailable', 'Never edit /etc'),
    'active Live': ('exclusive ownership', 'Ordinary chat, Autopilot, Org continuations',
                    'sole canonical poll owner', 'without a model'),
    'interrupted acceptance': ('recoveryRequired', 'journal/source',
                               'Never manually delete locks', 'or replay the edit',
                               'stopped generation'),
    'pre-existing skill': ('standalone', 'never deletes skills',
                           'silently disables another plugin', 'explicitly removes/disables'),
}
for name, obligations in scenarios.items():
    for obligation in obligations:
        assert obligation in native, f'{name}: missing guidance {obligation}'
    print(f'instruction scenario passed: {name}')
for suffix in ('targets', 'start', 'stop', 'resume', 'launch-grants'):
    assert f'/api/sessions/:relayId/live/{suffix}' in native
for obligation in ('operationId', 'codeChallengeMethod:"S256"', 'LIVE_GENERATION_STALE',
                   'IMPECCABLE_LIVE_COPY_AGENT=chat', 'effective permissions',
                   'No Playwright MCP is required', 'untrusted task data'):
    assert obligation in native
assert not re.search(r'(?m)^\s*(?:sudo |.*impeccable live-poll\s*(?:#|$))', native)
assert (skill / 'reference/craft-floor.md').is_file()
assert (skill / 'reference/new-work.md').is_file()
PY
