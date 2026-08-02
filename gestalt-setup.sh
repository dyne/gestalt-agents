#!/usr/bin/env bash
# Prepare and install the Gestalt and context-mode plugins for Codex.
set -Eeuo pipefail

script_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
marketplace_file="$script_dir/.agents/plugins/marketplace.json"
context_source="$script_dir/plugins/context-mode"
org_plan="$script_dir/plugins/gestalt/skills/org-plan/scripts/org-plan"
prepare_only=false
force=false
dry_run=false
config_tmp=''

usage() {
  cat <<'EOF'
Usage: ./gestalt-setup.sh [--prepare-only] [--force] [--dry-run]

Build context-mode before Codex starts it, then install context-mode and Gestalt
from this marketplace. The managed Codex home defaults to ~/.codex-gestalt.
Run again after a marketplace upgrade.

  --prepare-only  Build and verify the source plugin without changing Codex.
  --force         Reinstall dependencies and rebuild prepared artifacts.
  --dry-run       Print mutating commands without running them.
  -h, --help      Show this help.
EOF
}

die() {
  printf 'gestalt-setup: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n $config_tmp && -e $config_tmp ]]; then
    rm -f -- "$config_tmp"
  fi
}

trap cleanup EXIT

run() {
  if "$dry_run"; then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

while (($#)); do
  case $1 in
    --prepare-only) prepare_only=true ;;
    --force) force=true ;;
    --dry-run) dry_run=true ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

[[ -f $marketplace_file ]] || die "marketplace manifest not found: $marketplace_file"
[[ -f $context_source/scripts/prepare-runtime.mjs ]] || die "context-mode preparer not found"
[[ -x $org_plan ]] || die "Org Plan helper is not executable: $org_plan"
command -v node >/dev/null 2>&1 || die "Node.js 22.5 or newer is required"
command -v npm >/dev/null 2>&1 || die "npm is required to build context-mode"
command -v python3 >/dev/null 2>&1 || die "Python 3.11 or newer is required"
python3 -c 'import tomllib' >/dev/null 2>&1 ||
  die "Python 3.11 or newer with tomllib is required"

node_version=$(node -p 'process.versions.node')
node_major=${node_version%%.*}
node_remainder=${node_version#*.}
node_minor=${node_remainder%%.*}
if ((node_major < 22 || (node_major == 22 && node_minor < 5))); then
  die "Node.js 22.5 or newer is required; found $node_version"
fi

marketplace_name=$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).name;
  if (typeof value !== "string" || !value) process.exit(1);
  process.stdout.write(value);
' "$marketplace_file") || die "cannot read marketplace name"

if "$prepare_only"; then
  prepare_args=(node "$context_source/scripts/prepare-runtime.mjs")
  if "$force"; then prepare_args+=(--force); fi
  run "${prepare_args[@]}"
  if "$dry_run"; then
    printf 'DRY-RUN: node %q --check\n' "$context_source/scripts/prepare-runtime.mjs"
  else
    node "$context_source/scripts/prepare-runtime.mjs" --check
  fi
  printf 'gestalt-setup: context-mode source is prepared\n'
  exit 0
fi

command -v codex >/dev/null 2>&1 || die "Codex CLI is required for plugin installation"

