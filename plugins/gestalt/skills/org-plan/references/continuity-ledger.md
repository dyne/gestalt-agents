# Compact continuity ledger

## Recording

Read before investigation, recording findings or compaction recovery. Keep one
ledger in the assignment's authorized workspace evidence directory; use native
writes. Update after a changed finding, check, candidate or next decision, not
every turn. It is navigation state, never lifecycle state or review authority.
Org transitions and measurements still use Org tools/helper commands.

## Retained fields

Keep the routine ledger within **2048 UTF-8 bytes**, including metadata. Use
compact JSON or prose retaining these fields and explicit unknowns:

| Field | Retain |
| --- | --- |
| Milestone | Canonical L1/L2 positions and exact IDs. |
| Candidate | Repository, branch, HEAD/start/base, dirty digest including untracked scope; relevant dependency/config and environment identities. Unknown identities prevent test reuse. |
| Instructions read | Exact governing/selected skill/reference paths and content digests for the revisions actually read. A current file hash alone does not prove a prior read. |
| Model policy | Exact current choices/rationale, necessity/return condition and complete [policy packet](model-policy-workflow.md) reference; requested/effective evidence stays distinct. |
| Tested state | Exact command/cwd, candidate identity, observed exit/counts and original UTC time; digest-bound evidence path/locator. Unknown, failed and incomplete checks stay explicit. |
| Findings | Short supported observations with evidence references; preserve uncertainty and invalidation. |
| Open hypotheses | Question, next focused check, observed result/evidence, status and next decision; not reasoning transcripts. |
| Source navigation | Paths/ranges and revision-bound source-map IDs or evidence references; leads to reauthorize and inspect, not assertions of current source. |
| Next decision | Concrete next authorized action and its unresolved prerequisite. |
| Overflow | Omitted entry/byte counts and authorized complete manifest path/digest/size; none when all fields fit. |

No prompts, conversations, raw logs or reasoning transcripts. Link complete
evidence instead of copying it. If the ledger exceeds its budget, retain core
identity/next decision and references in the bounded summary; put all omitted
fields and failures in a complete manifest. Missing or denied overflow is
incomplete evidence; never truncate silently or treat absent details as passes.

## Focused investigations

Keep a short hypothesis/result record in this same ledger, not a second diary.
Before repeating an investigation, retrieve its candidate-bound result and open
question. Choose the smallest check that can disprove the current hypothesis;
record the observed result/evidence and next decision. Preserve unknowns and
contradictions; do not regenerate a finished investigation after compaction.
If identity or evidence is invalidated, inspect the changed source and rerun
affected checks before reuse.

During iteration use focused checks for the changed behavior and affected shared
code. Shared-code/dependency/config/environment changes invalidate dependent
test evidence; expand verification to the affected regressions. Full suite and
complete scope remain mandatory at L1 completion/acceptance, with independent
review and all existing gates. Focused success never substitutes for that gate.

| Diagnostic need | Action |
| --- | --- |
| One-off source lookup or count | Use the bounded native/context-mode command; do not introduce a helper. |
| The same evidence fields/ranges are extracted across several actual checks | Reuse an existing small diagnostic helper. Only after repeated structure is proven, extract a scoped helper if none fits; verify it and retain original artifacts. |
| A changed candidate contradicts a retained result | Reopen the affected hypothesis and rerun its focused check; do not reuse the old pass. |

Prefer existing selectors/reporters to regenerating large inline scripts. Keep
helpers within authorized scope and permission boundaries; they do not replace
source inspection, complete evidence or required gates. This workflow never
automatically splits an active approved milestone or adds progress approvals.

## Recovery

1. Read the ledger and required authorized references rather than reconstructing
   the session. Fresh role/session startup still performs all mandatory governing
   reads in their required order; a ledger cannot substitute for them.
2. Compare recorded instruction revisions with current authorized files. Reuse
   already-read instructions only when their revision and context remain known.
   Reread changed or missing-context instructions natively in full before acting;
   never fabricate a read revision. Tool-set changes still invalidate bindings.
3. Refresh authoritative plan/ownership and current candidate identity. Changed
   SHA, dirty scope, dependency/config or environment invalidates affected tested
   state; retain it as historical and rerun affected checks. A fixed age alone
   proves neither validity nor staleness. Unknown identities require verification.
   For versioned policy, read the complete packet and current choices/rationale;
   use its continuation decisions and refresh admission before edits.
4. Resolve evidence paths/digests/locators and original observations. Unsupported
   ledger assertions remain unverified; contradictions require source inspection
   and focused checks. Ledger assertions never replace independent verification,
   required tests, full-scope review or acceptance.
5. Retrieve source-map/current-source deltas when useful, reauthorize current
   bytes and perform native pre-edit inspection. Missing maps fall back to
   authorized source reads. Follow the retained next decision within the assigned
   scope; recovery does not authorize replanning, replacement, commits or gate waivers.

The test-only continuity fixtures exercise identity/revision invalidation,
evidence contradictions and lossless bounded overflow. They validate this
portable contract, not model memory or a running supervision controller.
