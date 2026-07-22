import { describe, expect, test } from "vitest";
import { estimateTokens, measurePayloads, MODEL_PAYLOAD_CORPUS } from "../src/benchmark/model-payloads.js";

describe("model-facing payload benchmark", () => {
  test("covers routing, schema, response, and supervised handoff payloads", () => {
    expect(new Set(MODEL_PAYLOAD_CORPUS.map((item) => item.category))).toEqual(new Set(["routing", "schema", "response", "supervision"]));
  });
  test("measures deterministic byte, framing, and estimate arithmetic", () => {
    const first = measurePayloads()[0];
    expect(first.bytes).toBe(Buffer.byteLength(first.payload, "utf8"));
    expect(first.estimatedTokens).toBe(estimateTokens(first.bytes));
    expect(first.framingBytes).toBeGreaterThan(0);
  });
  test("fails closed when a benchmark corpus category is absent", () => {
    expect(measurePayloads([])).toEqual([]);
  });
});
