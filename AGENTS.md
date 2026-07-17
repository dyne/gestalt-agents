# Agent repository guidance

## Org Plan supervised workflow invariants

- The director is depth zero in the user's initial Codex conversation and may
  use any CLI-selected model. The depth-one supervisor defaults to Luna and
  reports only to the director. The depth-two executor defaults to Terra and is
  the only code writer. The depth-two read-only reviewer defaults to Sol and
  reviews only assigned DONE + UNREVIEWED L1s. Both depth-two roles report only
  to the supervisor, never directly to the director.
- Every L1 must have exactly one `:REVIEW_STATUS:` property, initially
  `UNREVIEWED`; L2s must not have one. `REVIEWED` is valid only after reviewer
  acceptance of a DONE L1. Reopening a reviewed L1 as WIP resets it to
  `UNREVIEWED`; reset a completed reviewed L1 explicitly before any material
  correction that does not reopen it.
- Use `org-plan next PLAN review` to select the first DONE + UNREVIEWED L1,
  `org-plan review PLAN ID REVIEWED|UNREVIEWED` for durable transitions, and
  `org-plan describe PLAN ID` for stable title plus Goal/Why text. The reviewer
  skips already REVIEWED milestones, so appended refinement L1s do not trigger
  repeat audits of accepted work.
- Keep one writer active. The supervisor delegates implementation and corrective
  edits only to the executor; the reviewer is read-only. Executor and reviewer
  evidence reaches the director only through concise supervisor summaries.
- Run potentially large inspections, tests, and log processing through an
  available context-preserving execution path. If none is available, capture
  output outside conversational context and report only the command, exit
  status, pass/fail counts, affected scope, and smallest necessary failure
  excerpt. Short fixed-output observations may remain direct. Do not install,
  require, or silently enable an optional context-management plugin.
- Human-facing director updates resolve the first milestone mention with
  `org-plan describe` and lead with its title and Goal/Why; later mentions may
  use the title alone. Lead the first commit mention with its conventional
  subject and purpose; IDs and hashes are supplemental. Machine assignments
  retain exact IDs and commit ranges.
- Final acceptance requires the supervisor to verify a current full-suite pass
  and clean intended scope. It does not repeat reviewer audits for REVIEWED L1s.

## Vendoring skills for Codex and `npx skills`

Keep one canonical copy under
`plugins/<plugin-name>/skills/<skill-name>/`. Codex loads that tree through
`.codex-plugin/plugin.json` with `"skills": "./skills/"`; the marketplace entry
points to `./plugins/<plugin-name>`, producing
`<plugin-name>@dyne-gestalt-agents`.

The `skills` CLI recursively discovers `SKILL.md` files when no standard
top-level skill container is present. The same nested directories therefore
appear individually in `npx skills add dyne/gestalt-agents --list`. Do not add a
duplicate root `skills/` tree or repository symlinks: copies drift, while
symlink behavior differs across installers and operating systems.

Vendor complete directories, including references, scripts, examples, assets,
agent metadata, executable modes, and relative paths. Record the upstream
repository, release, commit, and license. Exact vendors use a committed SHA-256
manifest for relative paths, regular-file types, executable modes, and contents;
reject symlinks in the vendored tree.

If project coherence requires instruction changes, treat the package as an
attributed downstream adaptation rather than an exact vendor. Record every
rename, omission, and behavioral change in the plugin's `UPSTREAM.md`; use a
distinct downstream packaging version; and make the checksum fixture describe
the adapted package state. On update, import a new pinned upstream version,
reapply and reassess the documented adaptations, then regenerate the fixture.

Verify plugin manifests, marketplace metadata, checksums, `SKILL.md`
frontmatter, `agents/openai.yaml`, individual `npx skills` discovery, the full
test suite, and `git diff --check`.

Run `npx skills` discovery against a clean temporary copy of distributable
plugin content, excluding ignored references and development fixtures. Strip
terminal control sequences, parse discovered skill names, and assert the exact
expected set with each name appearing once; substring checks against the raw
CLI output can pass on descriptions or unrelated checkout content.

Equivalent skills from two enabled plugins can both trigger. Keep installation
explicit and document conflicts; a plugin must not silently install or disable
another plugin.
