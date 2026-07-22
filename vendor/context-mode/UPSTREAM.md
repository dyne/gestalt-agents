# context-mode vendor provenance

- Repository: https://github.com/mksglu/context-mode
- Branch provenance: `codex-hardening`
- Pinned commit: `4b1348d4bba530d26cfc73181a0c2f263923e334`
- Describe: `v1.0.169-56-g4b1348d`
- Package version: `1.0.169`
- License: Elastic-2.0
- Import date: 2026-07-22

`plugins/context-mode/` is a forked export of that Git object. It is not a
working-tree copy: local modifications, untracked files, dependency caches, and
build output are excluded. Generated `*.bundle.mjs` artifacts are intentionally
omitted from this source vendor and compiled in the installed plugin cache on
first use. The fork changes eight upstream files:

- `tests/setup-home.ts` forces `CODEX_HOME` into the test suite's temporary home
  so Codex adapter tests never touch a host configuration directory.
- `skills/context-mode/SKILL.md` documents the evidence-flow and session-boundary
  contract for solo and supervised Gestalt Org Plans.
- `tests/session-hooks-smoke.test.ts` binds `CODEX_HOME` to its temporary fake
  home so Codex hook smoke tests cannot read or write host configuration state.
- `tests/scripts/asymmetric-drift-assert.test.ts` accepts both array and
  package-keyed-object JSON shapes emitted by supported npm versions.
- `scripts/ensure-source-build.mjs`, `start.mjs`,
  `hooks/codex/platform.mjs`, and `package.json` provide and package a locked,
  concurrent-safe first-use build path shared by the MCP server and every Codex
  hook.

Repository-specific provenance, integrity fixtures, and tests remain outside
the vendored tree. Refresh it only with
`scripts/vendor-context-mode <local-upstream-checkout> 4b1348d4bba530d26cfc73181a0c2f263923e334`.
