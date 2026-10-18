# Instruction delivery and preservation ledger

Baseline: `b6f72d2561c870f1901daa0bf4716e8f926707aa`, captured before instruction
edits on `plan/context-evidence-efficiency`. Counts are whitespace-delimited words
and UTF-8 bytes, not tokens or subscription usage. Reproduce with
`python3 tests/plugins/gestalt/instruction-baseline.py --json`; the committed
`instruction-baseline.json` preserves the starting measurements. This ledger is
test/review material, never an additional agent instruction entrypoint.

## Delivered sources

| Source | Activation and delivery | Baseline words / bytes |
| --- | --- | --- |
| Repository `AGENTS.md` | Governs work in this checkout; all three roles read it | 703 / 5239 |
| `plugins/gestalt/skills/org-plan/SKILL.md` | Explicit Org workflow; mandatory first standalone read by root/executor, supplied to terminal reviewer | 2450 / 17623 |
| Org `references/supervised-execution.md` | Mandatory next governing read for supervised roles; supplied to terminal reviewer | 3350 / 23017 |
| `plugins/gestalt/skills/context-mode/SKILL.md` | Host-provided implicit workflow routing; not an optional L1 skill | 829 / 5832 |
| Generated reviewer `developer_instructions` | `scripts/org-plan prepare-supervision`, invoked by `gestalt-setup.sh`, installs `org-plan-reviewer.toml` into selected agents directory | 785 / 5441 |
| Generated executor `developer_instructions` | Same setup installs `org-plan-executor.toml`; legacy `prepare-executor` is also supported | 336 / 2310 |
| Terminal reviewer | Fresh `default` agent with standalone assignment, no generated reviewer profile | no additional fixed profile |
| `plugins/context-mode/configs/codex/AGENTS.md` | Retained vendor configuration example, **inactive in Gestalt setup** | 710 / 5280 |

The Gestalt manifest exposes `./skills/`; its catalog verifier validates that
single source tree. Context-mode's manifest exposes MCP, not another skills
tree. Setup installs the external runtime and invokes
`plugins/context-mode/scripts/configure-codex.mjs` for native MCP/hooks; that
configurator does not install the vendor AGENTS example. Adapter/doctor support
for other/manual configurations is not proof of delivery in this setup. Do not
edit that inactive example to claim savings. Likewise README and optional
protocol/state/diagnostic references load only when their routing conditions
apply; they are not counted in the normal supervised path.

Measured common path: repository + Org entrypoint + supervision reference +
context-mode routing. Root adds reviewer profile: **8117 words / 57152 bytes**.
Executor adds executor profile: **7668 / 54021**. Terminal reviewer common path:
**7332 / 51711**. These reproducible, repository-controlled path totals exclude
host system messages, variable assignments, task-specific optional skills, and
other implicitly supplied workflow skills. They are not a claim to measure the
entire live prompt. No tokenizer was used. Existing sessions retain their loaded
instructions; source edits do not update or restart them.

## Old-to-new requirements map

Abbreviations: **O** = Org SKILL, **S** = supervised-execution reference,
**A** = repository AGENTS, **P** = generated profiles, **C** = context-mode SKILL.
**E** = Org `references/evidence-report.md`, added in L2 and required before
reporting or evaluating evidence; it is included in every measured role path.
Section names below identify canonical destinations for consolidation. Bootstrap
copies remain only where needed before the mandatory governing reads. This map
covers every normative block in the four edited documents and generated text;
each row preserves all listed clauses, not just its topic name.

