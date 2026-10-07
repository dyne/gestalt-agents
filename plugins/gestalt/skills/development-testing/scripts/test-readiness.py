#!/usr/bin/env python3
"""Check declared test prerequisites and allocate isolated evidence output."""

import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile


def check_readiness(required, browser, artifact_parent):
    """Return JSON-safe evidence; never launch tools or modify shared permissions."""
    errors = []
    executables = []
    for name in required:
        resolved = shutil.which(name)
        executables.append({"requested": name, "resolved": resolved})
        if resolved is None:
            errors.append({"code": "missing_executable", "detail":
                           f"Required executable unavailable: {name}"[:300]})
    browser_path = None
    if browser is not None:
        candidate = Path(browser).absolute()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            browser_path = str(candidate)
        else:
            errors.append({"code": "missing_browser", "detail":
                           f"Supply an existing executable browser path: {browser}"[:300]})

    run_dir = None
    probe = None
    if not errors:
        try:
            # The parent must already exist. Do not repair or change shared paths.
            run_dir = Path(tempfile.mkdtemp(prefix="test-run-", dir=artifact_parent)).resolve()
            with tempfile.NamedTemporaryFile(prefix=".write-probe-", dir=run_dir,
                                             delete=False) as handle:
                probe = Path(handle.name)
                handle.write(b"readiness\n")
                handle.flush()
            probe.unlink()
            probe = None
        except OSError as exc:
            errors.append({"code": "artifact_directory_unusable", "detail":
                           f"Choose a writable artifact parent; {type(exc).__name__}: {exc}"[:300]})
            # Only remove paths allocated by this call, never recursively clean.
            if probe is not None:
                try:
                    probe.unlink()
                except OSError:
                    pass
            if run_dir is not None:
                try:
                    run_dir.rmdir()
                    run_dir = None
                except OSError:
                    errors.append({"code": "cleanup_incomplete", "detail":
                                   "Own run directory remains; inspect the artifact_directory."})
    return {"ready": not errors, "executables": executables,
            "browser_executable": browser_path,
            "artifact_directory": str(run_dir) if run_dir is not None else None,
            "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require", action="append", default=[], metavar="EXECUTABLE",
                        help="Required executable name on PATH or explicit path (repeatable)")
    parser.add_argument("--browser-executable", metavar="PATH",
                        help="Optional explicit browser file; never discover a browser cache")
    parser.add_argument("--artifact-parent", required=True, metavar="DIRECTORY",
                        help="Existing parent in which to allocate a private run directory")
    args = parser.parse_args()
    if len(args.require) > 32 or any(len(value) > 4096 for value in
                                   args.require + [args.artifact_parent, args.browser_executable or ""]):
        parser.error("At most 32 executables and 4096 characters per argument are supported")
    result = check_readiness(args.require, args.browser_executable, args.artifact_parent)
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