codex_root=${CODEX_HOME:-${HOME:?HOME is required}/.codex-gestalt}
[[ $codex_root == /* ]] || die "CODEX_HOME must be an absolute path: $codex_root"
[[ $codex_root != / && $codex_root != "${HOME:?HOME is required}" ]] ||
  die "refusing unsafe CODEX_HOME: $codex_root"

if "$dry_run"; then
  run mkdir -p -- "$codex_root"
else
  mkdir -p -- "$codex_root"
  codex_root=$(CDPATH='' cd -- "$codex_root" && pwd -P) ||
    die "cannot resolve CODEX_HOME: $codex_root"
  home_root=$(CDPATH='' cd -- "${HOME:?HOME is required}" && pwd -P) ||
    die "cannot resolve HOME"
  [[ $codex_root != / && $codex_root != "$home_root" ]] ||
    die "refusing unsafe resolved CODEX_HOME: $codex_root"
fi

export CODEX_HOME=$codex_root
agents_dir="$codex_root/agents"
config_file="$codex_root/config.toml"

if "$dry_run"; then
  printf 'DRY-RUN: create %q if absent; otherwise validate required Gestalt settings\n' "$config_file"
elif [[ -e $config_file ]]; then
  [[ -f $config_file ]] || die "Codex configuration is not a regular file: $config_file"
  if ! python3 - "$config_file" <<'PY'
import sys
import tomllib
from pathlib import Path

path = Path(sys.argv[1])
try:
    with path.open("rb") as handle:
        config = tomllib.load(handle)
except (OSError, tomllib.TOMLDecodeError) as error:
    print(f"gestalt-setup: cannot parse existing configuration {path}: {error}", file=sys.stderr)
    raise SystemExit(1)

requirements = (
    (("agents", "max_depth"), 1, "[agents] max_depth = 1"),
    (("features", "plugin_hooks"), True, "[features] plugin_hooks = true"),
    (("features", "hooks"), True, "[features] hooks = true"),
)
for keys, expected, rendered in requirements:
    value = config
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            print(f"gestalt-setup: missing required setting in {path}: {rendered}", file=sys.stderr)
            raise SystemExit(1)
        value = value[key]
    if type(value) is not type(expected) or value != expected:
        print(
            f"gestalt-setup: required setting differs in {path}: {rendered} (found {value!r})",
            file=sys.stderr,
        )
        raise SystemExit(1)
PY
  then
    die "existing Codex configuration was left unchanged; correct it and rerun setup"
  fi
else
  config_tmp=$(mktemp "$codex_root/.config.toml.XXXXXX") ||
    die "cannot create temporary configuration in $codex_root"
  {
    printf '[agents]\n'
    printf 'max_depth = 1\n\n'
    printf '[features]\n'
    printf 'plugin_hooks = true\n'
    printf 'hooks = true\n'
  } >"$config_tmp"
  chmod 600 "$config_tmp"
  mv -f -- "$config_tmp" "$config_file"
  config_tmp=''
fi

if "$dry_run"; then
  run codex plugin marketplace add "$script_dir"
else
  configured_root=$(codex plugin marketplace list | awk -v wanted="$marketplace_name" '
    NR > 1 && $1 == wanted { $1=""; sub(/^[[:space:]]+/, ""); print; exit }
  ')
  if [[ -n $configured_root ]]; then
    configured_root=$(CDPATH='' cd -- "$configured_root" 2>/dev/null && pwd -P) ||
      die "configured marketplace root is unreadable: $configured_root"
    if [[ $configured_root != "$script_dir" ]]; then
      die "marketplace '$marketplace_name' points to $configured_root; run $configured_root/gestalt-setup.sh instead"
    fi
  else
    run codex plugin marketplace add "$script_dir"
  fi
fi

run codex plugin add "context-mode@$marketplace_name"
run codex plugin add "gestalt@$marketplace_name"

context_version=$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version;
  if (typeof value !== "string" || !value) process.exit(1);
  process.stdout.write(value);
' "$context_source/.codex-plugin/plugin.json") || die "cannot read context-mode version"

installed_context="$codex_root/plugins/cache/$marketplace_name/context-mode/$context_version"
installed_prepare=(node "$installed_context/scripts/prepare-runtime.mjs")
if "$force"; then installed_prepare+=(--force); fi
if "$dry_run"; then
  printf 'DRY-RUN:'
  printf ' %q' "${installed_prepare[@]}"
  printf '\n'
else
  [[ -f $installed_context/scripts/prepare-runtime.mjs ]] ||
    die "installed context-mode cache not found: $installed_context"
  "${installed_prepare[@]}"
  node "$installed_context/scripts/prepare-runtime.mjs" --check
  codex plugin list --marketplace "$marketplace_name" --json >/dev/null
fi

run "$org_plan" prepare-supervision --agents-dir "$agents_dir"
run rm -f -- "$agents_dir/org-plan-supervisor.toml"

printf 'gestalt-setup: installed prepared plugins from %s\n' "$marketplace_name"
printf 'gestalt-setup: configured Codex home %s\n' "$codex_root"
printf 'gestalt-setup: restart that Codex profile and run ctx-doctor in a new session\n'
