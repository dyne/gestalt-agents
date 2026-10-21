import { createHash } from "node:crypto";

/** MCP result fields observable here, before JSON-RPC framing and host rendering. */
export interface VisibleToolResponse {
  content: Array<{ type: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface VisibleResponseMeasurement {
  observedAtMs: number;
  serializedVisibleBytes: number | null;
  contentBytes: number | null;
  structuredContentBytes: number | null;
  digest: string | null;
  isError: boolean | null;
  nestedToolNames: string[] | null;
  delivery: "completed" | "partial" | "unknown";
  nestedAttribution: "runtime" | "unknown";
  hostTransportVisibility: "estimate";
}

/**
 * Measures JSON of content, structuredContent and present isError (including
 * false). Source echoes and overflow metadata in these fields count in full.
 * Host-only _meta, JSON-RPC IDs/framing, downstream rendering, and receipt by
 * the model are unobserved. Thus this is observed MCP-result bytes and only an
 * estimate of model-visible volume. Never infer nested calls or delivery from
 * response text, user arguments, or a handler's successful return.
 *
 * The optional metadata is for trusted runtime instrumentation only. The
 * production MCP adapter currently supplies none: attribution/delivery remain
 * explicitly unknown until an authoritative runtime source becomes available.
 */
export function measureVisibleToolResponse(
  response: VisibleToolResponse,
  runtime?: { nestedToolNames?: readonly string[]; delivery?: "completed" | "partial" },
): VisibleResponseMeasurement {
  const metadata = {
    observedAtMs: Date.now(),
    isError: typeof response.isError === "boolean" ? response.isError : null,
    nestedToolNames: runtime?.nestedToolNames ? [...new Set(runtime.nestedToolNames)].sort() : null,
    delivery: runtime?.delivery ?? "unknown" as const,
    nestedAttribution: runtime?.nestedToolNames ? "runtime" as const : "unknown" as const,
    hostTransportVisibility: "estimate" as const,
  };
  try {
    const envelope: Record<string, unknown> = { content: response.content };
    if (response.structuredContent !== undefined) envelope.structuredContent = response.structuredContent;
    if (response.isError !== undefined) envelope.isError = response.isError;
    const serialized = JSON.stringify(envelope);
    const content = JSON.stringify(response.content);
    const structured = response.structuredContent === undefined ? null : JSON.stringify(response.structuredContent);
    return {
      serializedVisibleBytes: Buffer.byteLength(serialized, "utf8"),
      contentBytes: Buffer.byteLength(content, "utf8"),
      structuredContentBytes: structured == null ? null : Buffer.byteLength(structured, "utf8"),
      digest: createHash("sha256").update(serialized, "utf8").digest("hex"),
      ...metadata,
    };
  } catch {
    return { serializedVisibleBytes: null, contentBytes: null, structuredContentBytes: null, digest: null, ...metadata };
  }
}
