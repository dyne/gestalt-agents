import { MODEL_IDS, MODEL_POLICY_VERSION, validEffortNecessity } from "./org-plan-model-policy.mjs";
import { fail } from "./org-plan-files.mjs";

export const MODEL_POLICY_CAPABILITY = "l1-model-policy-v1";
const required = ["MODEL", "REASONING_EFFORT", "MODEL_RATIONALE", "MODEL_FALLBACKS", "MODEL_ESCALATION_TRIGGER"];
const necessityFields = {
  EFFORT_NECESSITY_KIND: "kind",
  EFFORT_NECESSITY: "whyMediumInadequate",
  EFFORT_EVIDENCE: "evidence",
  EFFORT_SCOPE: "affectedScope",
  RETURN_TO_MEDIUM: "returnToMedium",
  SCOPE_REASSESSMENT: "scopeReassessment",
};
export const MODEL_POLICY_PROPERTIES = Object.freeze([...required, ...Object.keys(necessityFields)]);

export function parseModelPolicy(item, version) {
  const properties = item.properties;
  const declared = MODEL_POLICY_PROPERTIES.filter((key) => properties.has(key));
  const invalid = (message) => fail(`line ${item.line + 1} (${item.id}): ${message}`);
  if (properties.has("MODEL_POLICY_VERSION")) invalid("MODEL_POLICY_VERSION belongs in document metadata");
  if (item.level === 2 && declared.length) invalid("L1-only model policy property");
  if (version === null) {
    if (declared.length) invalid("model policy properties require MODEL_POLICY_VERSION");
    return null;
  }
  if (item.level === 2) return null;
  for (const key of required) {
    if (!properties.get(key)?.trim()) invalid(`missing ${key}`);
  }
  for (const key of declared) {
    const value = properties.get(key);
    if (!value.trim() || Buffer.byteLength(value, "utf8") > 1024) invalid(`invalid ${key}: expected 1..1024 UTF-8 bytes`);
  }
  const model = properties.get("MODEL");
  const reasoningEffort = properties.get("REASONING_EFFORT");
  if (!MODEL_IDS.includes(model)) invalid("invalid MODEL: exact policy ID required; Astra and aliases prohibited");
  if (!["medium", "high", "xhigh"].includes(reasoningEffort)) invalid("invalid REASONING_EFFORT");
  const rawFallbacks = properties.get("MODEL_FALLBACKS");
  const allowedFallbacks = rawFallbacks === "none" ? [] : rawFallbacks.split(" ");
  if (allowedFallbacks.some((id) => !MODEL_IDS.includes(id) || id === model) ||
      new Set(allowedFallbacks).size !== allowedFallbacks.length) invalid("invalid MODEL_FALLBACKS");
  const necessity = Object.fromEntries(Object.entries(necessityFields)
    .filter(([key]) => properties.has(key)).map(([key, target]) => [target, properties.get(key)]));
  if (!validEffortNecessity(reasoningEffort, necessity)) invalid("higher effort requires concrete necessity, evidence, scope and return-to-medium condition");
  if (reasoningEffort === "medium" && Object.keys(necessity).length) invalid("medium must not carry a higher-effort exception");
  return { version: MODEL_POLICY_VERSION, model, reasoningEffort,
    rationale: properties.get("MODEL_RATIONALE"), allowedFallbacks,
    escalationTrigger: properties.get("MODEL_ESCALATION_TRIGGER"),
    necessity: reasoningEffort === "medium" ? null : necessity };
}

// Summaries retain exact choices; omitted rationale is recoverable from the
// fingerprinted L1 drawer, never mistaken for the full authoring contract.
function bounded(value, budget) {
  if (Buffer.byteLength(value, "utf8") <= budget) return value;
  let output = "";
  for (const character of value) {
    if (Buffer.byteLength(output + character + "…", "utf8") > budget) break;
    output += character;
  }
  return output + "…";
}
export function describeModelPolicy(policy) {
  if (policy === null) return null;
  return { version: policy.version, model: policy.model, reasoningEffort: policy.reasoningEffort,
    rationale: bounded(policy.rationale, 160), allowedFallbacks: policy.allowedFallbacks,
    escalationTrigger: bounded(policy.escalationTrigger, 128),
    higherEffortException: policy.necessity !== null,
    details: "Full policy: this L1 property drawer; summary may abbreviate rationale/trigger" };
}
