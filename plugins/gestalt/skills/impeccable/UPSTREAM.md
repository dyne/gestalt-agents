# Impeccable — Gestalt adaptation

- Upstream: https://github.com/pbakaus/impeccable (Paul Bakaus).
- Source pin: `778c8a7b71ccd5bfe3ca6ac68c15d9d872d0f87d`.
- Accepted remote-URL adaptation: `b593626bffd40e404c9e8b7972628660e210dbf4`.
- Source package.json version: `4.1.0`; engine `0.1.11`; CLI `4.0.0`.
- Downstream skill version: `4.1.0-gestalt.1`, independent of Gestalt's plugin version.
- License: Apache-2.0; complete LICENSE and original NOTICE.md accompany this skill.
  The iOS/Android references also retain upstream's MIT third-party notice.

This is an attributed adaptation, not an exact upstream vendor or the newer
standalone Impeccable plugin. Import the complete `skill/` directory from the
accepted adaptation, then reapply these changes before updating checksums:

1. Generate `SKILL.md` from `SKILL.src.md`. Remove host-specific
   `argument-hint`, `user-invocable`, and Bash `allowed-tools` frontmatter;
   retain name/description/license and add the distinct downstream version.
   Remove the source template from the distributable.
2. Resolve template tokens: scripts/reference paths use the discovered
   `<skill-base-dir>`; command prefix is empty; clarification means asking the
   user; command inventory is SKILL.md; context files are PRODUCT.md and DESIGN.md.
   Preserve design playbooks, agent references, browser assets, metadata and font data.
3. Replace the auto-downloading launcher with `gestalt impeccable path`, which
   validates managed provenance before returning an executable. Ignore upstream
   binary override/cache/PATH discovery. Export skill/self paths for context loading.
   Omit the Windows launcher: this runtime supports Linux x86_64 only.
4. Gate raw `live*`, `generate`, `hook*`, `skills`, `link`, pinning and runtime
   replacement at the launcher. Replace Live/generate/setup plumbing references
   with native controller routing. No external Codex/Claude copy agent, duplicate
   poll owner, implicit download or unconditional escalation is supported.
5. Supply source agent finish-reviewer/documenter instructions at the relative
   `reference/degraded/` fallback links required by new-work; repair the asset
   producer’s component-review link to its relative packaged reference.
6. Replace project-hook/shortcut guidance with the managed no-install boundary;
   add native-session.md for authenticated Mobile Start/status/Open/Stop/Resume,
   admission prerequisites, prompt boundaries, and interrupted-accept recovery.
   Route Live/generate/setup through it before ordinary context loading.
   Replace critique’s raw localhost live-server overlay with available browser
   evidence/native preview; route init’s Live recommendation to Mobile and
   prohibit helper/hook/CSP setup as an init side effect.
   Treat runtime context/update suggestions as subordinate to managed native
   ownership, permissions and the explicit Gestalt package upgrade workflow.
7. Add Codex `agents/openai.yaml` with normal implicit discovery. Package once
   under `plugins/gestalt/skills/impeccable/`; there are no root copies or symlinks.

## Runtime compatibility

| Component | Required compatible state |
|---|---|
| Skill | `4.1.0-gestalt.1` from the source/adaptation pins above |
| Managed runtime | release `gestalt-live-1`, published tag `impeccable-gestalt-live-1` |
| Runtime identity | engine `0.1.11`, CLI `4.0.0`, Linux `x86_64-unknown-linux-musl` |
| Binary SHA-256 | `81fe24a7430571de1003f34fecf787bdc0acefa1be80525ccea9d4b74b5441a0` |
| Archive SHA-256 | `65e619d4126e3d3fd10fc5bb7a43d332fe327dbc38e0085883d920a2ba752898` |
| Remote URL patch SHA-256 | `b55136bf55c3225fc39292c43bb332ac8f17f39164b760348a01f56e50f61c25` |
| Manager contract | checksum-validating `gestalt impeccable path/status/doctor`; trusted native launch policy from L9 |
| Agents contract | confined packaged MCP/configuration from L10; this skill adds no MCP server or hooks |
| Mobile contract | L11 host-owned native lifecycle, exclusive owning Codex session, one canonical poll owner |

Pristine upstream binaries and other platforms/providers are not native Live
compatibility substitutes. Runtime presence alone does not establish Live readiness:
authenticated preview/Caddy and verified native admission are also required.
Ordinary design playbooks remain usable without Live or a runtime. This package
does not assert genuine-provider smoke completion or production deployment.

The adapted SHA-256 fixture records every relative regular-file path, executable
mode and content hash. On upgrade, reassess all downstream changes, runtime
identities and relative resources, then regenerate the fixture and run package,
discovery, launcher and full repository checks.

The pinned Rust router (`crates/cli/src/main.rs`, `run`) matches its first
argument directly; there is no global option parser that relocates the verb.
Only `--help`/`-h` and `--version`/`-v` are global forms, and they terminate
without dispatching later arguments. The launcher rejects other leading options
and all raw controller/installer aliases, including the `skills` nested router.
