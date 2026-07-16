# Upstream provenance and downstream adaptations

The skill trees in this plugin originate from:

- Repository: https://github.com/smallocean43658/codex-superpowers
- Upstream package version: `6.1.1`
- Commit: `48aba461a6405bb8f1a568dabb37bcf9a0db4f46`
- License: MIT, copyright Jesse Vincent

Dyne packaging version `6.1.1-dyne.2` is an attributed downstream adaptation,
not a byte-identical vendor snapshot. It makes these deliberate changes:

- Replaces upstream `test-driven-development` with `development-testing`, whose
  flow is implementation, coherent tests, then test-and-fix until green.
- Adapts `systematic-debugging` so root-cause fixes are implemented before
  regression tests and the workflow stays inside the current Org Plan L2.
- Omits `receiving-code-review` and `requesting-code-review`; review remains a
  separate process that is started manually when requested.
- Rewrites `writing-skills` as a direct authoring and validation guide without
  RED/GREEN, TDD, failing-test, baseline-control, pressure-scenario,
  deployment/push, or mandatory stop procedures. Org Plan remains authoritative
  over L1/L2 execution. The upstream testing-with-subagents reference, worked
  testing example, persuasion reference, and evaluation-heavy best-practices
  copy are omitted because they reintroduced the removed methodology.
- Adapts `verification-before-completion` to verify regression-test relevance
  and current results without requiring a RED/GREEN or revert-the-fix cycle.
  Verification is reporting-only: it consumes evidence at Org Plan's existing
  L2/L1 boundaries and adds no universal commit, transition, or test-running
  gate.

The checksum fixture records the exact adapted package state. For an upstream
update, import a newly pinned release, reapply and document the Dyne adaptations,
bump the packaging version, and regenerate the fixture. A broader downstream
versioning scheme remains future work.
