#!/usr/bin/env bash
# Install or update org-plan from a trusted source; safe to invoke through Bash.
set -Eeuo pipefail

repository=${ORG_PLAN_REPOSITORY:-https://github.com/dyne/agent-plugins}
ref=${ORG_PLAN_REF:-main}
home=${HOME:?HOME is required}
plugins_dir="$home/.agents/plugins"
target="$plugins_dir/org-plan"
marketplace="$plugins_dir/marketplace.json"

[[ $ref =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || { printf 'invalid ORG_PLAN_REF: %s\n' "$ref" >&2; exit 2; }
mkdir -p -- "$plugins_dir"

if [ -e "$target" ]; then
  [ -d "$target/.git" ] || { printf 'existing target is not a Git checkout: %s\n' "$target" >&2; exit 1; }
  current=$(git -C "$target" remote get-url origin)
  [ "$current" = "$repository" ] || { printf 'existing target has a different origin: %s\n' "$current" >&2; exit 1; }
else
  git clone -q --no-checkout "$repository" "$target"
fi

git -C "$target" fetch -q --tags origin
if [ "$ref" = main ]; then
  git -C "$target" checkout -q -B main origin/main
else
  git -C "$target" checkout -q --detach "$ref"
fi

python3 - "$marketplace" <<'PY'
import json
import os
import sys
import tempfile

path = sys.argv[1]
if os.path.exists(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
else:
    data = {"name": "personal", "interface": {"displayName": "Personal"}, "plugins": []}
if data.get("name") != "personal":
    raise SystemExit(f"marketplace is not personal: {data.get('name')!r}")
data.setdefault("interface", {}).setdefault("displayName", "Personal")
plugins = [entry for entry in data.get("plugins", []) if entry.get("name") != "org-plan"]
plugins.append({
    "name": "org-plan",
    "source": {"source": "local", "path": "./plugins/org-plan"},
    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
    "category": "Productivity",
})
data["plugins"] = plugins
directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix=".marketplace.", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

printf 'Installed org-plan at %s (ref: %s). Restart Codex to load the marketplace entry.\n' "$target" "$ref"
