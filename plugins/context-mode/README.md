# context-mode for Codex

This downstream package exposes context-mode as a Codex plugin. It provides:

- sandboxed command and file analysis without flooding the conversation;
- SQLite FTS5 indexing and follow-up search;
- URL fetching into the index;
- authenticated GitHub Actions and authorized local test-evidence ingestion;
- session statistics, snapshots, and continuity hooks.

The package intentionally ships only Codex MCP manifests, configuration, and
hooks. User-facing context-mode skills belong to the sibling Gestalt plugin so
Codex lists and toggles them under `(gestalt)`. The upstream TypeScript core
still contains shared adapter code; removing it requires a separate refactor
because the server and CLI import the shared adapter registry during
compilation.

## Install

From the `dyne-gestalt-agents` marketplace checkout, run:

```sh
./gestalt-setup.sh
```

The setup command installs both marketplace plugins and creates a versioned
runtime under `${GESTALT_HOME:-$HOME/.gestalt}`. It installs locked dependencies,
type-checks the TypeScript, builds the runtime bundles, verifies the native
SQLite binding, and writes a SHA-256 preparation manifest. It
requires Node.js 22.5 or newer, npm, network access, and a native toolchain for
`better-sqlite3`. Set `CONTEXT_MODE_PACKAGE_MANAGER=npm` or `bun` to override
automatic dependency-installer selection.

Run setup again after an upgrade. Use `--prepare-only` for only the external runtime,
`--force` to rebuild, or `--dry-run` to inspect mutations.

Setup also repairs the Codex integration in place. It enables stable hooks,
merges context-mode entries into `CODEX_HOME/hooks.json`, and registers a native
MCP launcher in `config.toml` without replacing unrelated user settings.
Repeated setup is byte-idempotent.

## Startup contract

Codex starts `node ./start.mjs`. The launcher only:

1. records the project directory and selects the Codex platform;
2. resolves the external runtime from its version and the current Node ABI;
3. verifies the prepared artifact manifest;
4. imports the external `server.bundle.mjs`.

It never installs, compiles, repairs, or rewrites files. An incomplete runtime
exits with code 78 and `CONTEXT_MODE_NOT_PREPARED` so the failure is immediate
instead of timing out during the MCP handshake. Codex may replace its plugin
cache without affecting the prepared runtime.

The package includes `.mcp.json` and `hooks/hooks.json` as its portable plugin
surfaces. For current Codex, setup disables that manifest contribution and uses
stable user-level launchers instead. Codex does not currently pass the session
workspace to a plugin MCP child, while the native launcher inherits the Codex
process workspace and completes the MCP handshake. Do not add duplicate MCP or
hook configuration manually; rerun setup to reconcile it.

## Source maps

`ctx_source_map` saves source navigation in the existing workspace content
database so another session can recover paths, ranges, findings, questions and
references without rereading whole files:

```json
{"operation":"capture","path":"src/resolver.ts","notes":[{"range":{"start":20,"end":35},"finding":"Fallback ownership","question":"Does fallback preserve scope?","references":[{"path":"design.md","sha256":"<64 hex digits>","locator":"section:fallback"}]}]}
```

Find the map using `ctx_search` with the finding or path, then call
`{"operation":"read","map":"<returned map id>"}`. An exact `path` also locates
its saved map. Reads verify authorized live bytes and report `current`, `stale`
or `moved`; unavailable files or indexes produce explicit errors. For a known
move, supply the original `map` and the new `path`. Changed ranges include
three lines of context by default; repeated or ambiguous regions can widen
conservatively. Supply `range` and `context` to inspect wider current regions.

Responses default to 2048 serialized UTF-8 bytes (`maxBytes`: 1024–65536).
Paged responses retain all fields in `data`; repeat the same read arguments
with `revision` and `offset: nextOffset` until `nextOffset` is null. Every page
reauthorizes current bytes and rejects changed content or map metadata. If FTS
indexing fails after capture, the map remains accessible by ID or exact path;
if storage is unavailable, inspect current source natively and capture again
when storage returns. Captures are limited to complete UTF-8 files of 2 MiB
and 200,000 lines. Saved notes and reference digests are navigation leads;
verify references independently and inspect current source natively before
editing. Reading a stale map does not update its saved findings.

## Test evidence

`ctx_test_evidence` captures GitHub Actions evidence using the existing `gh`
authentication, or reads authorized local JSON, JUnit, TAP, Vitest and pytest
logs. It never requests credentials. Select a specific run and attempt:

```json
{"operation":"github","github":{"repository":"owner/repo","run":123,"attempt":2,"job":456}}
```

For an existing workspace log, use
`{"operation":"local","files":[{"path":"test-results.json","command":"npm test","exit":1}]}`.
Command and exit values describe an observation; ingestion does not run tests.
Unknown formats, partial captures, conflicting exits and all-skipped results
retain explicit uncertainty. GitHub artifact IDs are run-scoped and cannot
prove a rerun attempt. Job logs retain the validated attempt's job identity.

