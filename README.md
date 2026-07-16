# Dyne.org Agent Plugins and Skills

This is our free marketplace for skills and plugins.

Available skills:
- **Dyne Org Plan** (`org-plan`) :: high quality planning and execution flow
  based on org-mode
- **Dyne Superpowers** (`superpowers`) :: development methodology skills
  compatible with org-plan

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

The names shown under `/plugins` are **Dyne Org Plan** and **Dyne
Superpowers**. Their stable installation identifiers remain `org-plan` and
`superpowers`.

## Releases

All plugins share one repository release version. The first push to `main`
creates `v0.1.0`; later pushes use Conventional Commits since the latest tag:

- a breaking change bumps the major version;
- `feat:` and `feature:` bump the minor version;
- `fix:`, `bugfix:`, `perf:`, `refactor:`, `test:`, and `tests:` bump the patch
  version;
- commits such as `docs:` and `chore:` do not create a release.

The release workflow writes the selected version to every plugin manifest,
commits changed manifests, then atomically pushes `main` and the matching tag.
Repository settings for protected `main` must allow GitHub Actions to write
with the default `GITHUB_TOKEN`.

### Recommended plugins by third parties:

Context-mode:
```
codex plugin marketplace add mksglu/context-mode
codex plugin add context-mode@context-mode
```
