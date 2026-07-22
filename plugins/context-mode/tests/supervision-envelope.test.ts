import { describe, expect, test } from "vitest";
import { serializeEnvelope, SUPERVISION_ENVELOPE_MAX_BYTES, validateEnvelope, type SupervisionEnvelope } from "../src/supervision/envelope.js";
import { SUPERVISION_PROTOCOL_VERSION } from "../src/supervision/state-machine.js";

const envelope: SupervisionEnvelope = { protocolVersion: SUPERVISION_PROTOCOL_VERSION, contractHash: "abc", planPath: "codex-hardening.org", l1Id: "l1", branch: "feature", allowedPaths: ["src/supervision"], preservedPaths: ["server.bundle.mjs"], requiredTests: ["npm test"], evidence: [{ command: "npm test", status: "pass", summary: "all tests pass" }], ambiguityStop: "Stop for material ambiguity." };

describe("supervision assignment envelope", () => {
  test("validates a compact run-specific envelope", () => expect(validateEnvelope(envelope)).toMatchObject({ ok: true }));
  test("redacts secrets and deterministically caps diagnostics", () => {
    const serialized = serializeEnvelope({ ...envelope, allowedPaths: ["a".repeat(10_000)], evidence: [{ command: "test", status: "fail", summary: "x".repeat(10_000) }], ...({ apiToken: "secret" } as object) } as SupervisionEnvelope);
    expect(serialized).not.toContain("secret");
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(SUPERVISION_ENVELOPE_MAX_BYTES);
  });
  test("fails closed on incompatible contracts and absolute paths", () => {
    expect(validateEnvelope({ ...envelope, protocolVersion: 99 })).toMatchObject({ ok: false, reason: "protocol-version-mismatch" });
    expect(validateEnvelope({ ...envelope, allowedPaths: ["/tmp"] })).toMatchObject({ ok: false, reason: "absolute-path-forbidden" });
  });
});
