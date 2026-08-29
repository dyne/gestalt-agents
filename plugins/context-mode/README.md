# context-mode for Codex

This downstream package exposes context-mode as a Codex plugin. It provides:

- sandboxed command and file analysis without flooding the conversation;
- SQLite FTS5 indexing and follow-up search;
- URL fetching into the index;
- session statistics, snapshots, and continuity hooks.

The package intentionally ships only Codex MCP manifests, configuration, and
hooks. User-facing context-mode skills belong to the sibling Gestalt plugin so
Codex lists and toggles them under `(gestalt)`. The upstream TypeScript core
still contains shared adapter code; removing it requires a separate refactor
because the server and CLI import the shared adapter registry during
compilation.

## Install

From the `dyne-gestalt-agents` marketplace checkout, run:

```sh
./gestalt-setup.sh
```

The setup command installs both marketplace plugins and creates a versioned
runtime under `${GESTALT_HOME:-$HOME/.gestalt}`. It installs locked dependencies,
type-checks the TypeScript, builds the runtime bundles, verifies the native
SQLite binding, and writes a SHA-256 preparation manifest. It
requires Node.js 22.5 or newer, npm, network access, and a native toolchain for
`better-sqlite3`. Set `CONTEXT_MODE_PACKAGE_MANAGER=npm` or `bun` to override
automatic dependency-installer selection.

Run setup again after an upgrade. Use `--prepare-only` for only the external runtime,
`--force` to rebuild, or `--dry-run` to inspect mutations.

Setup also repairs the Codex integration in place. It enables stable hooks,
merges context-mode entries into `CODEX_HOME/hooks.json`, and registers a native
MCP launcher in `config.toml` without replacing unrelated user settings.
Repeated setup is byte-idempotent.

## Startup contract

Codex starts `node ./start.mjs`. The launcher only:

1. records the project directory and selects the Codex platform;
2. resolves the external runtime from its version and the current Node ABI;
3. verifies the prepared artifact manifest;
4. imports the external `server.bundle.mjs`.

It never installs, compiles, repairs, or rewrites files. An incomplete runtime
exits with code 78 and `CONTEXT_MODE_NOT_PREPARED` so the failure is immediate
instead of timing out during the MCP handshake. Codex may replace its plugin
cache without affecting the prepared runtime.

The package includes `.mcp.json` and `hooks/hooks.json` as its portable plugin
surfaces. For current Codex, setup disables that manifest contribution and uses
stable user-level launchers instead. Codex does not currently pass the session
workspace to a plugin MCP child, while the native launcher inherits the Codex
process workspace and completes the MCP handshake. Do not add duplicate MCP or
hook configuration manually; rerun setup to reconcile it.

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
