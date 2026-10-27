# Consolidated engineering skills: source and adaptation record

The conditional `skills/playwright` guidance is original Gestalt integration
documentation, not vendored upstream source. It consumes the managed launcher
and read-only metadata contract version 1 from `gestalt-playwright-mcp` commit
`adf8af200aaef5f2973b9d1d18b795da5519e32c` (pinned MCP package 0.0.83).
Runtime activation belongs to the CLI/Mobile integrations; this package does
not implement attachment controls or grant browser consent.

- Downstream adaptation version: `1.0.0` (coding, security, scripting)
- Imported local snapshot: `skills-used`, supplied by the user, 2026-10-26
- Canonical packages: `skills/coding`, `skills/security`, `skills/scripting`
- Source snapshot manifest: `tests/plugins/gestalt/fixtures/engineering-sources.json`
- Adapted package fixture: `tests/plugins/gestalt/fixtures/engineering-skills.sha256`
  (fixture paths are relative to this plugin)

These are downstream syntheses, not exact upstream vendors. Source repository
identities below are those used by this repository's curated installer. The
supplied directories have no Git metadata or lock record identifying the imported
commit. **Upstream commit/release are unverified**, except for versions explicitly
declared in the source frontmatter. Per-file SHA-256 and mode records identify
the actual local inputs without pretending that a current upstream HEAD was
their origin. Do not replace them from upstream without pinning and reviewing
the new source revision.

| Local source | Upstream repository | Supplied version/license | Destination |
|---|---|---|---|
| `clean-ddd-hexagonal` | https://github.com/ccheney/robust-skills | No release or license supplied | coding |
| `domain-driven-design` | https://github.com/wondelai/skills | Frontmatter 1.4.0; MIT; author wondelai; no separate license text | coding |
| `hexagonal-architecture` | https://github.com/affaan-m/everything-claude-code | Origin ECC; no release or license supplied | coding |
| `vertical-slice-architecture` | https://github.com/mryll/skills | Frontmatter 1.0.3; no license supplied | coding |
| `security-best-practices` | https://github.com/openai/skills | No release supplied; Apache-2.0 license file | security |
| `security-ownership-map` | https://github.com/openai/skills | No release supplied; Apache-2.0 license file | security |
| `bash-linux` | https://github.com/sickn33/antigravity-awesome-skills | Community source; no release or license supplied | scripting |
| `bash-defensive-patterns` | https://github.com/wshobson/agents | No release or license supplied | scripting |

The two supplied Apache license files are byte-identical; one complete copy is
retained in `skills/security/LICENSE.txt`. Source attributions remain in each
skill's provenance reference. The plugin's own license does not relicense
third-party materials. Missing source notices are recorded as missing, not
replaced with an invented permission grant.

## Coverage and deliberate changes

### Coding

Four entrypoints and sixteen overlapping architecture references become one
entrypoint and five topic references plus provenance. All topic families remain:
language discovery, context mapping (nine relationships), strategic distillation,
entities/value objects/aggregates, repositories/factories/specifications,
Clean/Onion dependency direction, inbound/outbound ports, composition, feature
registration, platform sharing, language mappings, CQRS, domain/integration
events, outbox, idempotent consumers, sagas, event sourcing, testing, and migration.

Repeated class templates, quick-reference mirrors, book promotion, author
biography, and compulsory scoring are omitted. Top-level layering and feature-first
layout are reconciled as different dimensions. Port ownership follows its
consumer. Small CRUD work does not require a rich domain, ACL, interfaces, or
events. Aggregate/team-size cutoffs and blanket transaction prohibitions become
business-driven decisions. External payment/save failure is addressed explicitly.
Source-specific references to unavailable companion skills are removed.

### Security

Two entrypoints become one mode-based workflow. All ten framework guides and
four Python ownership scripts retain their supplied content and executable status.
Trailing whitespace was removed from four framework guides (Express, browser
baseline, React, and Django); source and adapted hashes record those changes.
The Neo4j guide gains a scoped import warning. Two UI metadata files become one
automatically discoverable entry. The ownership workflow is rewritten with local
relative script paths, dependency checks, available query controls, artifact
coverage, and interpretation limits. Existing authorization is respected;
review-only work does not silently become remediation. Passive mode is scoped
to an active security request. Public IDs are not authorization; TLS/HSTS depend
on deployment evidence. Reference snapshots are not current-version guarantees.
History-based ownership and timezone offsets are explicitly proxy evidence.

### Scripting

Two entrypoints and one long example reference become one entrypoint, two topic
references, provenance, and one tested executable example. Coverage retains
operators, files, text, processes, environment, networking, dialect differences,
functions, options, quoting, arrays, error status, cleanup, signals, temporary
files, atomic writes, idempotency, logging, dependencies, and dry-run.

Unsafe examples and absolute rules are replaced: context-dependent `errexit`,
guarded option values, original status preservation, task-specific temporary
variables, owned-process shutdown, individual waits, destination-filesystem
replacement, and documented race/metadata limits. Redundant snippets and
PowerShell command tables are omitted in favor of the semantic difference.
The new atomic-copy example replaces the unsafe fixed-path and write templates.

## Packaging and discovery

All three have matching folder/frontmatter names and explicit
`allow_implicit_invocation: true`; the Gestalt namespace supplies their public
`gestalt:*` identities. Catalog verification treats them as fixed enabled skills,
not conditional retrieval capabilities. Setup stops selecting the eight source
skills in optional extras; it never removes separately installed user copies.
The original `skills-used` input remains outside the distributable repository.
Each consolidated directory works without that input or a companion source skill.
Regular-file permissions are normalized to 0644 (0755 for the new executable
shell example); original executable/non-executable status is preserved for copied
resources. The checksum test checks Git-representable modes, independent of umask.

## Updating

Import a pinned upstream revision into a separate review workspace, record its
release/commit/license, compare the source snapshot, and reapply these deliberate
adaptations. Update the adaptation version and checksum fixture together. Run
the merged-skill checks, package/catalog/discovery checks, full repository suite,
and `git diff --check`. Do not regenerate checksums to conceal unexplained changes.
