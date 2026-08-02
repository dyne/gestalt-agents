# Usage and implementation findings

This document records the repository-wide skill and context-mode audit and the
changes made from it. It is also the operational guide for the prepared Codex
runtime.

## Codex setup

Context-mode requires Node.js 22.5 or newer, npm, network access during setup,
and the native toolchain needed by `better-sqlite3` (`python3`, `make`, and a
C/C++ compiler).

```sh
codex plugin marketplace add dyne/gestalt-agents
codex plugin marketplace list
cd <MARKETPLACE_ROOT>
./gestalt-setup.sh
```

`gestalt-setup.sh` installs the `context-mode` and `gestalt` plugins, prepares
the exact installed context-mode cache, verifies its artifact manifest, and
checks the effective Codex installation. Run it again after a marketplace
upgrade.

Useful modes:

```sh
./gestalt-setup.sh --prepare-only  # prepare this source tree only
./gestalt-setup.sh --force         # reinstall dependencies and rebuild
./gestalt-setup.sh --dry-run       # print mutations without running them
```

Normal Codex startup never installs dependencies, compiles code, repairs a
registry, or writes generated files. `start.mjs` performs a read-only version
and SHA-256 preflight, then imports `server.bundle.mjs`. An incomplete
cache exits with code 78, `CONTEXT_MODE_NOT_PREPARED`, the invalid paths, and
the setup command.

After setup, restart Codex and run `ctx-doctor`. Do not add a duplicate
`[mcp_servers.context-mode]` entry; the plugin manifest registers it.

## Audit scope

The audit initially covered all 16 repository `SKILL.md` files. The Gestalt
plugin now distributes all 13 Codex skills: five development workflows and
eight context-mode routing and command skills. Codex therefore labels and
enables or disables them under the same `(gestalt)` provider.

The three host-specific or maintainer-only copies were removed with the
non-Codex packaging surfaces.

It also covered context-mode startup, Codex hooks, packaging manifests,
provenance, checksum fixtures, and startup tests. The much larger context-mode
TypeScript product was reviewed for boundaries and eager-start coupling, but
was not broadly rewritten: that would be a separate upstream architecture
change with substantially more regression risk.

## Findings and resolutions

| Finding | Resolution |
|---|---|
| Skills repeated the same policy as rules, checklists, examples, warnings, and anti-patterns. | Each skill now has one ordered workflow, explicit outputs and stop conditions, with details moved to references. |
| Long motivational or categorical prose was hard for lower-capability models to turn into actions. | Prose now names observable inputs, actors, commands, evidence, transitions, and exit criteria. |
| Discovery metadata made unqualified percentage and language-count claims. | Skill and plugin descriptions now name concrete capabilities without unsupported savings figures or stale counts. |
| Context-mode routing was repeated across a decision tree, tables, trigger lists, and examples. | The canonical skill now has one five-step routing contract and one tool-selection table. Browser recipes moved to a reference. |
| Tool names alternated between short names and host-generated MCP prefixes. | Skills use canonical names such as `ctx_execute` and explain host prefixes once. |
| Seven command skills used the unsupported Codex frontmatter key `user-invocable`. | The key was removed; all 13 distributed skill packages now pass Codex's skill validator. |
| Routing guidance could be mistaken for authorization to mutate or install. | The canonical contract states that routing never grants mutation, deletion, install, push, network, or external-side-effect authority. |
| Gestalt skills contained obsolete external skill prefixes. | Cross-references now use exact `$gestalt:*` names distributed by this repository. |
| Org Plan mixed syntax, helper state, manual execution, and supervision in one long file. | `SKILL.md` is a dispatcher and invariant list; plan format, CLI state, and supervised execution have dedicated references. |
| Debugging and verification policies repeated slogans instead of measurable gates. | Workflows now require reproduction evidence, one hypothesis, a minimal experiment, a root-cause fix, and current verification output. |
| The maintainer skill mandated 10–20 agents and named optional skills as if universally present. | Concurrency is bounded by independent work and available slots; one writer owns each path; optional skills are checked before use. |
| Codex first launch could install dependencies and build TypeScript before the MCP handshake. | `.mcp.json` now selects the minimal `start.mjs`; compilation happens only in explicit preparation. |
| Codex hooks imported the same first-use builder and could race the MCP server. | Codex hook entrypoints no longer import dependency or source-build healers. |
| A launcher importing the preparation module would still expose child-process and write code on its dependency path. | Runtime verification is isolated in `runtime-preflight.mjs`, which has read-only imports only. |
| The context-mode runtime plugin shipped manifests, configs, hooks, skills, documentation, and release assets for unrelated hosts. | It now exposes only Codex MCP and hook surfaces. Its eight skills are owned by Gestalt so Codex presents one skill provider; shared upstream adapter code remains only where compilation still depends on it. |
| The package still advertised an npm publication surface that Codex installation does not use. | `package.json` is now a private dependency and build manifest; `.npmignore`, package exports, executable mappings, file allowlists, and publication lifecycle metadata were removed. |
| Gestalt carried an external-vendor identity, pinned checksum fixture, provenance file, and vendor test for skills that are now maintained here. | Those mechanisms and their terminology were removed; all 13 Gestalt skills are ordinary first-party plugin content. |
| Source-only downstream adaptations used the unchanged upstream package version. | The downstream package uses `1.0.169-dyne.1`; `UPSTREAM.md` distinguishes upstream and packaging versions. |
| A test that read stdin (notably `npx`) could consume the runner's process-substitution stream and silently skip later tests. | Each test now receives `/dev/null` on stdin, and the runner contract covers an stdin-consuming child. |

