#!/usr/bin/env bash
# Prepare and install the Gestalt and context-mode plugins for Codex.
set -Eeuo pipefail

script_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
marketplace_file="$script_dir/.agents/plugins/marketplace.json"
context_source="$script_dir/plugins/context-mode"
context_configurator="$context_source/scripts/configure-codex.mjs"
org_plan="$script_dir/plugins/gestalt/skills/org-plan/scripts/org-plan"
catalog_verifier="$script_dir/scripts/verify-gestalt-skill-catalog.mjs"
setup_args=("$@")
prepare_only=false
force=false
dry_run=false
extra_skills=false
extra_skills_only=false

usage() {
  cat <<'EOF'
Usage: ./gestalt-setup.sh [--prepare-only] [--force] [--dry-run]
                          [--extra-skills | --extra-skills-only]

Install a prepared context-mode runtime under ${GESTALT_HOME:-$HOME/.gestalt},
then install context-mode and Gestalt from this marketplace. The managed Codex
home defaults to ~/.codex-gestalt. Run again after a marketplace upgrade.

  --prepare-only  Install and verify the external runtime without changing Codex.
  --force         Reinstall dependencies and rebuild prepared artifacts.
  --dry-run       Print mutating commands without running them.
  --extra-skills  Install the curated extra skill set under GESTALT_HOME.
  --extra-skills-only
                  Install only curated skills; skip runtime and plugin setup.
  -h, --help      Show this help.
EOF
}

die() {
  printf 'gestalt-setup: %s\n' "$*" >&2
  exit 1
}

