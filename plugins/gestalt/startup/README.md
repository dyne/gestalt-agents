# Additive startup contract, version 1

Agents owns [bootstrap.md](bootstrap.md) and the package-relative
[descriptor](../gestalt-startup-contract.json). Manager and Mobile consume the
selected installed Gestalt package, using their native enabled-plugin/skill
discovery result to identify its root. Never use a source-checkout absolute path,
guess the newest cached version, or fetch a different package to fill a missing
field. This contract adds no runtime dependency or permissions. L1 defines
content and composition only; CLI and Mobile delivery require their own adapters.

The descriptor is a package data file, not a Codex configuration key or plugin
manifest extension. `schemaVersion` versions its shape; `blockVersion` versions
the owned text and composition semantics independently of the package release.
Any stable-text change requires a block-version change and compatible consumer
tests. Version 1 readers support version 1 only. Keep one canonical text source;
do not paste it into role profiles, hooks, config templates or another catalog.
The source's entire whitespace-delimited text is limited to 350 words, including
its small dispatcher. Full skill content, capability detail and lifecycle rules
remain in their existing canonical sources.

## Composition

[The optional shared library](../scripts/startup-contract.mjs) reads package data
and composes a string without side effects. A consumer can implement the same
contract in its own language. Resolve the native effective instruction value
first. Preserve its exact bytes outside complete owned blocks. Append one block
when absent; replace the first version-1 owned block in place and remove further
version-1 copies. Preserve all surrounding bytes, including whitespace. Repeating
composition is byte-idempotent. Ownership markers are:

```text
<!-- gestalt:startup:v1 -->
...canonical package bytes...
<!-- /gestalt:startup -->
```

An older package without the descriptor returns `missing-contract`; an unknown
schema/block version returns `unsupported-contract`. Both leave existing guidance
unchanged. A malformed descriptor, missing declared source, malformed/nested
markers or unknown existing block version is a composition error: preserve the
original value, omit delivery and expose a bounded diagnostic. Never drop user
text, downgrade a newer block, substitute a source checkout, or silently claim
delivery succeeded. The library throws on these errors; consumers must preserve
their original inputs when handling them. The shared library is absent from older
packages too, so consumers must probe the descriptor before importing it.

Compose only within the selected additive channel. Do not flatten different
authoritative user/profile/project values, overwrite their priority, or inject
repository AGENTS content into a developer scalar. Do not set `baseInstructions`,
`base_instructions`, `model_instructions_file`, or `personality` to install this
block. Preserve any explicit user customization of those settings without
rewriting it. Dynamic capability context and role-specific instructions remain
separate additions; the bootstrap never certifies provider readiness or weakens
mandatory role reads, scope, checkpoints or review gates.

## Instruction layers and ownership inventory

