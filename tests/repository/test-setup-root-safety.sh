#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/setup-root-safety.XXXXXX")
tmp=$(CDPATH='' cd -- "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/home" "$tmp/bin" "$tmp/inherited/bin" \
  "$tmp/inherited/plugins/cache/dyne-gestalt-agents/context-mode/2.5.4"
printf 'sentinel config\n' >"$tmp/inherited/config.toml"
printf 'sentinel launcher\n' >"$tmp/inherited/bin/context-mode-mcp.mjs"
printf 'sentinel plugin\n' >"$tmp/inherited/plugins/cache/dyne-gestalt-agents/context-mode/2.5.4/start.mjs"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
snapshot() {
  python3 - "$1" <<'PY'
import hashlib, json, os, stat, sys
from pathlib import Path
root = Path(sys.argv[1])
entries = []
for directory, names, files in os.walk(root, followlinks=False):
    for name in sorted(names + files):
        path = Path(directory, name)
        info = path.lstat()
        payload = os.readlink(path) if path.is_symlink() else (
            hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None)
        entries.append((str(path.relative_to(root)), stat.S_IMODE(info.st_mode), payload))
print(json.dumps(sorted(entries)))
PY
}

# Reproduce the caller's exported-profile environment using only a disposable
# sentinel. The nested suite must isolate every positive and negative setup.
export CODEX_HOME="$tmp/inherited"
before=$(snapshot "$CODEX_HOME")
GESTALT_HOME="$tmp/caller-gestalt" HOME="$tmp/home" \
  bash "$root/tests/repository/test-extra-skills.sh" >"$tmp/nested.log" 2>&1
[[ $(snapshot "$CODEX_HOME") == "$before" ]] ||
  fail "extra-skills suite changed its caller's exported CODEX_HOME"

for tool in node npm npx codex install; do
  cat >"$tmp/bin/$tool" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "${0##*/}" >>"$UNEXPECTED_SETUP_LOG"
exit 97
SH
  chmod +x "$tmp/bin/$tool"
done
ln -s / "$tmp/root-link"
# Resolve through a known root symlink; /tmp/.. is /private on macOS.
missing_to_root="$tmp/never-created/.."
ancestor=$tmp
while [[ -n $ancestor ]]; do
  missing_to_root+=/..
  ancestor=${ancestor%/*}
done
unsafe=(relative / // /./ "$tmp/root-link/./.." "$tmp/root-link" "$tmp/root-link/." \
  "$tmp/root-link/../" "$missing_to_root")
case_count=0
for destination in "${unsafe[@]}"; do
  for mode in normal --prepare-only --extra-skills --extra-skills-only --dry-run; do
    args=()
    [[ $mode == normal ]] || args+=("$mode")
    if GESTALT_HOME="$destination" HOME="$tmp/home" \
      UNEXPECTED_SETUP_LOG="$tmp/tools.log" PATH="$tmp/bin:$PATH" \
      bash "$root/gestalt-setup.sh" "${args[@]}" >"$tmp/out" 2>"$tmp/err"; then
      fail "accepted unsafe GESTALT_HOME=$destination ($mode)"
    fi
    [[ ! -e $tmp/tools.log ]] || fail "unsafe root invoked setup tools ($destination, $mode)"
    [[ $(snapshot "$CODEX_HOME") == "$before" ]] || fail "unsafe root changed sentinel profile"
    [[ ! -e $tmp/never-created ]] || fail "validation created a destination ancestor"
    ((case_count += 1))
  done
done

# A missing profile must not be created before root validation either.
if CODEX_HOME="$tmp/uncreated-profile" GESTALT_HOME=/ HOME="$tmp/home" \
  UNEXPECTED_SETUP_LOG="$tmp/tools.log" PATH="$tmp/bin:$PATH" \
  bash "$root/gestalt-setup.sh" --extra-skills-only >"$tmp/out" 2>"$tmp/err"; then
  fail "accepted root with missing profile"
fi
[[ ! -e $tmp/uncreated-profile && ! -e $tmp/tools.log ]] ||
  fail "unsafe root created a profile or invoked a setup tool"
printf 'setup root safety: %s invalid-root/mode cases; inherited profile untouched\n' "$case_count"
