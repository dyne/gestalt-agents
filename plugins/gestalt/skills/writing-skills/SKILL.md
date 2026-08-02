---
name: writing-skills
description: Create or revise reusable agent skills, discovery metadata, bundled references, scripts, assets, and validation. Use when instructions must become concise, discoverable, specific, and reliable across stronger and lesser language models.
---

# Writing Skills

Write the smallest skill that reliably produces the intended outcome.

## Workflow

1. Define concrete trigger phrases and the observable result.
2. Identify only non-obvious reusable instructions and resources.
3. Keep the skill name lowercase, hyphenated, and equal to its directory name.
4. Put supported discovery fields in YAML frontmatter. At minimum use `name`
   and `description`; describe when to load the skill, not merely what it is.
5. Write one imperative workflow with explicit inputs, outputs, decisions, and
   stop conditions.
6. Put detailed variants, schemas, and long examples in directly linked
   references. Put deterministic repeated operations in tested scripts. Keep
   assets for files copied into outputs.
7. Check links, commands, examples, metadata, governing instructions, and any
   `agents/openai.yaml` companion.
8. Run the available structural validator and package-specific integrity,
   discovery, syntax, and behavior checks.

## Writing contract

- Prefer observable conditions over slogans or motivational prose.
- State each invariant once, beside its exception and exit condition.
- Use exact tool, skill, file, property, and state names.
- Separate tool routing from permission to act.
- Use one complete realistic example only when prose is insufficient.
- Automate mechanical constraints instead of repeating them in instructions.
- Keep one-off project policy in governing repository instructions.

Use a table for mappings or state transitions, a list for a linear workflow,
and a flowchart only for a genuinely non-obvious branch or loop.

When `$org-plan` is active, remain inside the current L2. Org Plan owns scope,
test boundaries, state transitions, review, commits, and continuation.

## Validation

When available, run:

```sh
python3 <skill-creator-root>/scripts/quick_validate.py <skill-directory>
```

Before completion, verify that names match, discovery text contains concrete
triggers, references resolve, optional resources are used, examples are
accurate, and relevant package checks pass.