The skill rewrite removed more than two thousand repeated lines while retaining
the operational constraints. Exact line counts are deliberately not used as a
quality gate; the useful test is whether each decision appears once and has a
verifiable outcome.

## Prepared-runtime design

```text
gestalt-setup.sh
  -> codex plugin add
  -> prepare-runtime.mjs in the installed cache
     -> locked dependency install
     -> TypeScript check and bundle build
     -> bundle assertions
     -> versioned SHA-256 manifest

Codex MCP start
  -> start.mjs
  -> runtime-preflight.mjs (read only)
  -> server.bundle.mjs
```

The setup lock exists only to make an explicitly invoked preparation safe when
two setup processes overlap. It is not acquired during MCP or hook startup.
The preparation manifest covers the server and CLI bundles, hook bundles, and
runtime dependency package metadata. A changed package version or artifact
hash invalidates the cache.

Official Codex plugin documentation states that npm plugin sources are fetched
without running lifecycle scripts, and it documents runtime hooks but no
install-build hook. Consequently an npm `postinstall` or SessionStart build is
not a reliable install phase. The repository-level setup script is the explicit
pre-flight until releases distribute already prepared artifacts. See
[Package your plugin](https://developers.openai.com/plugins/build/plugins#marketplace-metadata).

## Remaining architectural opportunities

These are not required for safe Codex startup and were intentionally left for a
separate upstream refactor:

- split the large `src/server.ts` composition root by core, search, fetch, and
  administrative tool families;
- extract a Codex-only adapter/storage layer so the retained upstream adapter
  registry can be removed from the compiled core;
- bundle fetch conversion dependencies and remove the remaining legacy CLI
  repair helpers after `ctx upgrade` has a Codex-native replacement;
- define one explicit SQLite/FTS5 support matrix and prepare native artifacts
  per supported platform;
- publish a release artifact containing the prepared bundles so end users no
  longer need a local compiler or `gestalt-setup.sh`.

## Maintainer verification

Run the full repository suite before publishing:

```sh
bash tests/run.sh
git diff --check
```

Startup coverage must continue to prove that:

1. the Codex launcher and its preflight dependency contain no install, build,
   child-process, or write path;
2. an incomplete runtime fails quickly with the stable diagnostic;
3. explicit preparation is concurrency-safe and produces a valid MCP
   `initialize` and `tools/list` exchange;
4. Codex hooks do not invoke preparation;
5. package manifests, downstream provenance, checksums, and skill discovery are
   in sync.
