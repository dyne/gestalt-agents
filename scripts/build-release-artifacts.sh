#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  printf 'usage: %s TAG OUTPUT_DIRECTORY\n' "${0##*/}" >&2
  exit 64
fi

tag=$1
output_dir=$2
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

[[ $tag =~ ^v([2-9]|[1-9][0-9]+)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  printf 'invalid release tag: %s\n' "$tag" >&2
  exit 64
}
[[ ! -e $output_dir ]] || {
  printf 'output path already exists: %s\n' "$output_dir" >&2
  exit 73
}
for command_name in git python3 sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'required command is missing: %s\n' "$command_name" >&2
    exit 127
  }
done

plugin_version=$(python3 - "$root" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
versioned_files = (
    root / "plugins/gestalt/.codex-plugin/plugin.json",
    root / "plugins/context-mode/.codex-plugin/plugin.json",
    root / "plugins/context-mode/package.json",
)
versions = {json.loads(path.read_text())["version"] for path in versioned_files}
assert len(versions) == 1, f"release versions differ: {sorted(versions)}"
print(versions.pop())
PY
)
[[ $tag == "v$plugin_version" ]] || {
  printf 'release tag %s does not match plugin version %s\n' \
    "$tag" "$plugin_version" >&2
  exit 65
}

release_paths=(
  .agents/plugins/marketplace.json
  README.md
  USAGE.md
  gestalt-setup.sh
  scripts/install-managed-commands.mjs
  scripts/verify-gestalt-skill-catalog.mjs
  plugins/gestalt
  plugins/context-mode
)
if git -C "$root" ls-tree -r HEAD -- "${release_paths[@]}" | grep -q '^120000 '; then
  printf 'release input contains a symlink\n' >&2
  exit 65
fi

output_parent=$(dirname -- "$output_dir")
mkdir -p -- "$output_parent"
stage=$(mktemp -d "$output_parent/.release-artifacts.XXXXXX")
cleanup() {
  rm -rf -- "$stage"
}
trap cleanup EXIT HUP INT TERM

git -C "$root" archive --format=zip \
  --output="$stage/gestalt-agents-$tag.zip" \
  HEAD -- "${release_paths[@]}"

# Derive the standalone authoring skill from the same committed source as the
# marketplace archive. Keep its template beside the canonical Org Plan skill;
# .md.in prevents installers discovering a second skill in the source tree.
python3 - "$stage" "$tag" <<'PY'
import sys
import zipfile
from pathlib import Path

stage, tag = Path(sys.argv[1]), sys.argv[2]
source = "plugins/gestalt/skills/org-plan/assets/desktop/"
files = {
    "SKILL.md.in": "org-plan/SKILL.md",
    "openai.yaml": "org-plan/agents/openai.yaml",
    "plan-template.org.in": "org-plan/plan-template.org",
}
with zipfile.ZipFile(stage / f"gestalt-agents-{tag}.zip") as marketplace:
    with zipfile.ZipFile(stage / f"org-plan-{tag}.zip", "w") as skill:
        for original, target in files.items():
            entry = zipfile.ZipInfo(target, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            skill.writestr(entry, marketplace.read(source + original))
PY

(
  cd -- "$stage"
  sha256sum -- *.zip >SHA256SUMS
)

mv -- "$stage" "$output_dir"
trap - EXIT HUP INT TERM
printf 'built Gestalt marketplace and standalone Org Plan skill bundles in %s\n' "$output_dir"
