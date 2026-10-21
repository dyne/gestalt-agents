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

Count encoded UTF-8 bytes, including JSON escaping and metadata, rather than
characters. Complete overflow preserves omitted evidence; a clipped display or
smaller byte count does not prove complete capture or diagnostic certainty.
