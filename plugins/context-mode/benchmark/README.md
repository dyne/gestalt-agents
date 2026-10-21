# Synthetic model-payload corpus

`fixtures/model-payloads.json` contains invented inputs for retrieval, overlapping
queries, changed-source rereads, a simulated ten-minute CI wait, independent
review, bounded stats, nine counter regressions and five response envelopes.
No live conversation, incident transcript, provider call or real CI wait is used.

The manifest freezes the corpus and individual input digests, actual starting
revision `e0ad0de2eecf1d1334c876304d1eeb4f35a5c1a4`, package-lock digest and reference
Node/platform/ABI. Literal UTF-8 envelope sizes were calculated with Python;
token totals and test partitions are independent arithmetic. Expectations must
never be regenerated using the accounting implementation being tested.

Run the candidate repeatability checks with:

```sh
node_modules/.bin/vitest run tests/benchmark/model-payloads.test.ts
```

For a real pair, prepare a clean detached checkout of the pinned baseline within
the authorized workspace. Use the same locked dependency bytes for both sides,
then build the baseline with `npm run build`. Do not use the historical incident
checkout or a previously modified candidate as the baseline. Run:

```sh
npm run benchmark:payloads -- --compare /absolute/baseline/plugins/context-mode /absolute/candidate/plugins/context-mode /absolute/metrics-report.json
```

Each side runs in a fresh child with temporary workspace/state and a disposable
home resolver. Credentials and live session/config variables are not inherited.
The baseline revision and clean source state are checked; both dependency-lock
and actual environment identities must match. Temporary files are removed before
metrics are returned. The reference environment remains recorded when rerunning
on a different environment; such results are a new controlled pair, not evidence
of historical latency or model cost.

The runner invokes real registered production handlers, verifies every planted
failure and completeness assertion, and restores changed-source revision inputs.
It measures complete returned MCP-result envelopes, request JSON and relevant
tool-description bytes. Every overflow request and response envelope contributes
to comparison costs. Runtime-generated references can affect byte counts;
repeatability requires identical input digests, expected totals, coverage and
findings rather than artificial wall-clock equality. CI elapsed times are only
fixture values.

Unsupported baseline metrics remain unknown. Unserializable response sizes remain
null. No savings ratio is emitted for unsupported or incomplete comparison scope.
There are no JSON-RPC framing, provider-token, billing, account-quota, live-session
or model-latency claims. L2–L9 can reuse these inputs and quality gates while
changing their own response, retrieval, scheduling, review or model policies.

To revise the corpus deliberately, review the invented inputs and derive new
expected values independently. Recompute the corpus/input SHA-256 values using a
standard digest tool, update the reference identity when appropriate, and rerun
both sides. A changed digest is a new corpus revision; previous comparisons do
not become fresh evidence for it.

The L2 response comparison also separates `routineReturnedBytes` (initial
index/search or execution result envelopes) from complete authorized evidence
retrieval. It follows returned report handles through registered `ctx_search`,
checks page bounds and SHA-256, and counts every followup request and response.
`auditRetrievalBytes` and `overflowRetrievalBytes` include both directions.
A broad-retrieval comparison requires at least 50% fewer routine returned bytes
and every frozen expected finding recoverable. The same 50% gate applies to
`routineVisibleBytes`, which adds initial requests and unique initial tool
descriptions. It does not require every finding
in the initial summary. Added full-source/audit retrieval has broader evidence
scope than baseline snippets: total costs remain visible and total savings are
null for that incomparable scope. Small overlapping queries and short commands
can cost more because provenance and access metadata are included.
