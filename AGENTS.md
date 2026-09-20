# Agent repository guidance

## Org Plan development

The canonical runtime contract is
`plugins/gestalt/skills/org-plan/SKILL.md`; supervised roles also read
`references/supervised-execution.md`. Keep lifecycle semantics there instead of
copying them into this file. Generated profiles in `scripts/org-plan` are
bootstrap summaries: they establish role, startup order, and critical safety
postconditions, then defer to those canonical documents.

When testing Org Plan supervision in this repository:

- Treat plan authoring and execution as separate user-authorized workflows.
  Authoring ends after the validated plan handoff; do not signal
  `supervision-start` or implement until the user explicitly orders execution.
- Reuse the supplied skill directory and exact plan path. Do not search for a
  replacement, assume a repository-local `.gestalt/`, inspect helper source, or
  run `prepare-supervision` during ordinary execution.
- Use the canonical terms `root`, `executor`, `terminal reviewer`, `relay
  session`, `root turn`, `Codex runtime`, `checkpoint`, and `boundary final`.
- Keep one writer. The root is `l0`; the L1 executor is `l<a>` and receives
  `task_name=l<a>`. Use `l<a>_gN` only after the prior physical slot is
  confirmed unavailable. The terminal reviewer uses
  `agent_type=org-plan-reviewer` and `task_name=final_review`.
- At the start of each relay session supervising an incomplete plan, validate
  the exact plan and signal `supervision-start` before milestone or roster
  recovery. A retained same-session signal preserves explicit manual Off; a
  fresh relay session publishes a new activation signal.
- Treat executor completion, error, interruption, and idle as wake inputs.
  Before yielding an incomplete plan, take a legal lifecycle disposition.
  Status prose is not one. A wait lease permits yielding only after
  `accepted:true`; otherwise continue in the same root turn.
- A checkpoint is the last tool call of its root turn. Emit its boundary final
  immediately and make no further tool call. A checkpoint is never a wait
  lease; the next root turn resumes the executor or advances the lifecycle.
  Roll up commentary, files, verification, and commands into that single chat
  answer; later milestone work belongs to a new root turn and answer.
- Org Plan files are workspace-local coordination state and never Git
  deliverables. Before every accepted commit, inspect
  `git diff --cached --name-only` and reject the active plan or any
  `.gestalt/*.org` path.
- Use native tools for governing instructions, bounded reads, edits, mutations,
  and short commands. Use `$gestalt:context-mode` for large or uncertain
  analysis; it never mutates Org state.
- Keep generated profiles concise. Tests must enforce their bootstrap contract,
  startup ordering, parseability, and word budgets rather than duplicating
  every sentence of the canonical state machine.

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
