#!/usr/bin/env python3
"""Set a strict semantic version in Dyne-owned plugin manifests only."""

from __future__ import annotations

import argparse
import hashlib
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
    """Validate owned manifests and serialize their updated contents in memory."""

    if not STRICT_SEMVER.fullmatch(version):
        raise ValueError(f"invalid strict semantic version: {version}")

    owned = root / "plugins" / "gestalt" / ".codex-plugin" / "plugin.json"
    context_root = root / "plugins" / "context-mode"
    context_manifest = context_root / ".codex-plugin" / "plugin.json"
    context_package = context_root / "package.json"
    context_provenance = context_root / "UPSTREAM.md"
    checksum_fixture = (
        root
        / "tests"
        / "plugins"
        / "context-mode"
        / "fixtures"
        / "context-mode-codex-hardening-4b1348d.sha256"
    )
    repository_layout = owned.exists()
    manifests = (
        [owned, context_manifest, context_package]
        if repository_layout
        else sorted((root / "plugins").glob("*/.codex-plugin/plugin.json"))
    )
    manifests = [path for path in manifests if path.is_file() and not path.is_symlink()]
    expected_manifest_count = 3 if repository_layout else 1
    if len(manifests) < expected_manifest_count:
        raise ValueError("no Dyne-owned plugin manifests found")

    updates: list[tuple[Path, str, int]] = []
    context_replacements: dict[str, bytes] = {}
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
        if repository_layout and path.is_relative_to(context_root):
            context_replacements[str(path.relative_to(context_root))] = serialized.encode()

    if repository_layout:
        try:
            provenance = context_provenance.read_text(encoding="utf-8")
        except OSError as error:
            raise ValueError(f"cannot read {context_provenance}: {error}") from error
        provenance, replacements = re.subn(
            r"(?m)^- Downstream package version: `[^`]+`$",
            f"- Downstream package version: `{version}`",
            provenance,
        )
        if replacements != 1:
            raise ValueError(f"expected one downstream package version in {context_provenance}")
        updates.append(
            (context_provenance, provenance, stat.S_IMODE(context_provenance.stat().st_mode))
        )
        context_replacements["UPSTREAM.md"] = provenance.encode()

        try:
            fixture_lines = checksum_fixture.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            raise ValueError(f"cannot read {checksum_fixture}: {error}") from error
        fixture_targets = set(context_replacements)
        fixture_seen: set[str] = set()
        rewritten_fixture: list[str] = []
        for line in fixture_lines:
            try:
                mode, remainder = line.split(" ", 1)
                _, relative = remainder.split("  ", 1)
            except ValueError as error:
                raise ValueError(f"malformed checksum fixture line: {line}") from error
            replacement = context_replacements.get(relative)
            if replacement is not None:
                digest = hashlib.sha256(replacement).hexdigest()
                line = f"{mode} {digest}  {relative}"
                fixture_seen.add(relative)
            rewritten_fixture.append(line)
        if fixture_seen != fixture_targets:
            missing = sorted(fixture_targets - fixture_seen)
            raise ValueError(f"checksum fixture is missing versioned paths: {missing}")
        updates.append(
            (
                checksum_fixture,
                "\n".join(rewritten_fixture) + "\n",
                stat.S_IMODE(checksum_fixture.stat().st_mode),
            )
        )
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
