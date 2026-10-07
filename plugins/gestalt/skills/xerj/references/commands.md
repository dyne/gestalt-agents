# Managed xerj commands

Audited against xerj `1.0.0-rc.87`, source commit
`fcb73c1c725cf6532cb73e556c51e0388a791533` (`xerj-autoindex/src/cli.rs`
and `xerj-mcp/src/lib.rs` under `engine/crates`). These examples use the
manager wrapper; never invoke upstream `init` to configure Gestalt.

Every workspace uses the same `$CODEX_HOME/xerj-data` database and runtime
(default `~/.codex-gestalt/xerj-data`), independent of the current directory.
Use the endpoint supplied by runtime readiness, with authentication supplied
by the managed environment/key file. Do not put keys in arguments or output.
Status is read-only:

```sh
gestalt xerj status
gestalt xerj autoindex map --url http://127.0.0.1:9300 --json
gestalt xerj autoindex status --url http://127.0.0.1:9300
```

Mobile owns indexing and watching at its `--cwd` root. Do not run autoindex
from an agent session. Report stale or missing material and use direct source
reads within the session's existing permissions. Operator recovery commands
belong in Gestalt Mobile's XERJ operational guide.

The pinned autoindex CLI requires an explicit `--url`; it does not use
`XERJ_URL` as its endpoint. Let the wrapper supply managed `--state-dir`.
The manager gives each canonical source root a stable `ax-<hash>` prefix
and separate autoindex bookkeeping inside the shared state directory. An
explicit `--prefix` is an intentional namespace override; do not reuse one for
unrelated roots. Inspect completion/catalog for actual index names and source provenance;
do not derive an index name from the directory basename.

For MCP, use the runtime's discovered schema:

- `xerj_map`: optional `index` exact name or glob. Reads the autoindex field
  catalog; a missing catalog is possible on a healthy empty backend. Sampled
  field statistics do not establish checkout identity or current freshness.
- `xerj_search`: supply `index`, a plain-string `query` for code search, and
  `size: 5`. Use field DSL only after inspecting the map. Do not omit the query
  for an unbounded exploration of the index.
- `xerj_code_search`: only for an identified peer corpus, with `corpus`,
  `query`, `k: 5`, `mode: "bm25"`, and `max_tokens` when supported. Preserve
  licence warnings. Do not override its stale-index refusal automatically;
  managed Gestalt does not provision or clone corpora.

Paths and line numbers are locators within the identified source repository.
Search broadly for engineering references, preserve repository provenance, and
read the actual target repository before treating a reference as local behavior.

`ax_paths` retains all repository-relative aliases for identical content. Preserve
those identities when comparing forks; `ax_path` alone is only the canonical alias.
