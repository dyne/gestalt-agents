#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/agent-plugins-skills-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/repository/plugins"
python3 - "$root" "$tmp/repository" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys

source, target = map(Path, sys.argv[1:])
paths = subprocess.check_output(["git", "-C", str(source), "ls-files", "--cached",
                                 "--others", "--exclude-standard", "-z", "--", "plugins/gestalt"])
for name in filter(None, paths.decode().split("\0")):
    path = source / name
    if path.is_file():
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination, follow_symlinks=False)
PY

python3 - "$tmp/repository/plugins/gestalt/skills" <<'PY'
from pathlib import Path
import re
import sys

skills = Path(sys.argv[1])
# New conditional instructions must resolve in the distributable tree as well
# as the working checkout. Discovery must not depend on development fixtures.
for entry in [skills / "org-plan/SKILL.md", skills / "context-mode/SKILL.md",
              skills / "ctx-search/SKILL.md",
              skills / "playwright/SKILL.md",
              skills / "playwright/references/lifecycle.md",
              skills / "org-plan/references/plan-format.md",
              skills / "org-plan/references/supervised-execution.md"]:
    for target in re.findall(r"\]\(([^)]+)\)", entry.read_text()):
        if "://" not in target:
            relative = target.split("#", 1)[0]
            destination = entry.parent / relative if relative else entry
            assert destination.is_file(), (entry, target)
PY

test "$(sed -n 's/^  allow_implicit_invocation: //p' "$tmp/repository/plugins/gestalt/skills/org-plan/agents/openai.yaml")" = true
test "$(sed -n 's/^  allow_implicit_invocation: //p' "$tmp/repository/plugins/gestalt/skills/self-debug/agents/openai.yaml")" = true

output=$(NO_COLOR=1 npx --yes skills@1.5.18 add "$tmp/repository" --list 2>&1)

python3 - "$output" <<'PY'
import collections
import re
import sys

expected = {
    "coding",
    "security",
    "scripting",
    "context-mode",
    "ctx-doctor",
    "ctx-index",
    "ctx-insight",
    "ctx-purge",
    "ctx-search",
    "ctx-stats",
    "ctx-upgrade",
    "development-testing",
    "org-plan",
    "self-debug",
    "systematic-debugging",
    "verification-before-completion",
    "writing-skills",
    "xerj",
    "serena",
    "playwright",
}
clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", sys.argv[1])
# skills uses either Unicode box drawing or an ASCII pipe depending on terminal
# capabilities even with NO_COLOR. Both are presentation-only variants.
names = re.findall(r"^[│|]    ([a-z0-9][a-z0-9-]*)$", clean, re.MULTILINE)
counts = collections.Counter(names)
assert set(names) == expected, f"unexpected discovered skills: {names}"
assert all(count == 1 for count in counts.values()), (
    f"duplicate discovered skills: {counts}"
)
PY

printf 'npx skills discovers all Gestalt-provided skills\n'
