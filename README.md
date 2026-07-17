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

### 📖 More info on [dyne.org/gestalt-agents](https://dyne.org/gestalt-agents) <!-- omit in toc -->

***

<div id="toc">

### 🚩 Table of Contents  <!-- omit in toc -->
- [🎮 Quick setup](#-quick-setup)
- [💾 Build](#-build)
- [🧪 Testing](#-testing)
- [💼 License](#-license)

</div>


## 🎮 Quick setup

### Generic install as skills

You may want to install our agentic skills as part of your setup, but beware you will not have the full gestalt experience.

```
npx skills add dyne/gestalt-agents
```

Check the skills and where you want to install, but **beware it conflicts with popular skill superpowers** and other planning related skills. The gestalt installer do not overwrite your skills, it instead created a new independent codex profile.

### Codex specific install as marketplace

Add our plugin marketplace `dyne-gestalt-agents`:
```
codex plugin marketplace add dyne/gestalt-agents
```

List all plugins available:
```
codex plugin list -m dyne-gestalt-agents
```

Install the unified Gestalt plugin:
```
codex plugin add gestalt@dyne-gestalt-agents
```

The name shown under `/plugins` is **Dyne.org Gestalt**. Its stable installation
identifier is `gestalt`; the included skill names remain unchanged.

## 💾 Build

Dyne.org Gestalt is a skills and metadata package, so it has no compilation or
bundle step. Validate the distributable plugin manifest with:

```
python3 -m json.tool plugins/gestalt/.codex-plugin/plugin.json >/dev/null
git diff --check
```

## 🧪 Testing

Run the complete repository test suite before publishing changes:

```
for test in tests/test-*.sh; do
  bash "$test"
done
```

The suite validates the Org Plan helper, installer, unified plugin layout,
vendored Superpowers integrity, `npx skills` discovery, shell syntax, release
versioning, and release-workflow contracts.

## Org Plan supervised execution

The director can use any model selected by the Codex CLI. The other roles use
prepared profiles with these defaults:

```text
director (depth 0, user's Codex conversation, any CLI-selected model)
└── supervisor (depth 1, org-plan-supervisor, Luna)
    ├── executor (depth 2, org-plan-executor, Terra, only code writer)
    └── reviewer (depth 2, org-plan-reviewer, Sol, read-only)
```

The executor and reviewer report only to the supervisor, which reports to the
director. Evidence flows upward as concise summaries; raw test and inspection
logs stay outside conversational context.

Each L1 starts unreviewed. After implementation and test gates make it DONE, the
reviewer audits only assigned DONE + UNREVIEWED milestones. Accepted L1s remain
reviewed as the plan grows, so later refinements review only new or materially
changed L1s. Final acceptance still requires a current full-suite pass and clean
intended scope.

### Recommended plugins by third parties:

Context-mode:
```
codex plugin marketplace add mksglu/context-mode
codex plugin add context-mode@context-mode
```

## 💼 License

Copyright (C) 2025-2026 Dyne.org foundation

Designed and written by Denis "[Jaromil](https://jaromil.dyne.org/)" Roio.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see https://www.gnu.org/licenses/.
