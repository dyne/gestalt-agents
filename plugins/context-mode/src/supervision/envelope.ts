import { SUPERVISION_PROTOCOL_VERSION } from "./state-machine.js";

export const SUPERVISION_ENVELOPE_MAX_BYTES = 2_048;
const SECRET_KEY = /(?:token|secret|password|api[-_]?key|authorization|cookie)/i;

export interface SupervisionEnvelope {
  protocolVersion: number;
  contractHash: string;
  planPath: string;
  l1Id: string;
  branch: string;
  allowedPaths: string[];
  preservedPaths: string[];
  requiredTests: string[];
  evidence: { command: string; status: "pass" | "fail"; summary: string }[];
  ambiguityStop: string;
}

export type EnvelopeValidation = { ok: true; bytes: number } | { ok: false; reason: string };

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redact(nested)]));
}

/** Serialize deterministically; no absolute paths, raw logs, or secrets cross roles. */
export function serializeEnvelope(envelope: SupervisionEnvelope): string {
  const safe = redact(envelope) as SupervisionEnvelope;
  const json = JSON.stringify(safe);
  if (Buffer.byteLength(json, "utf8") <= SUPERVISION_ENVELOPE_MAX_BYTES) return json;
  const reduced = JSON.stringify({
    ...safe,
    allowedPaths: safe.allowedPaths.slice(0, 8).map((path) => path.slice(0, 120)),
    preservedPaths: safe.preservedPaths.slice(0, 8).map((path) => path.slice(0, 120)),
    requiredTests: safe.requiredTests.slice(0, 8).map((test) => test.slice(0, 160)),
    evidence: safe.evidence.slice(0, 8).map((item) => ({ ...item, command: item.command.slice(0, 160), summary: item.summary.slice(0, 160) })),
    truncated: true,
  });
  if (Buffer.byteLength(reduced, "utf8") <= SUPERVISION_ENVELOPE_MAX_BYTES) return reduced;
  return JSON.stringify({ protocolVersion: safe.protocolVersion, contractHash: safe.contractHash.slice(0, 64), planPath: safe.planPath.slice(0, 160), l1Id: safe.l1Id.slice(0, 80), branch: safe.branch.slice(0, 80), ambiguityStop: safe.ambiguityStop.slice(0, 256), truncated: true });
}

export function validateEnvelope(envelope: SupervisionEnvelope): EnvelopeValidation {
  if (envelope.protocolVersion !== SUPERVISION_PROTOCOL_VERSION) return { ok: false, reason: "protocol-version-mismatch" };
  if (!envelope.contractHash || !envelope.planPath || !envelope.l1Id || !envelope.branch || !envelope.ambiguityStop) return { ok: false, reason: "missing-required-field" };
  if ([...envelope.allowedPaths, ...envelope.preservedPaths].some((path) => path.startsWith("/"))) return { ok: false, reason: "absolute-path-forbidden" };
  const bytes = Buffer.byteLength(serializeEnvelope(envelope), "utf8");
  return bytes <= SUPERVISION_ENVELOPE_MAX_BYTES ? { ok: true, bytes } : { ok: false, reason: "byte-budget-exceeded" };
}
