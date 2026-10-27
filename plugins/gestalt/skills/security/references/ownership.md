# Security ownership and bus-factor analysis

Use only for requested security-oriented ownership questions. Git touch history
is evidence of activity, not proof of current responsibility, expertise, access,
or vulnerability. Co-change is association, not a dependency graph.

## Establish inputs

- Resolve repository root and revision; check shallow history and available
  branches. Choose and report `--since`/`--until` when the question has a window.
- Use defaults for auth/crypto/secret paths or a supplied sensitivity CSV with
  `pattern,tag,weight` rows. Validate tags against current files; filename matches
  are heuristics and can miss sensitive code in ordinary-looking paths.
- Defaults use author identity and author date and exclude merge commits and
  Dependabot. Record identity, bot, rename/history, and alias limitations. Use
  `--identity committer`, `--date-field committer`, `--include-merges`, or
  author filters only for the intended interpretation.
- Require Python 3 and `networkx` for the builder. Probe availability first.
  Use an existing project environment, or report the missing dependency; do not
  silently install into a global environment. Querying existing JSON/CSV exports
  remains useful without rebuilding.

## Build and query

Resolve `security_skill` to this skill's absolute directory and `repository` to
the target Git repository. Choose a new output directory or inspect existing
outputs before overwriting them. Paths below are variables to set, not literal
installation locations.

```bash
python3 "$security_skill/scripts/run_ownership_map.py" \
  --repo "$repository" --out "$output_dir" --since "12 months ago" --emit-commits
python3 "$security_skill/scripts/query_ownership.py" \
  --data-dir "$output_dir" summary --section bus_factor_hotspots
python3 "$security_skill/scripts/query_ownership.py" \
  --data-dir "$output_dir" summary --section orphaned_sensitive_code
python3 "$security_skill/scripts/query_ownership.py" \
  --data-dir "$output_dir" summary --section hidden_owners
python3 "$security_skill/scripts/query_ownership.py" \
  --data-dir "$output_dir" files --tag auth --bus-factor-max 1
```

Inspect each script's `--help` for the exact available flags. Other bounded
queries include `people --sort sensitive_touches --limit 10`,
`person --person alice@example.org --limit 10`, `file --file path/to/file`,
`cochange --file path/to/file --min-jaccard 0.05 --limit 20`, and
`community --id 3`. Do not dump a full graph into a chat report.

The runner builds co-change and communities by default. It excludes large
commits above `--cochange-max-files` and common glue files such as lockfiles,
`.github` configuration, and editor settings. This improves code clustering but
can hide security-relevant CI changes; inspect ownership and exclusions together.
Use repeatable `--cochange-exclude`, `--no-default-cochange-excludes`,
`--author-exclude-regex`, or `--no-default-author-excludes` deliberately.
Disable clustering with `--no-communities` or co-change with `--no-cochange`.
`--community-top-owners` controls stored maintainers (default five).

## Artifacts and interpretation

| Output | Meaning |
|---|---|
| `people.csv`, `files.csv`, `edges.csv` | Person/file nodes and attributed touch edges |
| `summary.json` | Sensitive low-bus-factor hotspots, stale/orphan candidates, hidden-owner candidates |
| `cochange_edges.csv` | File pairs weighted by shared-commit Jaccard similarity; omitted without co-change |
| `commits.jsonl` | Optional history evidence with `--emit-commits` |
| `communities.json` | Optional clusters with maintainers |
| `cochange.graph.json` or `ownership.graph.json` | Graph export; ownership is fallback without co-change edges |
| `ownership.graphml`, `cochange.graphml` | Optional `--graphml` exports |

Read the actual output schema instead of fabricating example field names.
The bundled builder's per-file `bus_factor` is the count of distinct attributed
contributors in the selected history, not a cumulative ownership-share threshold.
Report that definition and the thresholds/window used. A low value signals concentrated historical
activity, not a proven single point of operational failure. An orphan candidate
needs verification against current maintainers and CODEOWNERS. Compare declared
ownership with observed history; do not automatically rewrite CODEOWNERS.

`people.csv` includes author timestamp offset summaries. These are commit
metadata, not verified residence, location, or working hours. Include personal
metadata only when needed for the authorized report.

## Maintainer history

The history helper emits CSV to stdout (the bounded query helper above emits
JSON). For exports containing the required commit history:

```bash
python3 "$security_skill/scripts/community_maintainers.py" \
  --data-dir "$output_dir" --file path/to/file --since 2025-01-01 --top 5
```

Use `--bucket quarter` for calendar quarters; `--touch-mode file` for per-file
touches instead of one authored commit; `--window-days 90` for a sliding window;
or `--weight recency --half-life-days 180` for recency weighting. Other controls
include `--min-share 0.1`, `--ignore-author-regex '(bot|dependabot)'`, identity,
date field, and merge inclusion. Explain changed attribution in the report.

For a requested graph import, read [Neo4j import](neo4j-import.md). Preparing
local CSVs does not itself authorize writing to a running external database.

Deliver artifact paths, scoped hotspot/orphan/hidden-owner candidates, supporting
touch/recency evidence, excluded material, and suggested human ownership checks.
