#!/usr/bin/env bash
set -Eeuo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd -P)
bridge="$root/plugins/gestalt/scripts/ctx-doctor.mjs"
version=$(node -p "require('$root/plugins/gestalt/.codex-plugin/plugin.json').version")
runtime_identity=$(node -p '[process.platform, process.arch, "node-" + process.versions.modules].join("-")')
tmp=$(mktemp -d "${TMPDIR:-/tmp}/gestalt-ctx-doctor-test.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
runtime="$tmp/runtime/context-mode/$version/$runtime_identity"
mkdir -p -- "$runtime"

cat > "$runtime/cli.bundle.mjs" <<'EOF'
#!/usr/bin/env node
if (process.argv[2] !== 'doctor') process.exit(91);
if (process.env.CONTEXT_MODE_WORKSPACE !== process.cwd()) process.exit(92);
process.stdout.write('[OK] bridged context-mode doctor\n');
EOF

output=$(env -u CONTEXT_MODE_WORKSPACE GESTALT_HOME="$tmp" node "$bridge")
[[ $output == '[OK] bridged context-mode doctor' ]]

rm -f -- "$runtime/cli.bundle.mjs"
if env -u CONTEXT_MODE_WORKSPACE GESTALT_HOME="$tmp" node "$bridge" \
  >"$tmp/missing.out" 2>&1; then
  printf 'missing external runtime CLI unexpectedly succeeded\n' >&2
  exit 1
fi
grep -F "[FAIL] context-mode $version runtime CLI is missing" "$tmp/missing.out" >/dev/null

printf 'ctx-doctor fallback bridge is valid\n'