Each routine response is at most 2048 UTF-8 bytes. Full failures, source digests,
private capture paths and scoped index references remain in a report manifest.
Use the returned report ID with
`{"operation":"followup","report":"report-ABC123","offset":0,"maxBytes":2048}`
and continue at `nextOffset`. Followups stay in the current workspace/session.
Evidence persists until its local evidence directory is removed; it is not
uploaded or automatically polled. Native read/command restrictions still apply.

Completed GitHub captures reuse local bytes after verifying their digests.
Running or incomplete captures are fetched again. Cached results retain their
original retrieval time and explicitly report cached freshness; they do not
recheck remote status, authentication, artifact expiration or changed bytes.
Set `"refresh":true` inside `github` to invalidate the cached selection and
fetch again, including after an artifact changes. A failed refresh cannot fall
back to the invalidated success. A new attempt or selection uses a separate
capture; refreshed SHA/content changes produce separate index identities.
Missing, purged or digest-mismatched captures are fetched again.

Local reads are authorized on every ingestion. Canonical source identity and
sanitized content digest identify reusable indexes within the current session;
a missing index is rebuilt. For executor-to-root transfer, use
`{"operation":"reference","manifest":{"path":"shared/report.json","sha256":"<64 hex digits>"}}`.
The manifest and every captured source must already be readable under the
receiving workspace's policy. This operation verifies digests and indexes
locally; it does not import another session's index IDs or verify the candidate.
Copying a report ID alone does not grant access. If ingestion is unavailable,
capture logs outside the conversation and use authorized file analysis plus
focused search, retaining explicit unknowns and bounded supervisor reports.

Repeated ingestion reauthorizes and hashes the current source and retained
capture before reusing its bytes and parsed diagnostics. The bounded runtime
cache keeps at most 32 parses/16 MiB, isolates repository/path/revision and
redaction policy, and retains original observation times. Missing/corrupt
captures are reconstructed from the currently authorized source. Index reuse
stays separate from parsing and capture reuse.

`verification` distinguishes declared candidate inputs, local byte validity
and remote freshness. A cached passing CI observation returns `needs-evidence`
until `github.refresh` revalidates the selected run/attempt; transferred CI
observations also require refresh. Known failures stay visible. Changing the
candidate, dependencies/config, environment, exact command or cwd does not
reattach an unchanged local log to the new inputs: rerun the check, then ingest
with top-level `"refresh":true` to explicitly recapture. Ingestion never runs
the check or independently certifies a candidate; timestamps alone prove no
freshness. Candidate keys accept `dependencyConfigSha256` and
`environmentSha256` alongside SHA/branch/dirty digest.

To retrieve only missing failure records, use
`{"operation":"followup","report":"report-ABC123","failures":{"check":0,"offset":7,"limit":1},"maxBytes":1024}`.
Here `offset` counts failures within the selected check; it is distinct from
the ordinary byte followup's top-level `offset`. Continue at `nextOffset`.
Oversized IDs/causes retain explicit omissions and exact full-report locators;
ordinary byte followups retain their complete details. Failure pages verify
authorized capture references and return the report digest for independent
comparison with the original manifest.

## Independent review packets

For executor-to-root handoffs, [independent review packets](docs/review-packets.md)
provide complete candidate/scope/check identities and a bounded delta. The
native helper compares authorized bytes with separate root observations;
acceptance, freshness and relevant diff inspection remain root duties.

## Reproduce the evidence benchmark

From a checkout with the declared development dependencies already available
(Node.js 22.5 or newer), run:

```sh
cd plugins/context-mode
evidence_test_root=$(mktemp -d /tmp/context-evidence-benchmark.XXXXXX)
CODEX_HOME="$evidence_test_root/codex" GESTALT_HOME="$evidence_test_root/gestalt" \
  npm run benchmark:evidence -- "$evidence_test_root/metrics.json"
```

The command exits nonzero if correctness, references, bounded responses, the
80% initial reduction target for inputs over 20 KiB, unchanged-terminal reuse,
or rerun invalidation fails. It replays large passing, failing, setup-failure,
repeated-CI, rerun and unknown-format cases derived from the sanitized L1 corpus.
Both paths receive identical generated bytes; per-case digests and synthetic
session IDs identify the measurements. Temporary evidence/databases are removed;
the JSON stores metrics rather than prompts, logs or model outputs.

The comparison uses an uncached raw workflow, not an old binary or a private
session. It counts returned UTF-8 bytes, the added tool description, request
bytes, every bounded report page and focused unknown-format search. Existing
baseline tools add zero description bytes, a conservative incremental comparison;
MCP transport framing is excluded equally. Raw, captured and downloaded bytes
and log-fetch/API-call/index counts are separate. Source lengths/IDs use a
deterministic renderer documented in the report. Latency measures local capture
and diagnostic retrieval, with no model calls or brittle timing assertions.
Token estimates, API cache counters, subscriber allowances and billing savings
are not measured. Local parsing may take longer even when payloads shrink.

## Development

```sh
npm run prepare:codex
npm run check:prepared
npm test
```

Repository-level verification is documented in the root `USAGE.md`.

## License and origin

The context-mode core originates from
[mksglu/context-mode](https://github.com/mksglu/context-mode) and is licensed
under Elastic License 2.0. Downstream packaging details are in `UPSTREAM.md`.
