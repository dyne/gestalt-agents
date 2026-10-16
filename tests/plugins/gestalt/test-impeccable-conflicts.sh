#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/impeccable-conflicts.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
node --input-type=module - "$root" "$tmp" <<'JS'
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, tmp] = process.argv.slice(2);
const { impeccableConflicts } = await import(pathToFileURL(join(root, 'plugins/gestalt/scripts/check-impeccable-conflicts.mjs')));
const paths = { home: join(tmp, 'home'), codexHome: join(tmp, 'profile with spaces'), gestaltHome: join(tmp, 'gestalt'), cwd: join(tmp, 'workspace/app') };
for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });
assert.deepEqual(impeccableConflicts(paths), []);
for (const directory of [join(paths.home, '.agents/skills'), join(paths.codexHome, 'skills'), join(paths.gestaltHome, '.agents/skills'), join(tmp, 'workspace/.agents/skills')]) {
  const skill = join(directory, 'renamed-provider/SKILL.md');
  mkdirSync(join(directory, 'renamed-provider'), { recursive: true });
  const original = '---\nname: impeccable\ndescription: Original standalone skill.\n---\n';
  writeFileSync(skill, original);
  assert.ok(impeccableConflicts(paths).includes(skill));
  assert.equal(readFileSync(skill, 'utf8'), original);
  rmSync(join(directory, 'renamed-provider'), { recursive: true });
}
const config = join(paths.codexHome, 'config.toml');
for (const quote of ['"', "'"]) {
  const original = `[plugins.${quote}impeccable@custom${quote}]\nenabled = true\n[plugins."other@custom"]\nenabled = false\n`;
  writeFileSync(config, original);
  assert.equal(impeccableConflicts(paths).length, 1);
  assert.equal(readFileSync(config, 'utf8'), original);
}
writeFileSync(config, '[plugins."impeccable@custom"]\nenabled = false # explicit operator choice\n');
assert.deepEqual(impeccableConflicts(paths), []);
console.log('standalone skill/plugin conflicts detected without modifying either provider');
JS
mkdir -p "$tmp/bin" "$tmp/setup-home/.agents/skills/impeccable"
printf '%s\n' '---' 'name: impeccable' 'description: Existing skill.' '---' >"$tmp/setup-home/.agents/skills/impeccable/SKILL.md"
cat >"$tmp/bin/codex" <<'SH'
#!/bin/sh
printf 'unexpected plugin mutation\n' >>"$TEST_CODEX_LOG"
exit 99
SH
chmod 755 "$tmp/bin/codex"
if HOME="$tmp/setup-home" CODEX_HOME="$tmp/setup-profile" GESTALT_HOME="$tmp/setup-gestalt" \
  TEST_CODEX_LOG="$tmp/codex.log" PATH="$tmp/bin:$PATH" \
  bash "$root/gestalt-setup.sh" >"$tmp/out" 2>"$tmp/err"; then
  printf 'setup accepted competing standalone instructions\n' >&2; exit 1
fi
test ! -e "$tmp/codex.log"
grep -F 'standalone Impeccable conflicts' "$tmp/err" >/dev/null
grep -F 'Choose one provider' "$tmp/err" >/dev/null
printf 'installer stops before plugin installation on a standalone conflict\n'
