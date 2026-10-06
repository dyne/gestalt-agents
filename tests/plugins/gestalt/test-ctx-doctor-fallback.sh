#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd -P)
bridge="$root/plugins/gestalt/scripts/ctx-doctor.mjs"
version=$(node -p "require('$root/plugins/gestalt/.codex-plugin/plugin.json').version")
tmp=$(mktemp -d "${TMPDIR:-/tmp}/gestalt-ctx-doctor-test.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
runtime="$tmp/runtime/context-mode"
mkdir -p -- "$runtime" "$tmp/bin"

cat > "$tmp/bin/codex" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
IFS= read -r initialize
printf '%s\n' '{"id":1,"result":{}}'
IFS= read -r initialized
IFS= read -r request
response=$(REQUEST="$request" node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const request = JSON.parse(process.env.REQUEST);
  const root = process.env.TEST_GESTALT_PLUGIN_ROOT;
  const wrongVersion = process.env.TEST_WRONG_GESTALT_VERSION === "1";
  const omittedSkill = process.env.TEST_OMIT_GESTALT_SKILL;
  const skills = fs.readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name !== omittedSkill)
    .map((entry) => ({
      name: `gestalt:${entry.name}`,
      description: entry.name,
      path: wrongVersion
        ? path.join(path.dirname(root), "0.0.0", "skills", entry.name, "SKILL.md")
        : path.join(root, "skills", entry.name, "SKILL.md"),
      enabled: true,
    }));
  process.stdout.write(JSON.stringify({
    id: 2,
    result: { data: [{ cwd: request.params.cwds[0], skills, errors: [] }] },
  }));
' </dev/null)
printf '%s\n' "$response"
sleep 60
EOF
chmod +x "$tmp/bin/codex"

cat > "$runtime/cli.bundle.mjs" <<'EOF'
#!/usr/bin/env node
if (process.argv[2] !== 'doctor') process.exit(91);
if (process.env.CONTEXT_MODE_WORKSPACE !== process.cwd()) process.exit(92);
process.stdout.write('[OK] bridged context-mode doctor\n');
EOF

output=$(env -u CONTEXT_MODE_WORKSPACE \
  PATH="$tmp/bin:$PATH" \
  TEST_GESTALT_PLUGIN_ROOT="$root/plugins/gestalt" \
  GESTALT_HOME="$tmp" node "$bridge")
[[ $output == *'[OK] verified '* ]]
[[ $output == *'[OK] bridged context-mode doctor' ]]

if env -u CONTEXT_MODE_WORKSPACE \
  PATH="$tmp/bin:$PATH" \
  TEST_GESTALT_PLUGIN_ROOT="$root/plugins/gestalt" \
  TEST_WRONG_GESTALT_VERSION=1 \
  GESTALT_HOME="$tmp" node "$bridge" >"$tmp/wrong-version.out" 2>&1; then
  printf 'wrong-version Gestalt skill catalog unexpectedly succeeded\n' >&2
  exit 1
fi
grep -F '[FAIL] Gestalt skill catalog is invalid' "$tmp/wrong-version.out" >/dev/null
grep -F 'Gestalt skill path mismatch' "$tmp/wrong-version.out" >/dev/null

if env -u CONTEXT_MODE_WORKSPACE \
  PATH="$tmp/bin:$PATH" \
  TEST_GESTALT_PLUGIN_ROOT="$root/plugins/gestalt" \
  TEST_OMIT_GESTALT_SKILL=systematic-debugging \
  GESTALT_HOME="$tmp" node "$bridge" >"$tmp/missing-skill.out" 2>&1; then
  printf 'missing Gestalt skill unexpectedly succeeded\n' >&2
  exit 1
fi
grep -F '[FAIL] Gestalt skill catalog is invalid' "$tmp/missing-skill.out" >/dev/null
grep -F 'Gestalt skill catalog mismatch' "$tmp/missing-skill.out" >/dev/null

rm -f -- "$runtime/cli.bundle.mjs"
if env -u CONTEXT_MODE_WORKSPACE \
  PATH="$tmp/bin:$PATH" \
  TEST_GESTALT_PLUGIN_ROOT="$root/plugins/gestalt" \
  GESTALT_HOME="$tmp" node "$bridge" \
  >"$tmp/missing.out" 2>&1; then
  printf 'missing external runtime CLI unexpectedly succeeded\n' >&2
  exit 1
fi
grep -F "[FAIL] context-mode $version runtime CLI is missing" "$tmp/missing.out" >/dev/null

printf 'ctx-doctor fallback bridge is valid\n'
