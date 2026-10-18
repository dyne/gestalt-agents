# Agent repository guidance

## Org Plan development

The canonical runtime contract is
`plugins/gestalt/skills/org-plan/SKILL.md`; supervised roles also read
`references/supervised-execution.md`. Keep lifecycle semantics there instead of
copying them into this file. Generated profiles in `scripts/org-plan` are
bootstrap summaries: they establish role, startup order, and critical safety
postconditions, then defer to those canonical documents.

Use the canonical role names and authorization, startup, replacement, wait,
checkpoint, review, and Git rules from those mandatory reads. Repository tests
do not authorize execution of a user's plan or changes to a live session.
Profile generation tests use isolated temporary agents directories; ordinary
supervision never runs `prepare-supervision`.

Keep generated profiles concise. Tests enforce the bootstrap contract, startup
ordering, parseability, and word budgets; scenario contracts and the
requirements ledger in `tests/plugins/gestalt/fixtures/instruction-contract.md`
cover the canonical lifecycle. Review that ledger when moving or removing a
rule. Native instruction/pre-edit reads and mutations, and context-mode evidence
analysis, follow the implicit routing skill. Do not copy its tool catalog here.

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
