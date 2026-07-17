---
name: writing-skills
description: Use when creating or editing reusable agent skills, improving skill discovery metadata, organizing bundled resources, or validating a skill package
---

# Writing Skills

## Overview

Write concise, discoverable instructions that give another agent reusable knowledge or a reliable workflow. Include only information that materially improves execution.

## Org Plan Authority

When `$org-plan` is active, it controls L1/L2 order, scope, testing boundaries, commits, and continuation. Skill authoring remains inside the current L2 and adds no separate gate, pause, review, subagent, deployment, push, or commit workflow.

## What Belongs in a Skill

Use a skill for reusable:

- techniques and workflows;
- domain knowledge and conventions;
- tool or format instructions;
- scripts, references, templates, or assets that prevent repeated work.

Keep one-off project decisions in project instructions. Automate mechanical constraints when a validator or script can enforce them.

## Authoring Workflow

1. Define the situations that should trigger the skill and the outcomes it should support.
2. Identify only the non-obvious instructions and reusable resources an agent needs.
3. Choose a short lowercase hyphenated name and create a matching directory.
4. Write `SKILL.md` with valid YAML frontmatter and concise imperative guidance.
5. Add supporting scripts, references, or assets only when they are directly useful.
6. Check links, examples, commands, metadata, and compatibility with governing project instructions.
7. Run the available structural validator and any relevant usage checks after editing.
8. Fix discovered problems until the skill and its relevant checks are valid.

No preliminary control run or prescribed test ordering is required.

## Directory Structure

```text
skill-name/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
├── references/
└── assets/
```

Only `SKILL.md` is required. Create optional directories only when they contain resources the skill actually uses.

## Frontmatter

Use exactly the metadata supported by the target runtime. The portable minimum is:

```yaml
---
name: skill-name
description: Use when [specific triggering situations, symptoms, or tasks]
---
```

- Make `name` match the directory and use lowercase letters, digits, and hyphens.
- Make `description` explain when the skill should load.
- Include concrete trigger vocabulary an agent or user is likely to search for.
- Avoid vague descriptions and process summaries that let an agent guess without reading the skill.

## Body Structure

Prefer the smallest structure that makes the instructions easy to use:

```markdown
# Skill Name

## Overview
[Purpose and core principle]

## Workflow
[Ordered instructions]

## Quick Reference
[Compact mappings or commands, when useful]

## Common Mistakes
[Likely failure and correction]
```

Do not add sections merely to fill a template. Put triggering information in frontmatter because the body is loaded only after discovery.

## Writing Guidance

- Use direct imperative language.
- State observable conditions and expected outputs.
- Prefer positive output contracts for shape and structure.
- Use explicit prohibitions only for real safety or discipline constraints.
- Keep examples complete, realistic, and few.
- Avoid narratives about one past task.
- Do not repeat material already available in a linked reference or tool help.
- Keep project-specific policy subordinate to the project's governing instructions.

## Discovery Optimization

Future agents discover skills from their name and description before reading the body.

- Use descriptive, action-oriented names such as `creating-diagrams` or `debugging-with-logs`.
- Include symptoms, file types, tools, error terms, and common synonyms in the description when relevant.
- Describe triggering conditions rather than advertising capabilities in generic terms.
- Keep metadata concise enough to scan quickly.

## Bundled Resources

### Scripts

Include scripts for deterministic or frequently repeated operations. Run added or changed scripts with representative inputs and document required arguments in the main skill or script help.

### References

Move long domain documentation or variant-specific details into focused references. Link each reference directly from `SKILL.md` and say when it is useful. Avoid deep reference chains.

### Assets

Use assets for templates and files intended to be copied into outputs. Do not use assets as hidden instruction storage.

## Flowcharts and Examples

Use a flowchart only for a non-obvious decision, branch, or loop. Use Markdown for linear procedures and tables for mappings. See `graphviz-conventions.dot` for diagram conventions and use `render-graphs.js` when rendered inspection is useful.

One strong example is usually better than several shallow variants. Examples should be internally consistent and ready to adapt.

## Validation

When the runtime provides the standard skill validator, run:

```bash
python3 <skill-creator-root>/scripts/quick_validate.py path/to/skill
```

Also run package-specific integrity, discovery, syntax, and behavior checks required by the repository. Report the commands and current results before claiming completion.

## Checklist

- [ ] Name and directory match.
- [ ] Frontmatter parses and describes concrete triggers.
- [ ] Instructions are concise, imperative, and internally coherent.
- [ ] Governing project instructions remain authoritative.
- [ ] Links and relative paths resolve.
- [ ] Supporting resources are necessary and referenced.
- [ ] Examples and commands are accurate.
- [ ] Structural and relevant usage checks pass.
