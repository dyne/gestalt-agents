---
name: self-debug
description: Diagnose failures inside Gestalt itself by correlating Mobile control-plane traces, relay persistence, Codex runtime records, agent topology, browser delivery, and sandbox behavior. Use when a Gestalt session stalls, loses a continuation or agent, reports a checkpoint or tool inconsistency, shows backend/UI disagreement, or encounters suspected Gestalt infrastructure behavior. Do not use for ordinary application bugs unrelated to Gestalt.
---

# Gestalt Self-Debug

Trace an internal Gestalt failure to the first missing or contradictory boundary.
Do not infer a component failure from a downstream symptom.

## Start safely

1. Resolve the helper-selected Mobile executable before diagnosis:
   `mobile_bin=${GESTALT_MOBILE_BIN:-$(gestalt path mobile)}`. Record
   `realpath "$mobile_bin"`, `"$mobile_bin" --version`, `codex --version`,
   `gestalt path --json`, the session ID, workspace, UTC time window, exact
   symptom, and last known-good action. Never select Mobile with
   `command -v gestalt-mobile` or an unqualified `gestalt-mobile` command;
   another installation may precede the managed executable on `PATH`.
2. Capture the redacted trace immediately with
   [the incident helper](references/incident-capture.md), using the source
   session's explicit workspace and state overrides. Inspect incident-window
   coverage before causal analysis; missing or unknown coverage limits any
   conclusion about an absent event. Preserve the original error and reproduction.
   Do not restart, delete state,
   edit databases, or retry destructively before collecting durable evidence.
3. Redact tokens, credentials, environment values, prompts, model output, and
   unrelated conversation. Prefer bounded queries and structured exports over
   whole logs.
4. Use `$gestalt:context-mode` for large logs or query output so only derived
   findings enter the conversation.

Read [telemetry entry points](references/telemetry-entry-points.md) for paths,
commands, schemas, and layer-specific cautions.

## Trace the causal chain

Use the stable `traceId` when available. For an Org Plan checkpoint handoff,
look for this order:

`org-plan.*-checkpointed` -> `org-plan.*-reported` ->
`autopilot.continuation-scheduled` -> `autopilot.control-issued` or
`autopilot.executor-resumed` -> `autopilot.turn-started` or
`autopilot.turn-failed` -> `agent.activity.updated` -> browser receipt.

Use the saved capture for diagnosis. For the supported exporter contract:

```sh
mobile_bin=${GESTALT_MOBILE_BIN:-$(gestalt path mobile)}
"$mobile_bin" trace <session-id>
"$mobile_bin" trace <session-id> --json
```

Pass `--cwd <workspace>` or `--data-dir <directory>` when the relay used a
non-default state location. The export is read-only and deliberately excludes
chat, prompts, model output, and environment values.

Classify the first missing edge:

- No checkpoint event: inspect tool validation, bridge invocation, and session
  control state.
- Checkpoint persisted but not reported: inspect boundary-final handling and
  checkpoint acknowledgement. A blank UI response is not evidence that the
  database write failed.
- Reported but not scheduled: inspect post-final Autopilot evaluation and its
  durable outbox transaction.
- Scheduled but not issued or resumed: inspect timers, dispatcher recovery,
  desired state, and outbox draining.
- Issued without turn outcome: inspect the Codex app-server bridge and runtime
  acceptance or failure record.
- Agent projection recorded but absent in the GUI: inspect WebSocket replay,
  sequence cursor, subscription, and client projection. Server persistence
  alone does not prove browser receipt.

For agent-list defects, compare the authoritative Codex child topology with
the relay projection and UI roster. Treat a completed canonical executor that
is resumed by `followup_task` as an activity transition, not a new identity.

## Test one explanation

State one falsifiable hypothesis naming the boundary and evidence. Perform the
smallest read-only or reversible experiment that distinguishes it from adjacent
layers. For execution failures, compare direct execution, asynchronous
`spawn()`, and synchronous `spawnSync()` or `execFileSync()` before blaming the
binary or filesystem; synthetic sandbox errors can occur after a child exits.

Do not treat conversational echoes in rollout files as syscall telemetry. Do
not treat a successful backend event as proof of UI delivery. Clearly label
inferences separately from observed records.

## Produce an incident packet

Report:

- versions, session ID, workspace, UTC window, and correlation IDs;
- ordered observed events and the first missing or contradictory edge;
- exact read-only commands, database paths, and bounded queries used;
- reproduction, expected result, and actual result;
- observed symptom, reproduced source defect, and proven incident cause as
  separate findings. Repeated `reconcileFailed` records identify a symptom,
  not an identical cause across incidents. A reproduced defect does not prove
  attribution when the incident window is missing; name the missing evidence;
- source verification and deployment status separately. A passing local
  regression does not establish that the running installation includes the fix;
- owning layer and a composition-level regression test that crosses the failed
  boundary.

Attach the redacted JSON trace when an issue or pull request needs portable
evidence. If a fix is requested, use `$gestalt:systematic-debugging`, then
`$gestalt:development-testing`; verify completion with
`$gestalt:verification-before-completion`. Stay within the current Org Plan
milestone when one is active.