run() {
  if "$dry_run"; then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

resolve_codex_root() {
  local home_root

  codex_root=${CODEX_HOME:-${HOME:?HOME is required}/.codex-gestalt}
  [[ $codex_root == /* ]] || die "CODEX_HOME must be an absolute path: $codex_root"
  [[ $codex_root != / && $codex_root != "${HOME:?HOME is required}" ]] ||
    die "refusing unsafe CODEX_HOME: $codex_root"

  if ! "$dry_run"; then
    mkdir -p -- "$codex_root"
    codex_root=$(CDPATH='' cd -- "$codex_root" && pwd -P) ||
      die "cannot resolve CODEX_HOME: $codex_root"
    home_root=$(CDPATH='' cd -- "${HOME:?HOME is required}" && pwd -P) ||
      die "cannot resolve HOME"
    [[ $codex_root != / && $codex_root != "$home_root" ]] ||
      die "refusing unsafe resolved CODEX_HOME: $codex_root"
  fi
}

install_extra_skills() (
  local codex_skills_root=$1 skills_root skill_dir skill_link

  command -v npx >/dev/null 2>&1 || die "npx is required for --extra-skills"
  skills_root=${GESTALT_HOME:-${HOME:?HOME is required}/.gestalt}
  [[ $skills_root == /* ]] || die "GESTALT_HOME must be an absolute path: $skills_root"
  [[ $skills_root != / ]] || die "refusing unsafe GESTALT_HOME: $skills_root"
  mkdir -p -- "$skills_root"
  skills_root=$(CDPATH='' cd -- "$skills_root" && pwd -P) ||
    die "cannot resolve GESTALT_HOME: $skills_root"

  add_extra_skills() (
    cd -- "$skills_root"
    npx skills add "$@" -a codex -y
  )

  printf 'gestalt-setup: installing curated extra skills under %s\n' "$skills_root"
  add_extra_skills https://github.com/openai/skills \
    --skill cli-creator \
    --skill cloudflare-deploy \
    --skill gh-address-comments \
    --skill gh-fix-ci \
    --skill jupyter-notebook \
    --skill playwright \
    --skill playwright-interactive \
    --skill screenshot \
    --skill security-best-practices \
    --skill security-ownership-map \
    --skill security-threat-model \
    --skill winui-app
  add_extra_skills mohitmishra786/low-level-dev-skills \
    --skill cmake \
    --skill gdb \
    --skill llvm \
    --skill make \
    --skill meson \
    --skill static-analysis \
    --skill conan-vcpkg
  add_extra_skills samber/cc-skills-golang \
    --skill golang-code-style \
    --skill golang-design-patterns \
    --skill golang-error-handling \
    --skill golang-performance \
    --skill golang-security \
    --skill golang-testing
  add_extra_skills wshobson/agents \
    --skill bash-defensive-patterns \
    --skill modern-javascript-patterns \
    --skill nodejs-backend-patterns \
    --skill shellcheck-configuration \
    --skill typescript-advanced-types
  add_extra_skills github/awesome-copilot \
    --skill playwright-automation-fill-in-form \
    --skill playwright-explore-website \
    --skill playwright-generate-test
  add_extra_skills membranedev/application-skills \
    --skill chrome-extensions \
    --skill find-skills
  add_extra_skills anthropics/skills --skill docx --skill pdf
  add_extra_skills antfu/skills --skill vite --skill vitepress
  add_extra_skills trailofbits/skills@crypto-protocol-diagram
  add_extra_skills affaan-m/everything-claude-code@hexagonal-architecture
  add_extra_skills alphaonedev/openclaw-graph@smart-contracts
  add_extra_skills bahayonghang/academic-writing-skills@bib-search-citation
  add_extra_skills ccheney/robust-skills@clean-ddd-hexagonal
  add_extra_skills googlechrome/modern-web-guidance@modern-web-guidance
  add_extra_skills luwill/research-skills@research-proposal
  add_extra_skills marimo-team/skills@wasm-compatibility
  add_extra_skills mengbo/mengbo-skills@pandoc-docx
  add_extra_skills microsoft/playwright-cli@playwright-cli
  add_extra_skills mindrally/skills@htmx
  add_extra_skills mryll/skills@vertical-slice-architecture
  add_extra_skills poemswe/co-researcher@academic-writing
  add_extra_skills sickn33/antigravity-awesome-skills \
    --skill bash-linux --skill cpp-pro
  add_extra_skills sveltejs/ai-tools@svelte-code-writer
  add_extra_skills terrylica/cc-skills@pandoc-pdf-generation
  add_extra_skills wondelai/skills@domain-driven-design

  mkdir -p -- "$codex_skills_root"
  shopt -s nullglob
  for skill_dir in "$skills_root/.agents/skills"/*; do
    [[ -d $skill_dir ]] || continue
    skill_link="$codex_skills_root/${skill_dir##*/}"
    if [[ -e $skill_link || -L $skill_link ]]; then
      printf 'gestalt-setup: keeping existing Codex skill entry %s\n' "$skill_link"
      continue
    fi
    ln -s -- "$skill_dir" "$skill_link"
  done
  printf 'gestalt-setup: curated extra skills installed under %s\n' "$skills_root"
)

while (($#)); do
  case $1 in
    --prepare-only) prepare_only=true ;;
    --force) force=true ;;
    --dry-run) dry_run=true ;;
    --extra-skills) extra_skills=true ;;
    --extra-skills-only) extra_skills_only=true ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

if "$extra_skills_only" && { "$prepare_only" || "$force" || "$extra_skills"; }; then
  die "--extra-skills-only cannot be combined with --prepare-only, --force, or --extra-skills"
fi

if "$prepare_only" && "$extra_skills"; then
  die "--extra-skills cannot be combined with --prepare-only"
fi

if "$extra_skills_only"; then
  resolve_codex_root
  export CODEX_HOME=$codex_root
  run install_extra_skills "$codex_root/skills"
  printf 'gestalt-setup: standalone curated extra-skills operation complete\n'
  exit 0
fi

[[ -f $marketplace_file ]] || die "marketplace manifest not found: $marketplace_file"
[[ -f $context_source/scripts/install-runtime.mjs ]] || die "context-mode runtime installer not found"
[[ -f $context_configurator ]] || die "context-mode Codex configurator not found"
[[ -x $org_plan ]] || die "Org Plan helper is not executable: $org_plan"
[[ -f $catalog_verifier ]] || die "Gestalt skill catalog verifier is missing: $catalog_verifier"
command -v node >/dev/null 2>&1 || die "Node.js 22.5 or newer is required"
command -v npm >/dev/null 2>&1 || die "npm is required to build context-mode"

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
  prepare_args=(node "$context_source/scripts/install-runtime.mjs")
  if "$force"; then prepare_args+=(--force); fi
  run "${prepare_args[@]}"
  if "$dry_run"; then
    printf 'DRY-RUN: node %q --check\n' "$context_source/scripts/install-runtime.mjs"
  else
    node "$context_source/scripts/install-runtime.mjs" --check
  fi
  printf 'gestalt-setup: context-mode external runtime is prepared\n'
  exit 0
