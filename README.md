# Dyne.org Agent Plugins and Skills

This is our free marketplace for skills and plugins.

Available skills:
- **org-plan** :: high quality planning and execution flow based on org-mode
- **superpowers** :: development methodology skills compatible with org-plan

Conflicting skills (not needed, functionality provided by ours):
- **superpowers** :: we borrow some skills but rewrite planning entirely

## Generic install as skills

```
npx skills add dyne/agent-plugins
```

Check the skills and where you want to install.

## Codex specific install as marketplace

Add our plugin marketplace `dyne-agent-plugins`:
```
codex plugin marketplace add dyne/agent-plugins
```

List all plugins available:
```
codex plugin list -m dyne-agent-plugins
```

Install org-plan and superpowers:
```
codex plugin add org-plan@dyne-agent-plugins
codex plugin add superpowers@dyne-agent-plugins
```

### Recommended plugins by third parties:

Context-mode:
```
codex plugin marketplace add mksglu/context-mode
codex plugin add context-mode@context-mode
```
