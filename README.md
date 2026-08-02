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

## 🎮 Quick setup

### Codex specific install as marketplace

Gestalt requires either Bun or Node.js 22.5 or newer.

Add our plugin marketplace `dyne-gestalt-agents`:
```
codex plugin marketplace add dyne/gestalt-agents
codex plugin add gestalt@dyne-gestalt-agents
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

This marketplace keeps generated JavaScript bundles out of Git: the
first MCP or Codex hook start installs locked build dependencies and
compiles them in the plugin cache, so allow 5–30 seconds plus network
access and a native build toolchain (`python3`, `make`, and a C/C++
compiler). An atomic build lock makes concurrent solo/subagent starts
share one build; later starts use the generated cache. The builder
allows up to three minutes on a slow network. If Codex times out
first, restart the session: the next process recovers an abandoned
build lock and resumes from cached downloads.

Restart Codex after installation or configuration changes. The plugin
manifest registers the MCP server and hooks, so do not add a duplicate
`[mcp_servers.context-mode]` entry. Verify the effective installation
with:

```
codex plugin list --marketplace dyne-gestalt-agents --json
```

Then start a fresh Codex session and ask it to run `ctx doctor`. If startup
fails, first check the runtime prerequisite, first-start network/build access,
the two feature flags above, and whether another context-mode marketplace
variant is enabled.

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
