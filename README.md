<h1 align="center">
  Gestalt Agents Orchestrator Methodology<br/><br/>
  <sub>We invite you to stop assembling the pieces and start perceiving the whole.</sub>
</h1>

<p align="center">
  <a href="https://dyne.org">
    <img src="https://img.shields.io/badge/%3C%2F%3E%20with%20%E2%9D%A4%20by-Dyne.org-blue.svg" alt="Dyne.org">
  </a>
</p>

<br><br>

This methodology is based on Emacs org-mode and concepts by Ludwig Wittgenstein

### 📖 More info on [dyne.org/gestalt-agents](https://dyne.org/gestalt) <!-- omit in toc -->

***

<div id="toc">

### 🚩 Table of Contents  <!-- omit in toc -->
- [🎮 Quick setup](#-quick-setup)
- [🧪 Testing](#-testing)
- [💼 License](#-license)

</div>


## 🎮 Quick setup

### Codex specific install as marketplace

Add our plugin marketplace `dyne-gestalt-agents`:
```
codex plugin marketplace add dyne/gestalt-agents
codex plugin add gestalt@dyne-gestalt-agents
# Optional: install the independently vendored context-mode plugin.
codex plugin add context-mode@dyne-gestalt-agents
```

Make sure to add the following configuration directive to `~/.codex/config.toml`:
```
[agents]
max_depth = 2
```

The name shown under `/plugins` is **Dyne.org Gestalt**.

#### Context-mode provenance and updates

`context-mode@dyne-gestalt-agents` is optional and remains Elastic-2.0; it is
not relicensed under Gestalt. Its pinned upstream provenance and fork note are
recorded in [`vendor/context-mode/UPSTREAM.md`](vendor/context-mode/UPSTREAM.md),
and its bundled license is [`plugins/context-mode/LICENSE`](plugins/context-mode/LICENSE).
Do not install it alongside the official `context-mode@context-mode` source.

Context-mode requires either Bun or Node.js 22.5 or newer. On Linux, Bun is
preferred for the SQLite runtime. This marketplace keeps generated JavaScript
bundles out of Git: the first MCP or Codex hook start installs locked build
dependencies and compiles them in the plugin cache, so allow 5–30 seconds plus
network access and a native build toolchain (`python3`, `make`, and a C/C++
compiler). An atomic build lock makes concurrent solo/subagent starts share one
build; later starts use the generated cache.

Context-mode needs these Codex settings:
```
[features]
plugin_hooks = true
hooks = true
```

Restart Codex after installation or configuration changes. The plugin manifest
registers the MCP server and hooks, so do not add a duplicate
`[mcp_servers.context-mode]` entry. Verify the effective installation with:

```
codex plugin list --marketplace dyne-gestalt-agents --json
```

Then start a fresh Codex session and ask it to run `ctx doctor`. If startup
fails, first check the runtime prerequisite, first-start network/build access,
the two feature flags above, and whether another context-mode marketplace
variant is enabled.

For a solo Org Plan, the active Codex agent uses context-mode for uncertain or
large inspection and test output while normal editing tools retain ownership of
file changes. In supervised execution, every Codex role receives the installed
MCP and hooks: the executor derives concise evidence with context-mode, the
supervisor forwards only conclusions and gate results, and the director reviews
those summaries. Context-mode transports evidence; it does not spawn agents,
change Org Plan ownership, or replace each L1's declared `:SKILLS:` contract.

Refresh the vendor only through `scripts/vendor-context-mode <upstream-checkout> <pinned-commit>`, then regenerate and run the checksum guard. Gestalt releases update only the Gestalt manifest; context-mode keeps its upstream version.

## 🧪 Testing

Run the complete repository test suite before publishing changes:

```
bash tests/run.sh
```

The suite validates repository/Gestalt contracts, context-mode provenance,
skill discovery, nested MCP startup, shell syntax, release versioning, and
release-workflow contracts.

## Org Plan supervised execution

The root director is also the read-only reviewer. Launch it with the prepared
`org-plan-reviewer` profile when possible; an already-running root keeps its
current model and adopts the same contract. The prepared profiles default to:

```text
director/reviewer (depth 0, org-plan-reviewer, Sol, read-only)
└── supervisor (depth 1, org-plan-supervisor, Luna)
    └── executor (depth 2, org-plan-executor, Terra, only code writer)
```

The executor reports only to the supervisor. The supervisor sends review
requests upward to the director/reviewer and never spawns a reviewer. This keeps
the root active with at most two subagents below it: the supervisor and its
executor. Evidence flows upward as concise summaries; raw test and inspection
logs stay outside conversational context. The root gives brief user-facing
updates such as `L1 2/5 — Validate release metadata: in review`.

Each L1 starts unreviewed. After implementation and test gates make it DONE, the
director/reviewer audits only requested DONE + UNREVIEWED milestones. Accepted
L1s remain reviewed as the plan grows, so later refinements review only new or
materially changed L1s. Final acceptance still requires a current full-suite
pass and clean intended scope.

Each L1 also declares a non-empty `:SKILLS:` property containing exact `$skill`
references selected from the planner's complete available-skill catalog. A
fresh executor loads exactly that list before inspecting or implementing the L1
and stops without edits when a declared skill is unavailable.

## 💼 License

Copyright (C) 2025-2026 Dyne.org foundation

Designed and written by Denis "[Jaromil](https://jaromil.dyne.org/)" Roio.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see https://www.gnu.org/licenses/.
