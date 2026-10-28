import { createHash } from "node:crypto";
import { validModelId, validReasoningEffort, isRuntimeModelCatalog, validEffortNecessity } from "./org-plan-model-policy.mjs";

// Limits include JSON escaping, so attacker-sized metadata never becomes a
// model-visible diagnostic dump. Unknown/malformed evidence is reported as null.
const small = (value, bytes = 96) => typeof value === "string" && value.trim().length > 0 &&
  Buffer.byteLength(JSON.stringify(value), "utf8") <= bytes ? value : null;
const isoTime = (value) => small(value, 40) !== null &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  !Number.isNaN(Date.parse(value)) ? value : null;
const canonical = (value) => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(canonical)
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  : value;
export function executionPolicyDigest(policy) {
  return createHash("sha256").update(JSON.stringify(canonical({
    version: policy.version, model: policy.model, reasoningEffort: policy.reasoningEffort,
    necessity: policy.necessity ?? null,
  }))).digest("hex");
}

const actions = {
  POLICY_INVALID: "Validate the explicit L1 policy and higher-effort necessity.",
  BINDING_UNKNOWN: "Obtain the current canonical child binding and settings revision.",
  CATALOG_UNKNOWN: "Obtain the authoritative runtime catalog and revision.",
  MODEL_UNAVAILABLE: "Revalidate an authorized fallback; never substitute silently.",
  EFFORT_UNSUPPORTED: "Revalidate effort against the catalog; do not raise it silently.",
  RUNTIME_UNKNOWN: "Read authoritative metadata for this child; profile/request values are insufficient.",
  BINDING_MISMATCH: "Read metadata for the current child activation/resume epoch.",
  POLICY_CHANGED: "Rebind the child to the current approved policy and recheck.",
  SETTINGS_CHANGED: "Refresh metadata after the runtime settings revision changed.",
  CATALOG_CHANGED: "Revalidate selection and refresh metadata against the current catalog revision.",
  EFFECTIVE_MODEL_UNKNOWN: "Obtain the child's actual model; preserve unknown until observed.",
  MODEL_PROHIBITED: "Refuse malformed child model metadata; validate exact support against the runtime catalog.",
  EFFECTIVE_EFFORT_UNKNOWN: "Obtain actual child effort; never infer it from defaults or model tier.",
  MODEL_MISMATCH: "Resolve the requested/effective mismatch without per-L1 profile rewrites.",
  EFFORT_MISMATCH: "Resolve the requested/effective effort mismatch before edits.",
  OBSERVATION_UNKNOWN: "Retain the runtime observation timestamp; retrieval time is insufficient.",
};

// Inputs come from trusted host adapters. A source label is a contract, not
// cryptographic provenance. This module does not fetch, launch, or mutate state.
export function assessExecutorSettings({ binding, policy, catalog, runtime } = {}) {
  const authoritative = runtime?.source === "runtime-thread-metadata";
  const report = {
    admitted: false, code: null,
    l1: { id: small(binding?.l1Id), position: Number.isSafeInteger(binding?.position) && binding.position > 0 ? binding.position : null },
    policyVersion: policy?.version === 1 ? 1 : null,
    requested: { model: small(policy?.model, 64), reasoningEffort: small(policy?.reasoningEffort, 24) },
    effective: { model: authoritative ? small(runtime.model, 64) : null,
      reasoningEffort: authoritative ? small(runtime.reasoningEffort, 24) : null },
    child: { threadId: small(binding?.threadId), executionEpoch: small(binding?.executionEpoch), settingsRevision: small(binding?.settingsRevision) },
    catalog: { currentRevision: catalog?.source === "runtime" ? small(catalog.revision) : null,
      observedRevision: authoritative ? small(runtime.catalogRevision) : null },
    policyDigest: null,
    observedAt: authoritative ? isoTime(runtime.observedAt) : null,
    unknown: [], action: null,
  };
  report.unknown = [
    ...Object.entries(report.effective).filter(([, value]) => value === null).map(([key]) => `effective.${key}`),
    ...Object.entries(report.catalog).filter(([, value]) => value === null).map(([key]) => `catalog.${key}`),
    ...(report.observedAt === null ? ["observedAt"] : []),
  ];
  const blocked = (code) => ({ ...report, code, action: actions[code] });
  if (report.policyVersion === null || !validModelId(policy.model) ||
      !validReasoningEffort(policy.reasoningEffort) ||
      !validEffortNecessity(policy.reasoningEffort, policy.necessity)) return blocked("POLICY_INVALID");
  report.policyDigest = executionPolicyDigest(policy);
  if (report.l1.id === null || report.l1.position === null ||
      Object.values(report.child).some((value) => value === null)) return blocked("BINDING_UNKNOWN");
  if (!isRuntimeModelCatalog(catalog) || report.catalog.currentRevision === null) return blocked("CATALOG_UNKNOWN");
  const available = catalog.models.find((entry) => entry.id === policy.model);
  if (!available) return blocked("MODEL_UNAVAILABLE");
  if (!available.reasoningEfforts.includes(policy.reasoningEffort)) return blocked("EFFORT_UNSUPPORTED");
  if (!authoritative) return blocked("RUNTIME_UNKNOWN");
  if (runtime.l1Id !== binding.l1Id || runtime.position !== binding.position ||
      runtime.threadId !== binding.threadId || runtime.executionEpoch !== binding.executionEpoch) return blocked("BINDING_MISMATCH");
  if (runtime.policyDigest !== report.policyDigest) return blocked("POLICY_CHANGED");
  if (runtime.settingsRevision !== binding.settingsRevision) return blocked("SETTINGS_CHANGED");
  if (report.catalog.observedRevision === null) return blocked("CATALOG_UNKNOWN");
  if (runtime.catalogRevision !== catalog.revision) return blocked("CATALOG_CHANGED");
  if (report.effective.model === null) return blocked("EFFECTIVE_MODEL_UNKNOWN");
  if (!validModelId(runtime.model)) return blocked("MODEL_PROHIBITED");
  if (report.effective.reasoningEffort === null) return blocked("EFFECTIVE_EFFORT_UNKNOWN");
  if (runtime.model !== policy.model) return blocked("MODEL_MISMATCH");
  if (runtime.reasoningEffort !== policy.reasoningEffort) return blocked("EFFORT_MISMATCH");
  if (report.observedAt === null) return blocked("OBSERVATION_UNKNOWN");
  return { ...report, admitted: true, code: "MATCH", action: "Continue the assigned L1 within existing authority and permissions." };
}

export function requireExecutorSettings(input) {
  const handshake = assessExecutorSettings(input);
  if (!handshake.admitted) {
    const error = new Error(`Executor preflight blocked: ${handshake.code}`);
    error.code = handshake.code;
    error.handshake = handshake;
    throw error;
  }
  return handshake;
}
