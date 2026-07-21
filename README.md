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
```

Make sure to add the following configuration directive to `~/.codex/config.toml`:
```
[agents]
max_depth = 2
```

The name shown under `/plugins` is **Dyne.org Gestalt**.

#### Recommended plugins by third parties:

Install context-mode to save tokens and optimize multi-agent comms:
```
codex plugin marketplace add mksglu/context-mode
codex plugin add context-mode@context-mode
```
And add this config directive needed by context-mode:
```
[features]
plugin_hooks = true
hooks = true
```

## 🧪 Testing

Run the complete repository test suite before publishing changes:

```
for test in tests/test-*.sh; do
  bash "$test"
done
```

The suite validates the Org Plan helper, unified plugin layout, vendored
Superpowers integrity, `npx skills` discovery, shell syntax, release versioning,
and release-workflow contracts.

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
