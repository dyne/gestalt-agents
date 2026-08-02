# context-mode for Codex

This downstream package exposes context-mode as a Codex plugin. It provides:

- sandboxed command and file analysis without flooding the conversation;
- SQLite FTS5 indexing and follow-up search;
- URL fetching into the index;
- session statistics, snapshots, and continuity hooks.

The package intentionally ships only Codex manifests, configuration, hooks,
and skills. The upstream TypeScript core still contains shared adapter code;
removing it requires a separate refactor because the server and CLI import the
shared adapter registry during compilation.

## Install

From the `dyne-gestalt-agents` marketplace checkout, run:

```sh
./gestalt-setup.sh
```

The setup command installs both marketplace plugins, installs locked
context-mode dependencies in the installed cache, type-checks the TypeScript,
builds the runtime bundles, and writes a SHA-256 preparation manifest. It
requires Node.js 22.5 or newer, npm, network access, and a native toolchain for
`better-sqlite3`.

Run setup again after an upgrade. Use `--prepare-only` for the source checkout,
`--force` to rebuild, or `--dry-run` to inspect mutations.

## Startup contract

Codex starts `node ./start.mjs`. The launcher only:

1. records the project directory and selects the Codex platform;
2. verifies the prepared artifact manifest;
3. imports `server.bundle.mjs`.

It never installs, compiles, repairs, or rewrites files. An incomplete runtime
exits with code 78 and `CONTEXT_MODE_NOT_PREPARED` so the failure is immediate
instead of timing out during the MCP handshake.

The Codex plugin manifest registers both `.mcp.json` and
`hooks/codex-hooks.json`; do not add a duplicate MCP configuration manually.

## Development

```sh
npm run prepare:codex
npm run check:prepared
npm test
```

Repository-level verification is documented in the root `USAGE.md`.

## License and origin

The context-mode core originates from
[mksglu/context-mode](https://github.com/mksglu/context-mode) and is licensed
under Elastic License 2.0. Downstream packaging details are in `UPSTREAM.md`.
