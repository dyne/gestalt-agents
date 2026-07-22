import { describe, expect, test } from "vitest";
import { SUPERVISION_PROTOCOL_VERSION, transition, type SupervisionRecord } from "../src/supervision/state-machine.js";
import { serializeEnvelope, type SupervisionEnvelope } from "../src/supervision/envelope.js";

function record(l1Id: string): SupervisionRecord {
  return { protocolVersion: SUPERVISION_PROTOCOL_VERSION, planId: "codex-hardening.org", l1Id, branch: "feature", planRevision: "rev-1", state: "TODO" };
}

function apply(record: SupervisionRecord, event: Parameters<typeof transition>[1]): SupervisionRecord {
  const result = transition(record, event);
  expect(result.ok, "unexpected protocol rejection").toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.record;
}

describe("supervised execution lifecycle harness", () => {
  test("orders L1 review, keeps one writer, and reuses the rejected executor generation", () => {
    let first = record("l1-first");
    let second = record("l1-second");
    const activeExecutors = new Set<string>();
    const launch = (item: SupervisionRecord, generation: string) => {
      expect(activeExecutors.size).toBe(0);
      activeExecutors.add(generation);
      return apply(item, { type: "start", owner: "supervisor", executorGeneration: generation });
    };
    const review = (item: SupervisionRecord, key: string) => apply(
      apply(item, { type: "complete", owner: "supervisor" }),
      { type: "request-review", owner: "supervisor", request: { idempotencyKey: key, commitRange: "a..b", expiresAt: "2030-01-01T00:00:00.000Z" } },
    );

    first = launch(first, "executor-1");
    first = review(first, "review-1");
    expect(second.state).toBe("TODO");
    first = apply(first, { type: "accept", owner: "supervisor", idempotencyKey: "review-1" });
    activeExecutors.delete("executor-1");
    expect(first.state).toBe("REVIEWED");

    second = launch(second, "executor-2");
    second = review(second, "review-2");
    second = apply(second, { type: "reject", owner: "supervisor", idempotencyKey: "review-2" });
    expect(second).toMatchObject({ state: "WIP", executorGeneration: "executor-2" });
    second = review(second, "review-3");
    second = apply(second, { type: "accept", owner: "supervisor", idempotencyKey: "review-3" });
    activeExecutors.delete("executor-2");
    expect(second.state).toBe("REVIEWED");
    expect(activeExecutors.size).toBe(0);
  });

  test("role boundary carries only a compact evidence envelope", () => {
    const envelope: SupervisionEnvelope = {
      protocolVersion: SUPERVISION_PROTOCOL_VERSION, contractHash: "contract-v1", planPath: "codex-hardening.org", l1Id: "l1-second", branch: "feature",
      allowedPaths: ["src/supervision"], preservedPaths: ["server.bundle.mjs"], requiredTests: ["npm test"],
      evidence: [{ command: "npm test", status: "pass", summary: "211 files passed" }], ambiguityStop: "Stop for material ambiguity.",
    };
    const payload = serializeEnvelope(envelope);
    expect(payload).toContain("211 files passed");
    expect(payload).not.toContain("transcript");
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(2048);
  });
});