fi

command -v codex >/dev/null 2>&1 || die "Codex CLI is required for plugin installation"

resolve_codex_root

export CODEX_HOME=$codex_root
agents_dir="$codex_root/agents"

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
      configured_setup="$configured_root/gestalt-setup.sh"
      [[ -f $configured_setup ]] ||
        die "configured marketplace setup script is missing: $configured_setup"
      printf 'gestalt-setup: continuing from configured marketplace %s\n' "$configured_root"
      exec bash "$configured_setup" "${setup_args[@]}"
    fi
  else
    run codex plugin marketplace add "$script_dir"
  fi
fi

runtime_install=(node "$context_source/scripts/install-runtime.mjs")
if "$force"; then runtime_install+=(--force); fi
if "$dry_run"; then
  printf 'DRY-RUN:'
  printf ' %q' "${runtime_install[@]}"
  printf '\n'
else
  "${runtime_install[@]}"
  node "$context_source/scripts/install-runtime.mjs" --check
fi

run codex plugin add "context-mode@$marketplace_name"
run codex plugin add "gestalt@$marketplace_name"

if "$dry_run"; then
  printf 'DRY-RUN: configure context-mode MCP and hooks under %q\n' "$codex_root"
else
  context_version=$(codex plugin list --marketplace "$marketplace_name" --json | node -e '
    let source = "";
    process.stdin.on("data", (chunk) => { source += chunk; });
    process.stdin.on("end", () => {
      const payload = JSON.parse(source);
      const plugin = payload.installed.find((item) => item.name === "context-mode");
      if (!plugin?.installed || typeof plugin.version !== "string" || !plugin.version) process.exit(1);
      process.stdout.write(plugin.version);
    });
  ') || die "cannot resolve installed context-mode version"
  context_plugin_root="$codex_root/plugins/cache/$marketplace_name/context-mode/$context_version"
  [[ -f $context_plugin_root/start.mjs ]] || die "installed context-mode launcher is missing: $context_plugin_root/start.mjs"
  gestalt_root=${GESTALT_HOME:-${HOME:?HOME is required}/.gestalt}
  [[ $gestalt_root == /* ]] || die "GESTALT_HOME must be an absolute path: $gestalt_root"
  gestalt_root=$(CDPATH='' cd -- "$gestalt_root" && pwd -P) || die "cannot resolve GESTALT_HOME: $gestalt_root"
  node "$context_configurator" \
    --codex-home "$codex_root" \
    --gestalt-home "$gestalt_root" \
    --plugin-root "$context_plugin_root" \
    --plugin-id "context-mode@$marketplace_name"
fi

if "$extra_skills"; then
  run install_extra_skills "$codex_root/skills"
fi

if ! "$dry_run"; then
  codex plugin list --marketplace "$marketplace_name" --json >/dev/null
  node "$catalog_verifier" "$script_dir"
fi

run install -d -m 0755 -- "$codex_root/bin"
run install -m 0755 -- "$org_plan" "$codex_root/bin/org-plan"
run "$org_plan" prepare-supervision --agents-dir "$agents_dir"
run rm -f -- "$agents_dir/org-plan-supervisor.toml"

printf 'gestalt-setup: installed plugins and external runtime from %s\n' "$marketplace_name"
printf 'gestalt-setup: installed into Codex home %s\n' "$codex_root"
if "$dry_run"; then
  printf 'gestalt-setup: scheduled Gestalt catalog verification and helper installation\n'
else
  printf 'gestalt-setup: verified every Gestalt skill and installed %s\n' "$codex_root/bin/org-plan"
fi
printf 'gestalt-setup: restart that Codex profile and run ctx-doctor in a new session\n'
