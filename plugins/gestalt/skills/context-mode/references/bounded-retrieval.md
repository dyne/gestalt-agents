# Bounded retrieval fields

Use this reference when selecting response budgets, continuation pages or wider
source windows. Resolve the actual host schema first; installed sessions may
expose older fields than the shipped package. Do not invent equivalent arguments.
These fields control evidence display, never permissions or mutation authority.

## Fields and continuation

| Shipped tool | Fields and continuation |
| --- | --- |
| `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search` | `response_bytes` defaults to 2048 serialized UTF-8 bytes; explicit range 1024–65536. Retrieve an authorized report through `ctx_search` with `response_report` and `response_offset: nextOffset`, without `queries`. Start at returned `offset` (normally 0); stop when `nextOffset` is null. |
| Execute/file/batch | Optional `audit: true` displays executable source within the same response budget. It does not replace native permission review. |
| `ctx_test_evidence` | Separate `maxBytes` budget, 512–2048; `operation: "followup"`, `report`, `offset: nextOffset` page the retained report. For selected full failures, use `failures: {check, offset, limit}` when exposed; these offsets count failures, not report bytes. |
| `ctx_source_map` | `operation: "read"` with `map` or `path`; explicit `range: {start, end}` and `context` widen current-source inspection. `maxBytes` defaults to 2048 (1024–65536). For pages, repeat the same read arguments with returned `revision` and `offset: nextOffset`; every page rechecks authorized live bytes. |

## Decisions and fallback

Before expansion, name the unanswered question, exact source/range and larger
byte budget. For example: “Inspect resolver.ts lines 20–45 with five context
lines, up to 4096 bytes, to test the fallback hypothesis.” Then, if exposed:

```json
{"operation":"read","map":"<returned map id>","range":{"start":20,"end":45},"context":5,"maxBytes":4096}
```

For overflow, substitute the returned report ID and next offset:

```json
{"response_report":"<returned report id>","response_offset":0,"response_bytes":2048}
```

For one missing full failure in test check 0, when supported:

```json
{"operation":"followup","report":"<returned report id>","failures":{"check":0,"offset":7,"limit":1},"maxBytes":1024}
```

Keep unrelated sources at their routine budget. A larger response does not by
itself widen a source window. If fields/tools are absent, derive a bounded
summary from the authorized saved source or use a bounded native source read;
limit printed findings explicitly. Do not restart or reconfigure a live runtime
to gain fields. Governing instructions and current pre-edit reads stay native;
all source edits and Org state mutations stay native.

For a large log, retain the original, report observed exit/counts plus the first
actionable cause, and keep every failure ID/cause retrievable. Query the saved
source or retrieve authorized overflow for a contradictory assertion, missing
failure or insufficient context. Verify report/source digests and candidate
identity; preserve original observation times. A changed/denied/unavailable
report is incomplete evidence, never a passing check. A search covers retrieved
chunks, not the entire log. Reconstruct all failure pages when claiming complete
failure coverage; do not dump those pages into a routine report.

Report command exit, executed/failed/skipped counts, provenance and completeness
separately from summary prose. A successful analysis tool or optimistic summary
cannot turn a failed underlying command into a pass. Display truncation can
coexist with complete capture; it supports a decision only after the relevant
authorized continuation is consumed and verified. Missing, expired or unconsumed
continuation leaves failure coverage incomplete. Known failures remain failed;
zero executed/all-skipped tests and unknown coverage cannot establish a passing
test claim. An oversized individual cause may span bounded pages: reconstruct
it behind the reference instead of dropping or clipping its identifier/context.

Count encoded UTF-8 bytes, including JSON escaping and metadata, rather than
characters. Complete overflow preserves omitted evidence; a clipped display or
smaller byte count does not prove complete capture or diagnostic certainty.

## Artifact reuse

Use `ctx_execute_file` for one-shot analysis; index an authorized saved path once
for repeated questions and scope searches to its source ID. Never roundtrip raw
tool output through inline content. Retain path/source ID, repository identity,
revision or content digest, original capture time, exact command/exit and
completeness with the findings. Unknown exit or coverage stays unknown.

Before reuse, resolve the source and compare current identity, including dirty
tracked and untracked content and relevant dependency/configuration/environment
identities for test evidence. HEAD alone cannot identify a dirty candidate.
Changed bytes or candidate inputs invalidate current claims: read/re-analyze
the current authorized source, or label the retained result historical/stale.
An unchanged digest does not refresh an old remote observation or prove that a
check applies to a different candidate. A fixed age alone proves neither validity
nor staleness; explicit expiry/retention does limit availability.

Missing/expired corpus, source or report references are incomplete evidence.
Re-index the authorized original path when available, then verify its digest and
capture metadata; otherwise report the gap and obtain current evidence. Never
invent a source ID or reuse an unrelated corpus after a missing-source result.

## Fresh receivers

Hand off bounded findings and an accessible path/hash manifest, not raw logs or
private session bindings. With exposed reference support, use `ctx_test_evidence`
`operation: "reference"`, `manifest: {path, sha256}`; otherwise re-index an
authorized original path locally. A report/source ID or sender's access claim
never authorizes another workspace/session. Reauthorize canonical manifest,
artifact and continuation paths, including symlink targets, before reading them.
Verify hashes, candidate/revision, original observation, command exit/counts and
completeness independently; imported metadata alone is not proof. Missing,
denied, expired or changed evidence remains visibly unsupported/stale or
contradictory. Retrieve the smallest authorized missing section or rerun the
required check on the current candidate; do not forward raw logs to bypass denial.
