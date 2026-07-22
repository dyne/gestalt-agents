export interface PayloadCase { name: string; payload: string; category: "routing" | "schema" | "response" | "supervision"; }
export interface PayloadMetric extends PayloadCase { bytes: number; estimatedTokens: number; framingBytes: number; }

/** Stable offline corpus for comparing model-facing payload classes. */
export const MODEL_PAYLOAD_CORPUS: PayloadCase[] = [
  { name: "routing", category: "routing", payload: "Use ctx_batch_execute for large analysis; report derived findings only." },
  { name: "schema", category: "schema", payload: JSON.stringify({ name: "ctx_search", input: { queries: ["decision", "blocker"] } }) },
  { name: "response", category: "response", payload: JSON.stringify({ sections: [{ title: "tests", text: "312 passed" }] }) },
  { name: "supervision-envelope", category: "supervision", payload: JSON.stringify({ l1: "codex-routing-token-budget", evidence: "npm test: pass", verdict: "ACCEPT" }) },
];

/** Conservative, documented estimate for trend comparison only; not tokenizer output. */
export function estimateTokens(bytes: number): number { return Math.ceil(bytes / 4); }

export function measurePayloads(cases: PayloadCase[] = MODEL_PAYLOAD_CORPUS): PayloadMetric[] {
  return cases.map((item) => {
    const bytes = Buffer.byteLength(item.payload, "utf8");
    return { ...item, bytes, estimatedTokens: estimateTokens(bytes), framingBytes: Buffer.byteLength(JSON.stringify({ payload: item.payload }), "utf8") - bytes };
  });
}
