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

### 📖 More info on [dyne.org/gestalt](https://dyne.org/gestalt) <!-- omit in toc -->


## Org-mode plan and development

This method optimizes on token usage and quality of code by leveraging
org-mode as planning format and context-mode as token saving memory
system. It adopts a light multi-agent setup to keep the workflow and
avoid stall. The prepared agents default to:

```text
director (depth 0, org-plan-reviewer, Sol or Terra, read-only)
└── supervisor (depth 1, org-plan-supervisor, Luna)
    └── executor (depth 2, org-plan-executor, Terra, only code writer)
```

The executor reports only to the supervisor, a fresh one is respawned
for each L1 planned item so expensive context compaction is often not
needed. The supervisor sends review requests upward to the
director. This keeps the root active with at most two subagents below
it: the supervisor and its executor. Evidence flows upward as concise
summaries; raw test and inspection logs stay outside conversational
context. The root gives brief user-facing updates such as `L1 2/5 —
Validate release metadata: in review`.

Context-mode transports evidence; it does not spawn agents, grant write
ownership, or change Org Plan state.

## 🎮 Quick setup

### Codex specific install as marketplace

Gestalt setup requires Node.js 22.5 or newer and npm. It uses Bun for dependency
installation when a working Bun executable is available.

Add our plugin marketplace `dyne-gestalt-agents`:
```
codex plugin marketplace add dyne/gestalt-agents
codex plugin marketplace list
```

The second command prints the marketplace checkout path. Run the setup script
from that directory; it installs both plugins and prepares context-mode before
Codex can launch its MCP server:

```
cd <MARKETPLACE_ROOT>
./gestalt-setup.sh
```

Update to latest version:
```
codex plugin marketplace upgrade dyne/gestalt-agents
```

Make sure to add the following configuration directive to `~/.codex/config.toml`:
```
[agents]
max_depth = 2

[features]
plugin_hooks = true
hooks = true
```

This marketplace keeps generated JavaScript bundles out of Git. The setup
script installs locked build dependencies and compiles the exact installed
context-mode cache. It requires network access and a native build toolchain
(`python3`, `make`, and a C/C++ compiler). Normal Codex MCP and hook startup is
side-effect free: it verifies the prepared manifest and either launches the
bundle or exits quickly with `CONTEXT_MODE_NOT_PREPARED`.

Run `./gestalt-setup.sh` again after a marketplace upgrade. Use
`./gestalt-setup.sh --prepare-only` to prepare a source checkout without
installing plugins, and `--force` to replace an invalid prepared runtime.

Restart Codex after installation or configuration changes. The plugin
manifest registers the MCP server and hooks, so do not add a duplicate
`[mcp_servers.context-mode]` entry. Verify the effective installation
with:

```
codex plugin list --marketplace dyne-gestalt-agents --json
```

Then start a fresh Codex session and ask it to run `ctx-doctor`. If startup
fails, rerun `gestalt-setup.sh`, check the runtime and build prerequisites, and
confirm that another context-mode marketplace variant is not also enabled.

## 🧪 Testing (only for developers of this repo)

Run the complete repository test suite before publishing changes:

```
bash tests/run.sh
```

The suite validates repository/Gestalt contracts, context-mode provenance,
skill discovery, nested MCP startup, shell syntax, release versioning, and
release-workflow contracts.


# 📃 Plan

Each L1 starts unreviewed. After implementation and test gates make it
DONE, the director/reviewer audits only requested DONE + UNREVIEWED
milestones. Accepted L1s remain reviewed as the plan grows, so later
refinements review only new or materially changed L1s. Final
acceptance still requires a current full-suite pass and clean intended
scope.

Each L1 also declares a non-empty `:SKILLS:` property containing exact
`$skill` references selected from the planner's complete
available-skill catalog. Do not list `$context-mode:context-mode`; it
is an implicit baseline for every role. A fresh executor loads that
baseline plus exactly the declared task-specific list before
inspecting or implementing the L1 and stops without edits when either
is unavailable.

## 💼 License

Copyright (C) 2025-2026 Dyne.org foundation

Designed and written by Denis "[Jaromil](https://jaromil.dyne.org/)" Roio.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public
License along with this program. If not, see
https://www.gnu.org/licenses/.