Native configuration precedence is CLI overrides, trusted project layers
(closest wins), selected profile, user config, cloud defaults, system config,
then built-in defaults. Requirements constrain these values separately. Resolve
this through the running Codex version; scalar `developer_instructions` values
do not automatically concatenate. See the official
[configuration precedence](https://developers.openai.com/codex/config-basic/)
and [reference](https://developers.openai.com/codex/config-reference/).

| Layer / owner | Source and priority/composition | Lifetime |
| --- | --- | --- |
| Built-in foundation / Codex | Native instructions; additive Gestalt guidance preserves them. `model_instructions_file` replaces built-ins and is excluded from this delivery mechanism. | Runtime/thread behavior belongs to the installed Codex version. |
| User, profile, project / user or repository | Native config layers select the effective scalar; AGENTS.md retains native instruction scope/priority. Existing user values survive outside owned blocks. | Native config and repository discovery boundaries; source edits alone do not prove a thread refreshed. |
| Role bootstrap / Agents | `skills/org-plan/scripts/org-plan`, `stage_profile`, generates `developer_instructions` in selected reviewer/executor TOML. Role startup remains mandatory. | Setup-generated file, consumed when the role is selected; generation does not rewrite existing threads. |
| Shared stable block / Agents | This descriptor and bootstrap; one owned block in the adapter's additive effective channel. | Supported fresh-start/explicit refresh boundary chosen by the consumer. |
| CLI capabilities / Manager | `public/gestalt`, `resolveNamedProfile`, `sessionHook`, `compose`; SessionStart/SubagentStart hooks add current capability context when enabled and trusted. | Hook dispatch; disabled/untrusted hooks cannot establish delivery. |
| Mobile capabilities / Mobile | `src/server/platform/codex/codex-capabilities.ts` composes `developer_instructions`; `session-runtime.ts` sends sticky thread config. | Thread start/resume and supported runtime rebind; persistence must be tested in Mobile. |
| Discovery catalog / Codex and package | `.codex-plugin/plugin.json` exposes `./skills/`; names/descriptions locate skills, not loaded content. | Native skill discovery; each fresh agent resolves its own tools. |
| Full workflow / owning skill | `skills/*/SKILL.md` and selected references; task triggers and existing mandatory reads decide loading. | Current loaded revision; conditional capability readiness stays dynamic. |

Manager/Mobile paths above identify their owning repositories, not files in
Agents. This inventory describes source behavior; it is not a live prompt
capture or proof of delivery. The existing instruction baseline measures
repository-owned paths separately. Tests measure canonical text, wrapper and
synthetic composed bytes/hashes; actual host delivery remains unmeasured until
the relevant adapter captures its final configuration/messages. Never report
inventory totals, available references or catalog bytes as model receipt,
provider token savings or observed adoption.

## Role and lifecycle delivery acceptance

[Delivery scenarios](delivery-scenarios.json) are synthetic consumer acceptance
inputs. The maintained startup test executes the package composer, generates
the actual Org role TOML with the source helper in an isolated temporary agents
directory, and serializes complete synthetic developer/hook captures. It checks
preserved native foundation, effective scalar, repository instructions, role
bytes and recurring user prompt. Optional capture exports contain only sentinel
identities, counts, byte lengths, hashes and structural capability observations.
They contain no private prompts or model output. These tests do not run Manager
or Mobile delivery, resolve real native configuration priority, or observe a
model. Those adapters must run the same acceptance cases against their actual
final messages/configuration before claiming delivery.

The fixture's `effectiveLayer` is a synthetic native `config/read` result, not a
second configuration resolver. User/profile/trusted-project/CLI cases require
the consumer to use its native resolved scalar and preserve lower layers as
configuration; they must not concatenate lower-priority instruction values.
Named-role cases add the actual generated executor/reviewer text outside the
owned block. They retain mandatory standalone Org reads, declared-skill loading
and the role's report/checkpoint boundaries. Default children gain no generated
Org role or controller authority merely by inheriting context. Native child
instruction priority and role overrides remain native behavior.

| Boundary | Stable block expectation |
| --- | --- |
| Fresh solo/root or named child | Assemble one block in the selected supported additive channel. Preserve effective user instructions and role additions outside it. |
| Inherited/default child | Reuse effective inherited content; do not append another copy or inherit private tool bindings as readiness. A legacy parent may have no block. |
| Resume, fork, compaction | Retain durable instruction bytes; do not reinstall current source text, rewrite the parent, or append the block to every user prompt. |
| Runtime restart | Retain the thread's durable stable instructions. Resolve tools and dynamic capabilities for the new runtime independently; restart alone is not a text migration. |
| Explicit refresh/migration | Only at an idle boundary with a consumer-verified native refresh mechanism; otherwise retain bytes and report unsupported refresh. Update the existing owner's channel using the selected package, not a second delivery channel. A fresh thread is the fallback when native refresh is unsupported. |

An owned block already present in the effective developer scalar must not also
be emitted by a hook. Fresh assembly may reuse one current block there; stale
or duplicated blocks in a channel the adapter cannot refresh require explicit
migration. Duplicates within the mutable selected channel normalize through the
composer. Ordinary retained-thread events preserve even legacy duplicate bytes
and report `migration-required`; they cannot claim successful current delivery.
Unknown newer owned versions remain unchanged with a composition diagnostic.

Missing older package data, disabled Gestalt skill inclusion, or disabled hooks
on a hook delivery path omit new bootstrap delivery and preserve original
instructions. Do not force-enable hooks/skills or substitute another channel to
hide an unavailable path. Existing mandatory role reads still apply; if their
required skill is unavailable the active workflow's missing-skill rule governs.
Unavailable optional providers do not suppress the stable bootstrap: separate
dynamic context reports availability while repository coverage and semantic
readiness remain unverified. Never infer loaded skills or functioning reference
operations from these structural captures.

Consumers must verify version-specific fresh start, resume/fork persistence,
hook dispatch/trust and explicit-refresh semantics through supported native APIs.
The fixture's `refreshSupported` flag expresses an admission precondition, not a
claim that a current Codex API refreshes instructions. An upgraded package or
changed personality setting does not by itself refresh an existing thread.
