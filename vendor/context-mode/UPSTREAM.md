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
build output are excluded. The fork changes `tests/setup-home.ts` only, forcing
`CODEX_HOME` into the test suite's temporary home so Codex adapter tests never
touch a host configuration directory. Repository-specific provenance, integrity
fixtures, and tests remain outside the vendored tree. Refresh it only with
`scripts/vendor-context-mode <local-upstream-checkout> 4b1348d4bba530d26cfc73181a0c2f263923e334`.
