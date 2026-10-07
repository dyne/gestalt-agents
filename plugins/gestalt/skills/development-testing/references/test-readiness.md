# Test readiness

Before an expensive run, check only the prerequisites declared by that repository:

```sh
python3 <skill-directory>/scripts/test-readiness.py \
  --require node --require npm \
  --browser-executable "$repository_browser" \
  --artifact-parent "$evidence_parent"
```

Python 3 uses only its standard library. Repeat `--require` for executable names
on PATH or explicit paths; omit the browser argument for suites without browser
tests. The artifact parent must already exist. Exit 0 and JSON `ready: true`
confirm executable availability and an actual temporary write/remove probe in
a newly allocated private directory. Exit 1 reports bounded errors. These checks
do not launch the browser or prove its runtime libraries, test selection, or the
suite itself works.

Use the returned `artifact_directory` as this run's evidence destination. The
successful directory is intentionally retained; remove only that run's artifacts
after evidence is no longer needed. Failed probes clean only files and empty
directories they allocated, and report an incomplete cleanup if removal fails.
Concurrent invocations allocate different directories and preserve existing files.
The helper neither installs packages nor changes shared ownership/permissions.
Fix an unavailable prerequisite explicitly; do not silently change test scope.

Read the repository's Playwright configuration or supported launcher to obtain
the browser executable and evidence settings. Do not guess a cache version. Pass
the returned directory through the configuration the repository actually honors.
Repository-specific environment variable names belong in that repository's
invocation, not in global defaults for this helper.
