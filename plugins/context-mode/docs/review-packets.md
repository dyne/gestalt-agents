# Independent review packets

`src/evidence/review.ts` defines versioned packets for an executor-to-root
handoff. Packets contain base/candidate identity, complete changed scope,
diff/evidence digests, exact check summaries, first failure, risks, and a delta
since the last root-retained packet. They are review inputs, never acceptance.

The root gathers a separate current `ReviewState` using native Git and check
observations. Do not copy the executor's state as the independent witness.
The helper checks authorized current file/artifact bytes; it cannot prove who
collected a witness, that Git HEAD/scope did not change afterward, or that CI
remains current. Root inspection and any required check reruns still apply.
Neither matching timestamps nor matching local digests establish that freshness.

`ReviewState` has these fields (the exported strict schemas are authoritative):

- `repository`: canonical absolute repository path.
- `candidate`: full `sha`, `base`, `branch`, `dirtySha256`,
  `dependencyConfigSha256`, and `environmentSha256`. Root independently checks
  Git, complete dirty content including untracked deliverables, relevant
  dependencies/config, exact execution environment and CI identities.
- `scope`: complete, sorted, unique `{path, sha256, mode}` entries. Paths are
  relative to the repository. Include tracked/untracked changes and deletions;
  use `sha256: null, mode: null` for a deletion, otherwise `100644` or `100755`.
  Symlinks/unsupported sources require native inspection and explicit evidence;
  the helper does not silently treat them as verified regular files.
- `diff`: `{path, sha256, bytes}` for the current relevant diff artifact.
- `evidence`: the complete expected set of `{path, sha256, bytes}` references
  to `ctx_test_evidence` report manifests. Root selects this set independently
  so a child cannot hide a failing report by omitting it.
- `requiredChecks`: complete unique `{command, cwd, exit}` entries from the
  root's native gate observations. `exit: null` preserves unavailable evidence;
  exact command/cwd strings must match the cited reports.
- `ci`: for GitHub reports, independent `{report, host, repository, run,
  attempt, headSha, jobs}` selections. `report` is the zero-based evidence
  reference index; `jobs` is the complete selected job-ID set. A passing earlier
  attempt or a different head/job set cannot satisfy the root's current
  selection. Omitting this witness leaves remote evidence uncertain.

The root should enumerate scope from its relevant base through the working
tree, including `git diff --name-only --no-renames <base>` and untracked
deliverables, and inspect the relevant diff independently. Its dirty digest
must identify current staged/unstaged bytes and untracked paths/content/modes.
Do not use HEAD alone for a dirty candidate. The helper does not run Git,
checks, network calls or Org lifecycle commands on the root's behalf.

## Native helper

Run from the package checkout with its pinned development dependencies. Keep
inputs/results in authorized workspace evidence storage, outside Git. Parent
output directories must already exist; each output is a new `.json` file.
All input paths require their exact SHA-256; a changed file is not substituted.

Executor packaging:

```sh
./node_modules/.bin/tsx scripts/review-evidence.ts prepare \
  --workspace "$workspace_root" \
  --current "$executor_state" --current-sha256 "$executor_state_digest" \
  --milestone "L3 evidence-reuse" --output "$packet"
```

Optional `--risks`/`--risks-sha256` identifies a JSON array of risk strings.
The executor packages all checks in every report; packaging performs no review.

Independent root comparison:

```sh
./node_modules/.bin/tsx scripts/review-evidence.ts verify \
  --workspace "$workspace_root" \
  --packet "$packet" --packet-sha256 "$packet_digest" \
  --current "$root_state" --current-sha256 "$root_state_digest" \
  --output "$review_result"
```

For deltas, both preparation and verification additionally take `--previous`
and `--previous-sha256`. The root chooses its own retained previous packet;
a child-selected predecessor is not an independent review baseline. When it
is unavailable, the helper expands the full current scope/evidence and keeps
the missing baseline explicit. A full native review can establish a new
baseline without assuming the previous review occurred.

The library reauthorizes and hashes current source/diff/report/raw test bytes,
compares declared summaries against independently parsed raw tests, and checks
the complete root-selected check inventory. Missing artifacts/unknown formats
remain `needs-evidence`; forged digests, changed identities/scope and hidden
failures are `contradictory`. Cached remote observations require independent
refresh. Original check observations remain unchanged in the result.

The `expand` section lists only changed paths/diff, new evidence, changed risks
and contradiction locators. Unchanged artifacts still undergo authorization
and digest verification internally, but do not need another broad output dump.
Inspect relevant source/diff and cited results independently; expand the
referenced contradictory sections before a verdict. The helper cannot discover
a file/check omitted from both witnesses or authenticate witness provenance.
Root native enumeration and required-gate selection remain mandatory.

Stdout is at most 2048 UTF-8 bytes and references the complete private result
by path, size and digest. Native sandbox restrictions and Read denies apply.
Exit 0 means `ready-for-independent-review`; exit 1 means contradiction or
missing evidence; exit 2 means invalid/unavailable input or output. None means
ACCEPT, REVIEWED, permission to commit, or permission to skip required gates.
