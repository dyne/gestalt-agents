# Supervisor evidence contract

Use this format for local tests and GitHub evidence. It describes observations,
not acceptance or authority to change lifecycle state. The supervised-execution
reference owns review and checkpoint gates. Read this contract before preparing
or evaluating a report; it requires no additional tool or service.

## Report fields (version 1)

JSON is a portable example representation, not a requirement to print JSON.
Compact prose or a table must retain these fields and explicit unknowns.

| Field | Required meaning |
| --- | --- |
| `milestone` | Canonical position and machine ID; distinguish an L2 report from L1 review. |
| `scope` | Sorted changed paths, relevant diff/base reference and shared-code impact; `none` when unchanged. Large lists use a bounded count plus a retrievable manifest. |
| `candidate` | Full candidate SHA, branch and starting/base SHA. For uncommitted work also cite a digest of the relevant diff including untracked deliverables; HEAD alone cannot identify a dirty candidate. |
| `source` | `local` or `github`; repository identity and run, attempt and job IDs where applicable. Use `null` with a reason for inapplicable or unavailable identities; never invent an ID. GitHub includes host/repository, head SHA and selected artifact identity. |
| `checks` | One entry per exact command, with working directory, exit status, passed/failed/skipped/total counts, first actionable failure (test/step ID and minimal cause), and evidence references. Unknown exit/counts are `null` with a reason, not zero. Setup failure may have zero tests and a nonzero exit. |
| `observedAt` | UTC observation time per capture/check; retain source completion time when available. A recent retrieval time does not make an old run fresh. |
| `completeness` | `complete`, `partial` or `unknown`, with coverage and reason for omitted jobs, truncated logs, unsupported formats or missing/expired artifacts. Capture completeness and diagnostic certainty are separate: complete bytes in an unknown format do not establish a passing test result. |
| `references` | Retrievable artifact/path or source/index ID plus digest and line/section locator; record access scope and retention limits. Keep original evidence outside chat. A transient tool response alone is not a durable reference. |
| `overflow` | Omitted entry/byte count and reference to the remaining details, or `none`. Preserve all failure identifiers in retrievable evidence. |

## Bounded reporting

Default to **2048 UTF-8 bytes (2 KiB)** for the entire routine report, including
labels and references. Count encoded bytes, not characters or tokens. Give the
first actionable failure inline and the total number of failures; retain every
failure and contextual cause behind a reference. Never truncate a report or
silently drop failures to fit the budget. If required identities and findings
cannot fit, declare overflow, provide a retrievable manifest, and request or
send a specifically bounded follow-up (default 2048 bytes per response). An
explicitly agreed larger budget must state its byte limit and reason.

An overflow manifest preserves omitted report fields and all failure
identifiers/locations. Report its byte size, digest and access path. A missing
manifest is incomplete evidence. Do not emit full logs, whole JSON responses,
tool catalogs or transcripts. References must stay within authorized scope;
if another agent cannot access an index, share an authorized evidence manifest
and let it re-index locally rather than assuming cross-session access.

## Independent root verification

Before relying on a report, the root checks these in order using bounded
retrieval. These are evidence decisions, not replacements for lifecycle gates.

1. Match milestone, repository, branch, candidate SHA, base and dirty diff
   digest against current Git and intended changed paths. Verify GitHub
   run/attempt/job identities and head SHA against the selected run; a passing
   earlier attempt is not evidence for its rerun. Scope checks include untracked
   deliverables and relevant shared-code impact.
2. Check observation/completion times and whether code, attempt, jobs or
   artifacts changed afterward. Reject stale evidence for the current candidate;
   refresh or rerun the affected checks. No fixed age alone proves freshness.
   Cached GitHub captures retain their original observation; use `github.refresh`
   when current remote state is needed. Matching digests establish local byte
   identity, not remote freshness.
3. Resolve cited evidence, verify digest and locators, and inspect relevant diff
   and test summaries independently. Compare exact commands, exit statuses,
   counts, failures and coverage. Rerun focused/full checks as the review gate
   requires or when provenance cannot establish them. A child summary is not
   independent verification.
4. Record `supported` only for claims established by available, consistent,
   current evidence. Known failures mean `failed`; unsupported formats, partial
   captures or unavailable references mean `needs-evidence`, even if a command
   exited zero. Contradictions mean `contradictory`: retrieve the conflicting
   excerpt/metadata and reconcile or rerun before accepting any success claim.

Ask the same executor for the smallest missing field, bounded failure section,
artifact or fresh check. Escalation here means expanding evidence retrieval or
returning review corrections, not requesting human attention. Recoverable
failures, unknowns and overflow continue normal supervision. Only an exhausted
external blocker uses the Org skill's attention decision table. Never assert
unavailable evidence as verified; preserve uncertainty in the report and review.

## Assignment and review forms

These compact forms complement the required assignment/review fields in the
supervised lifecycle; reference those rules instead of copying them. Replace
placeholders with current values. Use section references only when accessible
and require the recipient to read them. These are task data, not governing reads.

```text
Assignment: {milestone}; task_name {executor}; sole writer for entire L1.
Inputs: {plan_section}; {governing_reads}; optional skills {skills}.
Candidate: {repository}; {branch}; base {base}; starting SHA {sha}.
Scope/tests/prior outputs/prohibitions: {task_sections}.
Evidence: read {contract}; default 2048 UTF-8 bytes; artifacts {evidence_location}.
Report: milestone, scope, candidate, source, checks, observedAt, completeness,
references, overflow; explicit unknowns. Root verifies independently.
Lifecycle/boundaries/corrections/commit: supervised-execution.md.
```

```text
Review: {milestone}; {plan_section}; DONE + UNREVIEWED.
Candidate: {repository}; {branch}; base {base}; starting SHA {sha}; {dirty_digest}.
Criteria/scope/impact/prohibitions: {task_sections}.
Evidence: {report_reference}; {exact_commands_and_results}; {observed_at}.
Root: verify identities/freshness, relevant diff and cited test evidence;
retrieve missing/conflicting sections before deciding. Return findings and
explicit ACCEPT or REJECT under supervised-execution.md.
```

L2 reports use the fields above; L1 review adds complete scope and full-suite
evidence. User-facing boundary templates remain in supervised-execution.md and
summarize root-verified outcomes; they need not repeat the agent evidence packet.

## Contract fixtures

`tests/plugins/gestalt/evidence-contract.py` validates sanitized report examples
and independent artifact checks for success, multiple failures, unknown format,
partial capture, stale SHA, contradiction, missing artifact and bounded overflow.
It is a test-only contract model, not a log parser, GitHub fetcher or simulation
of agent behavior. Future ingestion must preserve these fields and uncertainty.