| ID | Original homes and required behavior | Canonical destination / permitted removal |
| --- | --- | --- |
| scope | O Route/Choose: simplest viable plan, fresh lesser-model executability; ordinary bounded work uses native planning; select durable Org only for explicit need | O Route planning work |
| authority | O/A: authoring is separate authorization, stop at validated handoff until ordered execution; no setup during ordinary supervision; exact supplied skill/helper/plan, workspace root independent of repo | O Choose a workflow; S Start supervision for strict startup ordering |
| format | O invariants 1–3: one nonempty SKILLS and REVIEW_STATUS per L1, UNREVIEWED initially, neither on L2; smallest exact optional catalog skills, implicit Gestalt excluded, xerj readiness conditional | O Invariants |
| skill-load | O/S/P: verify and load exactly declared optional skills before repository inspection/edits; missing inputs/skills stop without edits | O Invariants; P retains pre-inspection guard |
| identity | O/S/A/P: one-based L1/L2 labels, IDs remain keys, exact l0/l<a> roster/task names, no title/role suffix | S Canonical positions and agent names; O shared position convention |
| replacement | O/S/P: use only exact physical identity from durable Mobile authorization with predecessor/evidence; never infer generations; absent authorization resume assigned physical executor or report control conflict | S Canonical positions and agent names; compact P guard |
| roles | S/A/P: root directs/supervises/reviews read-only; one depth-one sole writer per entire L1; executor reports only root; recommended profiles do not force running root model; no user-config edits for unavailable spawning | S Roles and ownership |
| startup | O/S/A/P: first tool call reads skill completely alone; then S and governing A; loaded skill directory and exact plan are inputs, verify helper executable once; missing input stops; no speculative search/help/source probe or prepare-supervision | S Start supervision; P retains bootstrap order |
| activation | O/S/A/P: new/resumed relay validates exact incomplete plan and signals supervision-start before recovery/followup/spawn even if already WIP; same-session retention preserves manual Off, fresh session activates | S Start supervision |
| health | O/S: verify enabled healthy retained-plan control after signal; optional/unavailable Mobile status yields one compatibility warning and same-turn continuous supervision | S Activation and legal dispositions |
| selection | S: predecessor REVIEWED, previous executor terminated/closure confirmed, describe next L1, launch fresh canonical depth-one executor with fork_turns=none; exact replacement exception only | S Start supervision |
| state | O/S/A/P: helper-only transitions/measurements, no hand edits; typed tool preferred, bundled helper fallback; side-effect-free help; status publication optional without destination | O Choose a workflow / Invariants; CLI reference for command syntax |
| projection | O/S/A/P: active root alone projects after authoring-start, supervision-start, set, l2, review, suspend-reopen, resume, external resync; exact plan array, companion explanation separate, short L1 statuses; warning on host failure preserves authoritative Org | O Invariants; S points there |
| dependencies | O: compatible consumption and single writer for suspend-reopen/resume; reopening resets review, explicit reset before material completed-reviewed correction without reopening | O Invariants and linked CLI state machine |
| evidence | O/S/P: current focused tests and intended scope per L2; all children DONE plus fresh full suite and complete intended L1 diff before L1 DONE/review | O Invariants; S Evidence and review loop; E fields and independent verification add bounded, retrievable observations without changing gates |
| eligibility | O/S/P: review only helper-selected DONE + UNREVIEWED L1; skip REVIEWED; no pending review means milestone review current | S Evidence and review loop |
| reject | O/S/P: explicit independent root ACCEPT/REJECT; unchanged substantive findings to same writer, correct same uncommitted diff, repeat gates, no progress approval | S Evidence and review loop |
| commit | O/S/A/P: uncommitted L2s through L1 review; after explicit ACCEPT exactly one conventional commit if changed, no fixup/autosquash; no-change recorded; then REVIEWED, project, root verifies subject/scope and terminates writer | O Invariants; S Evidence and review loop |
| no-org-git | O/S/A/P: workspace-local .gestalt plans never Git deliverables under any override; both roles inspect cached names immediately before accepted commits and exclude active plan/all .gestalt/*.org even force-added; do not announce intentionally-untracked plan | O Invariants; P retains staged-path guard |
| report | O/S/P: executor owns whole L1, reports concise evidence at each DONE L2 and ends executor turn while remaining assigned; partial nonboundary/idle reports receive immediate followup, user status questions do not replace continuation | S Evidence and review loop |
| disposition | O/S/A/P: incomplete-plan yield requires action/followup/review/checkpoint/accepted lease/table attention/manual Off; prose never suffices; completion/error/interruption/idle/process/status question are wake inputs; actionable work needs no probe/lease | S Activation and legal dispositions |
| lease | O/S/A/P: v2, unique reportId/leaseId, smallest wake set, 60000–86400000ms; accepted:true alone permits yield; absent/rejected/wakeAlreadySatisfied inspect and continue same turn; one episode, reassess later, never hide idle or await checkpoint | S One-shot long-wait lease |
| watcher | S: executorChanged for long child work; process wake conditions for owned process; synchronous gh checks watcher --watch --interval 30, short initial yield, processExited/processResultAvailable lease, inspect same result; no Mobile credentials/poller; v1 only explicit legacy request | S One-shot long-wait lease |
| attention | O/S/P: optional not dependency, exhaust safe checks, exact six reason/resume pairs only; Mobile derives summary/action; success ends turn, absent reports ordinary blocker; no progress/review/checkpoint/time/idle/recoverable-failure attention | O Human-attention decision table; S links to mandatory O |
| checkpoint | O/S/A/P: finite idempotent persist/ack, never wait lease/executorChanged; only recorded allows one immediate final as last tool call; alreadyRecorded reconciles without duplicate, failed/missing/rejected/terminated/resultless means same-turn supervision | S Completed-L2 boundary |
| handoff | O/S: next fenced turn from checkpointChanged after matching final; checkpointHandoffFailed rereads durable state/control without blind replay/attention/replacement; safetyPaused requires Mobile/manual recovery | S Completed-L2 boundary |
| l2-boundary | O/S/P: root validates state/evidence/scope and projects before l2Completed with only kind; final template rolls new outcome/files/commands/verification/next into one screen, pending commit; even final L2 gets boundary before full-suite review; later turn follows same executor; missing tool commentary + same-turn followup | S Completed-L2 boundary |
| l1-boundary | O/S/P: accepted/committed/REVIEWED/projected precede optional l1Accepted only-kind checkpoint, last call then finite template final; mandatory end even absent checkpoint, no next L1/docs commentary; later turn revalidates and launches fresh executor or terminal review | S Accepted-L1 boundary |
| capacity | O/S/P: after init failure inspect roster, stale pending_init fills slots despite interrupt: root calls recovery once v1 agentThreadLimit; accepted handoff preserves durable root/plan, no retry or human attention; blocker only unavailable/rejected | S Evidence and review loop |
| terminal | O/S/P: every L1 DONE+REVIEWED, last executor terminated/no writer; fresh depth-one default final_review fork_turns=none, omit model/effort, explicit duties and whole-branch overview/base/HEAD/commits/tests/tradeoffs/read-only plan; severity-ranked findings | S Terminal whole-branch review |
| terminal-fixes | O/S/P: terminal reviewer sole exception to separate-reviewer ban, sole writer only P0/P1 corrections, fix all/add regressions/focused+full gates, root accepts one conventional correction commit excluding Org; retain lower findings; no unresolved P0/P1 | S Terminal whole-branch review |
| terminal-report | O/S: current root-side full suite and clean intended scope; optional terminalReviewAccepted only after terminal gates; sole whole-plan success reports verdict/corrections/gates/residuals/scope/all commits, not repeat L1 final/raw logs | S Terminal whole-plan report |
| manual | O: WIP else first TODO selection, exact optional skills, helper state; focused L2 then immediately next (manual has no executor-turn boundary); all-DONE full-suite/L1 DONE/helper-selected review, same-diff corrections, one accepted commit/REVIEWED, continue all milestones | O Manual execution loop; shared gates referenced |
| authoring | O: workspace .gestalt short kebab filename no date, legacy supplied paths readable; metadata/fields from format, validate skeleton before signal and coherent changes after; inspect optional catalog, dependency order/context/tests, remove material ambiguity, branch and baseline before handoff | O Authoring workflow |
| bounded-evidence | O/S/C/P: governing instructions/small bounded/pre-edit reads native, native edits/mutations/short commands/live session/image; large/uncertain analysis through context-mode; fallback file capture then command/status/counts/minimal excerpt; never raw logs/transcripts upward | C Routing contract; O/S role-specific evidence duties; E owns 2048-byte reports, explicit unknowns, failure references and overflow |
| tools-permission | C: actual exposed native equivalents/prefixes only, no invented aliases; context-mode never grants side effects/ownership/Org transitions/optional task skills; no implicit context-mode SKILLS declaration | C Routing contract / Org Plan execution |
| retrieval | C: explicitly print derived findings with paths/IDs/lines/values/status, no whole objects/logs; large local path indexing vs small inline content, scoped batched specific searches, index once for repeated questions; verify empty search root/ignored/symlinks; huge single-line structured parse with original preserved | C Output rules / Files and browser output |
| browser | C: save tool/browser output directly to filename then analyze/index, never roundtrip large response via inline content; linked browser patterns, available tools selection table and host prefixes retained | C Files and browser output |
| session | C/S: independent agent contexts, persist conclusions not assumed transient output; role assignments self-contained exact full L1/L2/base/prior outputs/scope/tests/skills/gates/prohibitions/blockers, no inherited 'continue above' | C Org Plan execution; S Standalone assignments (selected block once or exact required section reads); E assignment/review forms; tool resolution cached only for its valid session |
| communication | S: bounded evidence ownership, no raw upward transcripts; root updates start/review/reject/accept/block; canonical position/title and goal first, conventional subject purpose then optional hash; routine review agent-to-agent, ask user only genuine ambiguity/prerequisite | S Reporting evidence ownership |
| durable-guidance | O/A: update A only for completed durable repo instruction changes; profiles are bootstrap summaries, do not duplicate full state machine; tests cover bootstrap/startup/TOML/budgets instead of every sentence | A Org Plan development |
| vendoring | A: single canonical nested skill tree, manifests/discovery, complete directory metadata/modes/references, pinned upstream attribution/license, no symlinks; adapted version/provenance/checksums; clean temp distributable discovery strips terminal controls/exact names once; verify all package metadata/full suite/diff; no silent plugin install/disable | A Vendoring skills (unchanged) |

No destination may rely on optional future tools or references a role does not
load. O and S are mandatory for supervised roles. Manual execution must retain
its own gates in O or an explicitly mandatory linked manual reference. Protocol,
CLI-state, plan-format, and startup-diagnostics references remain conditional
detail; their existing contents are outside this deduplication baseline.

## Sanitized evidence and baseline failure

`context-evidence-workflows.json` describes four deterministically generated
logs over 20 KiB: pass, two failures with multiline causes, setup failure before
tests, and explicitly unknown/incomplete format. Expected identifiers, exit
codes, SHA-256 and byte counts are validated by the harness. The repeated-query
fixture asks three questions of one terminal synthetic run; the uncached
baseline is three fetches/indexes and three full log returns. These are a test
model, not observed network activity or a claim that reuse already exists.

Startup `bash tests/run.sh` exited 1 after discovery passed, in
`test-upstream-vendor.sh`. All content digests matched. Exactly 429 checkout
file modes differed from the committed fixture (group-writable 0664/0775 rather
than 0644/0755); the test prints only the first five. Restoring recorded modes
is environment normalization, not a content/checksum-fixture change. Preserve
this baseline classification independently of later passing gates. Local raw
log: `/tmp/context-evidence-l1-baseline.log` (not a deliverable).

## Consolidation result and review boundary

Shared lifecycle/state/Git invariants remain in O. Identity, startup, leases,
checkpoints, capacity recovery, review and terminal procedures now have their
single detailed home in S. Its attention section routes to O's decision table.
A retains repository development/testing and vendoring rules; P retains role,
startup order, ownership, authority and critical continuation guards before
deferring to required reads. C keeps native operations and analysis routing,
with duplicate tool-table rows removed. All destinations in the map above
remain on the applicable role's required loading path. Conditional references
and inactive vendor guidance were not substituted for mandatory rules.

| Role | Before words / bytes | After words / bytes | Word reduction |
| --- | --- | --- | --- |
| Root | 8117 / 57152 | 6392 / 45798 | 21.3% |
| Executor | 7668 / 54021 | 6167 / 44026 | 19.6% |
| Terminal reviewer | 7332 / 51711 | 5864 / 41958 | 20.0% |

`org-plan-instruction-scenarios.json` supplies 30 static scenario contracts;
`instruction-contract.py` reads the actual canonical sections and decision
table rows, validates generated TOML delivery in isolated temporary directories,
checks links/anchors and smaller role paths, and rejects a reversed lease-action
negative control. These are instruction contracts, not a simulation of agent or
Mobile behavior. Human review must also check semantic equivalence using every
row of the ledger. Runtime state-machine tests remain separate and unchanged.
Existing source/profile budgets are tightened to the new scope; sentence-copy
assertions were moved from generated profiles/AGENTS to the canonical scenario
contracts. No runtime algorithm, permission, service, or installed profile was
changed.

## Release verification

The maintained `tests/run.sh` gate discovers `test-instruction-contract.sh`
automatically. Current full-suite execution confirms all 27 discovered shell
gates ran: 9 repository, 16 Gestalt, 2 context-mode. This includes 464 Org
assertions, the 30 instruction scenarios, exact skill discovery, manifest/skill
metadata validation, setup/profile contracts, context-mode smoke tests, and
vendor integrity/drift checks. The reduction from 498 Org assertions replaces
duplicated sentence checks with canonical scenarios; runtime transition checks
were retained.

`tests/repository/test-release-artifacts.sh` snapshots current distributable
content in an isolated Git fixture. It verifies archive instruction bytes,
single skill-provider selection, and exact generated-profile equality between
the source helper and archived helper. No installed profile or service is
changed. No vendor content, attribution, manifest, version, or checksum fixture
needed revision. The original checkout-permission baseline failure above
remains distinct from the now-passing suite.

## L2 evidence contract and role integration

E is the single report contract for local tests and GitHub results. It adds
milestone/scope/candidate/source/checks/observation/completeness/references/overflow
fields, unknown-versus-zero semantics, dirty-diff identity, and independently
retrievable failures within a default 2048 UTF-8 byte report. Root verifies
identity, freshness, relevant diff and cited test evidence. Stale, missing or
contradictory evidence causes bounded retrieval or same-writer correction, not
acceptance or an attention request. Existing lifecycle/checkpoint/commit gates
remain in O/S. No fetching, ingestion, caching runtime or Mobile scheduling is
implemented by L2.

The E cost is **1033 words / 7623 bytes**, now included in the reproducible
`instruction-baseline.py` inventory for root, executor and terminal reviewer.
The original baseline JSON remains unchanged. The previous consolidation table
is historical L1 evidence; current totals include the new mandatory read and
role-integration guidance:

| Role | Original words / bytes | L2 words / bytes | Word reduction |
| --- | --- | --- | --- |
| Root | 8117 / 57152 | 7514 / 54210 | 7.4% |
| Executor | 7668 / 54021 | 7289 / 52438 | 4.9% |
| Terminal reviewer | 7332 / 51711 | 6986 / 50370 | 4.7% |

All three remain below original word/byte budgets. These are repository-owned
instruction paths, not measurements of whole live prompts or allowance savings.
The first L2 full-suite attempt exposed the existing 3100-word per-file S limit.
After condensing integration to links and forms, S is 3133 words (58 above L1).
Its limit is explicitly revised to 3200 to accommodate required evidence routing
and selected-section assignment/review guidance; E has a separate 1100-word
limit. Whole-role tests still require smaller paths than the immutable original
baseline, including E. This is a documented instruction-cost exception, not a
hidden omission or a claim that the first full-suite attempt passed.
The new E reference is compared byte-for-byte against archive delivery alongside
the existing required instruction sources. Context-mode routing resolves only
needed tool fields and caches bindings within a valid session, invalidating on
reconnect/tool change/unavailability. Governing reads and complete scope/diff
checks remain native and mandatory.

The maintained shell gate automatically discovers `test-evidence-contract.sh`.
It tests 15 sanitized evidence/review decisions, local and GitHub identities,
all omitted failure identifiers through bounded retrieval, UTF-8 byte budgets,
and generated assignment/review forms from E (1030/915 bytes). Its artifact
oracle reads evidence independently of report claims; this is a test-only
contract model, not a runtime parser or simulation of model behavior. The
instruction gate now covers 36 static scenarios, including contract fields,
overflow, independent verification, bounded assignments/review and tool-session
validity. Human review still assesses semantic instruction equivalence.

Current L2 verification: `npm_config_cache=/tmp/context-evidence-l2-npm-cache bash
tests/run.sh` exits 0 across 28 discovered gates (9 repository, 17 Gestalt,
2 context-mode), including 465 Org checks, 36 instruction scenarios and the
15 evidence decisions. Archive delivery equality includes E. Focused contract
gates and `git diff --check` pass. An earlier default-cache attempt stopped in
discovery because npm could not write its read-only home cache (`EROFS`);
redirecting only that cache to task-local `/tmp` resolves it. This environment
failure is separate from the original file-mode baseline and from the repaired
per-file instruction-budget failure. No installed profile or service changed.
