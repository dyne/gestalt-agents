# Superpowers and Org Workflow Overlap

I recommend a new, private Codex plugin—not a fork and not a bare skill.

A fork inherits the entire upstream workflow, including the planning/execution behavior you want to remove; it will also create ongoing merge and maintenance work. A single standalone skill is too small once you add a bootstrap and reliable Org-file utilities. A compact plugin lets you own exactly the workflow surface you want.

Suggested approaches:

1. **Recommended: curated personal plugin**

   Create `org-superpowers` with:
   - a small session bootstrap that selects the right workflow;
   - one canonical `org-workflow` skill containing your `ORG-MODE.md` rules;
   - selected retained skills, copied unchanged or lightly adapted;
   - `scripts/org-plan` for status, validation, search, and summaries.

   Disable/remove the existing Superpowers skill bundle so its `writing-plans`, `executing-plans`, and worktree instructions cannot co-trigger.

2. **Minimal fork**

   Prune this repository to the compatible skills, replace its two plan skills with Org workflow, and retain its current Codex packaging. This is viable only if preserving the Superpowers name and update history matters more than keeping the maintenance surface tiny.

3. **Just install `ORG-MODE.md` as a skill**

   Smallest initial setup, but weaker discovery, no packaging boundary, and scripts have no clear home/versioning. I would use this only as a quick prototype before option 1.

Your Org workflow should replace these skills entirely:

- `writing-plans`
- `executing-plans`
- `using-git-worktrees` — it conflicts with your explicit “branch from current” workflow
- `subagent-driven-development` and `dispatching-parallel-agents` initially — they complicate the strict L1/L2 state-and-commit loop
- `finishing-a-development-branch` initially, unless you explicitly want its PR/merge ceremony

Keep these, because they complement rather than replace the Org plan:

- `systematic-debugging`
- `test-driven-development` — apply inside each L2 where code changes; its red/green discipline strengthens your test step
- `verification-before-completion`
- `receiving-code-review` / `requesting-code-review`
- `writing-skills`, only while evolving the plugin

`brainstorming` is conceptually useful but its mandatory spec → Markdown plan → approval gates conflict with your streamlined Org planning. I’d replace it with a short “discovery” section in the Org skill: challenge the first idea, weigh alternatives, ask only necessary questions, then write `.gestalt/plans/<topic>.org`.

A minimal plugin shape:

```text
org-superpowers/
  .codex-plugin/plugin.json
  skills/
    using-org-mode/SKILL.md
    org-workflow/
      SKILL.md
      references/ORG-MODE.md
      scripts/org-plan
    systematic-debugging/SKILL.md
    test-driven-development/SKILL.md
    verification-before-completion/SKILL.md
```

Keep `ORG-MODE.md` canonical rather than duplicating its rules. The `org-workflow` skill should mostly say when to load it and enforce its precedence over all planning/execution advice.

For the shell helper, use a single dependency-free Bash/awk script:

```text
org-plan validate <plan.org>
org-plan next <plan.org> l1|l2
org-plan set <plan.org> <unique-id> TODO|WIP|DONE
org-plan summary <plan.org>
org-plan l2 <plan.org> <regex>
```

`l2` should return the entire owning L2 block—heading plus properties/body—when the pattern matches anywhere in that block. Require a unique `:ID:` property on each L2, or make duplicate headings an error; changing state by heading text is unsafe. `validate` should enforce your metadata, L1/L2 structure, allowed states/priorities, and required fields before execution starts.

The repository’s Codex packaging archives ordinary files under skill directories, so executable scripts stored with the Org skill are a natural fit. The main implementation rule is to make the new bootstrap the only global workflow authority; otherwise the old, verbose planning skills will still compete with it.
