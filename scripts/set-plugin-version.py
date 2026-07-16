#!/usr/bin/env python3
"""Set one strict semantic version in every plugin manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path


STRICT_SEMVER = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")


def parse_args() -> argparse.Namespace:
    """Parse the requested version and optional repository root."""

    parser = argparse.ArgumentParser()
    parser.add_argument("version", help="strict MAJOR.MINOR.PATCH version")
    parser.add_argument(
        "repository_root",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
    )
    return parser.parse_args()


def prepare_updates(root: Path, version: str) -> list[tuple[Path, str, int]]:
    """Validate all manifests and serialize their updated contents in memory."""

    if not STRICT_SEMVER.fullmatch(version):
        raise ValueError(f"invalid strict semantic version: {version}")

    pattern = root / "plugins"
    manifests = sorted(pattern.glob("*/.codex-plugin/plugin.json"))
    manifests = [path for path in manifests if path.is_file() and not path.is_symlink()]
    if not manifests:
        raise ValueError(f"no plugin manifests found below {pattern}")

    updates = []
    for path in manifests:
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"cannot read valid JSON from {path}: {error}") from error
        if not isinstance(manifest, dict) or not isinstance(manifest.get("version"), str):
            raise ValueError(f"manifest has no string version field: {path}")
        manifest["version"] = version
        serialized = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        updates.append((path, serialized, stat.S_IMODE(path.stat().st_mode)))
    return updates


def replace_manifests(updates: list[tuple[Path, str, int]]) -> None:
    """Replace each manifest using a temporary file in the same directory."""

    for path, serialized, mode in updates:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(serialized)
            temporary.chmod(mode)
            temporary.replace(path)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise


def main() -> int:
    """Apply the selected version and report the updated manifests."""

    args = parse_args()
    try:
        updates = prepare_updates(args.repository_root.resolve(), args.version)
        replace_manifests(updates)
    except (OSError, ValueError) as error:
        print(f"set-plugin-version: {error}", file=sys.stderr)
        return 1

    for path, _, _ in updates:
        print(path.relative_to(args.repository_root.resolve()))
    print(f"version={args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
