# Telemetry entry points

Use the narrowest source that can prove or disprove the boundary under test.
Paths below use the normal Gestalt profile defaults; honor explicit
`CODEX_HOME`, `GESTALT_HOME`, `XDG_STATE_HOME`, `--cwd`, and `--data-dir`
overrides recorded by the running process.

## Gestalt Mobile relay

First preserve evidence with the [incident capture helper](incident-capture.md).
Analyze the saved packet and its coverage before querying changing live stores.
The underlying supported diagnostic is:

```sh
mobile_bin=${GESTALT_MOBILE_BIN:-$(gestalt path mobile)}
"$mobile_bin" trace <session-id>
"$mobile_bin" trace <session-id> --json
```

Resolve the executable once and retain that exact value throughout the
incident. Do not use `command -v gestalt-mobile` or an unqualified
`gestalt-mobile`: either can select an unrelated system installation.

The relay database is `<data-dir>/relay.sqlite`. Without `--data-dir`, Mobile
uses `$XDG_STATE_HOME/gestalt-mobile/<workspace-hash>/relay.sqlite`, falling
back to `~/.local/state/gestalt-mobile/<workspace-hash>/relay.sqlite`.

Relevant tables:

- `session_events`: ordered durable audit events and payload correlation IDs;
- `relay_sessions`: thread binding, desired/observed state, active turn, and
  next event sequence;
- `autopilot_sessions`: policy state, generation, next evaluation, last
  control, stop reason, and serialized lifecycle state;
- `autopilot_controls`: scheduled, issued, started, failed, or cancelled
  controls and their turn IDs;
- `autopilot_outbox`: transactional events awaiting projection;
- `pending_interactions`: approval or user-input lifecycle.

Prefer the exporter. If it cannot answer the question, open SQLite read-only or
copy the database together with its `-wal` and `-shm` files before inspecting a
live store. Bound every query by session ID and time or sequence range. Useful
checks include `PRAGMA table_info(<table>)` before assuming a schema and ordered
selection from `session_events` by `sequence`.

Control-plane events include `org-plan.*`, `autopilot.*`,
`agent.activity.*`, and `session.status.*`. Correlation can appear as
`traceId`, `handoffId`, `controlId`, `turnId`, or `requestId`; the trace export
normalizes the best available identifier. Keep the original identifiers in the
incident packet.

## Codex runtime

Under `${CODEX_HOME:-~/.codex-gestalt}` inspect, read-only:

- `sessions/YYYY/MM/DD/rollout-*.jsonl` for the session/turn timeline, tool
  calls, tool results, and runtime events;
- `state_5.sqlite` for durable threads and queued/runtime state when the schema
  confirms those records exist;
- `logs_2.sqlite` for runtime log records.

Discover schemas before querying because Codex storage evolves. Filter by the
known thread/session/turn ID and time window. Rollouts can contain sensitive
conversation and environment material: never attach them wholesale. Extract
only event names, timestamps, IDs, status, and minimal error text required to
show the boundary.

Compare Mobile's `relay_sessions.thread_id` with the Codex thread ID. For agent
rosters, compare Codex child-thread topology and collaboration activity with
Mobile's `agent.activity.updated` events. Absence in a UI list is not proof the
child thread is absent.

## Browser and transport

Capture the session WebSocket connection, last received event sequence, replay
request/cursor, reconnects, and client-side projection errors. Compare that
cursor with `relay_sessions.next_sequence` and the relevant `session_events`
rows. A journaled `agent.activity.updated` proves backend projection only; the
browser cursor or client instrumentation is required to prove delivery and
rendering.

When diagnosing a narrow handoff, distinguish a transient “checking state”
window from a durable “continuation unavailable” decision. Record the server
event sequence and UI state transition on the same UTC timeline.

## Manager, plugin, and context-mode

Record the executable paths and versions actually used:

```sh
mobile_bin=${GESTALT_MOBILE_BIN:-$(gestalt path mobile)}
gestalt path --json
realpath "$mobile_bin"
"$mobile_bin" --version
command -v codex
codex --version
```

Use `gestalt path context-mode` for the prepared context-mode runtime and
`gestalt path context-mode-plugin` for its installed source; do not construct
either path from a moving cache version. Inspect the active marketplace install
metadata when version provenance is relevant. Use `$gestalt:ctx-doctor` only for
context-mode startup, hook, MCP handshake, FTS5, dependency, or registration
failures. Use `$gestalt:ctx-stats` for context-mode activity, not as general
control-plane evidence.

## Sandbox and process execution

Record the active sandbox/approval profile and which execution path produced
the failure. For suspected interposition, compare the same harmless executable
through:

- direct shell execution;
- Node asynchronous `spawn()`;
- Node synchronous `spawnSync()` or `execFileSync()`;
- any MCP or context-mode execution bridge involved in the original path.

Capture status, signal, error code, stderr, executable mode, mount flags, and
architecture. If the child demonstrably exits zero but the synchronous caller
receives `EPERM`, classify it as sandbox/interposition evidence rather than a
binary permission failure. Do not broaden permissions as a diagnostic shortcut.

## Evidence quality

Before treating empty `rg` output as absence, verify the search root, ignored
paths (`rg --files --hidden --no-ignore` in the narrow expected directory), and
symlinks (`ls -ld` and `realpath` on the known path; `rg --follow` when needed).
Do not replace a failed narrow lookup with a broad directory dump.

Prefer durable IDs and ordered records over screenshots or prose. Preserve UTC
timestamps. Separate facts, inferences, and missing evidence. Never claim that
an event did not occur until all authoritative stores for that boundary have
been checked with the correct session/thread identity.
