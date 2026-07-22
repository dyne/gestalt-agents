import { describe, expect, test } from "vitest";
import { reconcile, SUPERVISION_PROTOCOL_VERSION, transition, type SupervisionRecord } from "../src/supervision/state-machine.js";

const base: SupervisionRecord = { protocolVersion: SUPERVISION_PROTOCOL_VERSION, planId: "plan", l1Id: "l1", branch: "feature", planRevision: "abc", state: "TODO" };
const request = { idempotencyKey: "review-1", commitRange: "a..b", expiresAt: "2030-01-01T00:00:00.000Z" };

describe("supervision state machine", () => {
  test("acceptance is ordered and idempotent", () => {
    const wip = transition(base, { type: "start", owner: "supervisor", executorGeneration: "exec-1" });
    expect(wip.ok).toBe(true); if (!wip.ok) return;
    const done = transition(wip.record, { type: "complete", owner: "supervisor" });
    expect(done.ok).toBe(true); if (!done.ok) return;
    const pending = transition(done.record, { type: "request-review", owner: "supervisor", request });
    expect(pending.ok).toBe(true); if (!pending.ok) return;
    const accepted = transition(pending.record, { type: "accept", owner: "supervisor", idempotencyKey: "review-1" });
    expect(accepted).toMatchObject({ ok: true, idempotent: false, record: { state: "REVIEWED" } });
    if (accepted.ok) expect(transition(accepted.record, { type: "accept", owner: "supervisor", idempotencyKey: "review-1" })).toMatchObject({ ok: true, idempotent: true });
  });

  test("rejection returns the same L1 to WIP without a second review transition", () => {
    const pending = { ...base, state: "REVIEW_REQUESTED" as const, executorGeneration: "exec-1", reviewRequest: request };
    expect(transition(pending, { type: "reject", owner: "supervisor", idempotencyKey: "review-1" })).toMatchObject({ ok: true, record: { state: "WIP", reviewRequest: undefined } });
  });

  test("reconciliation fails closed on drift and handles stale work deterministically", () => {
    expect(reconcile(base, { ...base, branch: "other" }, new Date("2029-01-01"))).toBe("fail-closed");
    expect(reconcile({ ...base, state: "WIP", executorGeneration: "old" }, base, new Date("2029-01-01"))).toBe("terminate-stale-executor");
    expect(reconcile({ ...base, state: "REVIEW_REQUESTED", reviewRequest: request }, base, new Date("2029-01-01"))).toBe("reuse-review-request");
    expect(reconcile({ ...base, state: "REVIEW_REQUESTED", reviewRequest: request }, base, new Date("2031-01-01"))).toBe("fail-closed");
  });

  test("only the supervisor transitions state and reviewed work must reopen explicitly", () => {
    expect(transition(base, { type: "start", owner: "executor", executorGeneration: "exec-1" } as never)).toMatchObject({ ok: false, reason: "state-owner-must-be-supervisor" });
    expect(transition({ ...base, state: "REVIEWED", reviewRequest: request }, { type: "reopen", owner: "supervisor", executorGeneration: "exec-2" })).toMatchObject({ ok: true, record: { state: "WIP", executorGeneration: "exec-2", reviewRequest: undefined } });
  });
});
