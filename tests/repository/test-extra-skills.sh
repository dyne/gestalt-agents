#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
setup="$root/gestalt-setup.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/extra-skills-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/bin" "$tmp/home"

cat >"$tmp/bin/node" <<'SH'
#!/usr/bin/env bash
case ${1:-} in
  -p) printf '22.12.0\n' ;;
  -e) printf 'dyne-gestalt-agents' ;;
esac
SH
cat >"$tmp/bin/npm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat >"$tmp/bin/codex" <<'SH'
#!/usr/bin/env bash
if [[ $* == 'plugin marketplace list' ]]; then
  printf 'Marketplace  Path\n'
fi
SH
cat >"$tmp/bin/npx" <<'SH'
#!/usr/bin/env bash
mkdir -p "$PWD/.agents/skills/mock-skill"
printf '%s|%s|' "$PWD" "$HOME" >>"$NPX_LOG"
printf '<%s>' "$@" >>"$NPX_LOG"
printf '\n' >>"$NPX_LOG"
SH
chmod +x "$tmp/bin/node" "$tmp/bin/npm" "$tmp/bin/codex" "$tmp/bin/npx"

gestalt_home="$tmp/gestalt home"
log="$tmp/npx.log"
output=$(CODEX_HOME="$tmp/codex-home" GESTALT_HOME="$gestalt_home" \
  HOME="$tmp/home" NPX_LOG="$log" PATH="$tmp/bin:$PATH" \
  bash "$setup" --extra-skills)

[[ -d $gestalt_home ]] || fail "setup did not prepare GESTALT_HOME"
[[ $output == *"curated extra skills installed under $gestalt_home"* ]] ||
  fail "setup did not report the extra-skills destination"
[[ -L $tmp/codex-home/skills/mock-skill ]] ||
  fail "setup did not expose managed skills in CODEX_HOME"
[[ $(readlink "$tmp/codex-home/skills/mock-skill") == \
  "$gestalt_home/.agents/skills/mock-skill" ]] ||
  fail "CODEX_HOME skill link does not target GESTALT_HOME"

call_count=0
while IFS= read -r call; do
  ((call_count += 1))
  [[ $call == "$gestalt_home|$tmp/home|<skills><add>"* ]] ||
    fail "npx ran outside GESTALT_HOME or with the wrong command: $call"
  [[ $call == *"<-a><codex><-y>" ]] ||
    fail "Codex/non-interactive arguments are missing: $call"
  [[ $call != *"<-g>"* && $call != *"<--global>"* ]] ||
    fail "global scope escaped GESTALT_HOME: $call"
done <"$log"
[[ $call_count -eq 25 ]] || fail "expected 25 repository installs, found $call_count"

if GESTALT_HOME=relative HOME="$tmp/home" PATH="$tmp/bin:$PATH" \
  bash "$setup" --extra-skills >"$tmp/relative.out" 2>"$tmp/relative.err"; then
  fail "relative GESTALT_HOME was accepted"
fi
if GESTALT_HOME=/ HOME="$tmp/home" PATH="$tmp/bin:$PATH" \
  bash "$setup" --extra-skills >"$tmp/root.out" 2>"$tmp/root.err"; then
  fail "root GESTALT_HOME was accepted"
fi

printf 'integrated extra skills install is confined to GESTALT_HOME\n'
