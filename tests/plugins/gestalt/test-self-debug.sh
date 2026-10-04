#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
skill="$root/plugins/gestalt/skills/self-debug/SKILL.md"
telemetry="$root/plugins/gestalt/skills/self-debug/references/telemetry-entry-points.md"
metadata="$root/plugins/gestalt/skills/self-debug/agents/openai.yaml"

test -f "$skill"
test -f "$telemetry"
test "$(sed -n 's/^  allow_implicit_invocation: //p' "$metadata")" = true

for contract in \
  '"$mobile_bin" trace <session-id>' \
  'org-plan.*-checkpointed' \
  'autopilot.continuation-scheduled' \
  'autopilot.control-issued' \
  'agent.activity.updated' \
  'browser receipt'; do
  grep -F "$contract" "$skill" >/dev/null
done

for discovery_contract in \
  'GESTALT_MOBILE_BIN' \
  'gestalt path mobile' \
  'gestalt path --json' \
  'command -v gestalt-mobile'; do
  grep -F "$discovery_contract" "$skill" >/dev/null
done

for entry_point in \
  'relay.sqlite' \
  'session_events' \
  'autopilot_sessions' \
  'autopilot_controls' \
  'autopilot_outbox' \
  'rollout-*.jsonl' \
  'state_5.sqlite' \
  'logs_2.sqlite' \
  'spawnSync()'; do
  grep -F "$entry_point" "$telemetry" >/dev/null
done

grep -F 'gestalt path context-mode' "$telemetry" >/dev/null
grep -F 'gestalt path context-mode-plugin' "$telemetry" >/dev/null

printf 'self-debug skill covers correlated Gestalt telemetry\n'
