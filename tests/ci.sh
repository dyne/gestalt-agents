#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

for command_name in bash codex git node npm npx python3 ruby shellcheck; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'CI dependency is missing: %s\n' "$command_name" >&2
    exit 127
  }
done

ci_bun=''
for bun_candidate in \
  "${BUN_INSTALL:-}/bin/bun" \
  "${HOME:?HOME is required}/.bun/bin/bun" \
  "$(command -v bun 2>/dev/null || true)"; do
  if [[ -n "$bun_candidate" && -x "$bun_candidate" ]] && "$bun_candidate" --version >/dev/null 2>&1; then
    ci_bun=$bun_candidate
    break
  fi
done
if [[ -z "$ci_bun" ]]; then
  printf 'CI dependency is missing or broken: bun\n' >&2
  exit 127
fi

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`Node.js 22.5 or newer is required; found ${process.versions.node}`);
    process.exit(1);
  }
'

bash "$root/tests/run.sh"
bash "$root/tests/codex-install-smoke.sh"

(
  cd "$root/plugins/context-mode"
  "$ci_bun" install --frozen-lockfile
  npm test
)

find "$root/tests" -type f -name '*.sh' -exec bash -n {} +
bash -n "$root/gestalt-setup.sh"
bash -n "$root/plugins/gestalt/skills/org-plan/scripts/org-plan"
ruby -c "$root/scripts/validate-codex-packages.rb" >/dev/null
git -C "$root" diff --check

printf 'complete CI validation passed\n'
