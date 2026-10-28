// Pure selection contract. Catalog acquisition and effective launch verification
// belong to runtime adapters; importing this module never probes or mutates them.
export const MODEL_POLICY_VERSION = 1;
export const MODEL_IDS = Object.freeze([
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
]);
// Advisory rubric tiers, not an allowlist. The owning runtime catalog decides support.
export const validModelId = (value) => typeof value === "string" && value !== "none" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(value);
export const validReasoningEffort = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{0,23}$/.test(value);
const axes = [
  "ambiguity", "scope", "coupling", "correctnessRisk", "testWeakness",
];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const fail = (code) => ({ ok: false, code });

export function validEffortNecessity(effort, need) {
  if (!validReasoningEffort(effort)) return false;
  if (need == null || (object(need) && Object.keys(need).length === 0)) return true;
  return (object(need) &&
    ["unresolved-correctness", "specific-reasoning"].includes(need.kind) &&
    ["whyMediumInadequate", "evidence", "affectedScope", "returnToMedium"].every((key) => text(need[key])) &&
    (effort !== "xhigh" || text(need.scopeReassessment)));
}

export function isRuntimeModelCatalog(catalog) {
  return object(catalog) && catalog.source === "runtime" && text(catalog.revision) &&
    Array.isArray(catalog.models) && catalog.models.length > 0 &&
    catalog.models.every((entry) => object(entry) && text(entry.id) &&
      Array.isArray(entry.reasoningEfforts) && entry.reasoningEfforts.length > 0 &&
      entry.reasoningEfforts.every(text) &&
      new Set(entry.reasoningEfforts).size === entry.reasoningEfforts.length) &&
    new Set(catalog.models.map((entry) => entry.id)).size === catalog.models.length;
}

export function recommendedModel(scores) {
  if (!object(scores) || Object.keys(scores).length !== axes.length ||
      !axes.every((axis) => Number.isInteger(scores[axis]) && scores[axis] >= 0 && scores[axis] <= 2)) {
    throw new TypeError("MODEL_SCORES_INVALID");
  }
  const total = axes.reduce((sum, axis) => sum + scores[axis], 0);
  if (total === 0) return MODEL_IDS[0];
  return total <= 5 && scores.scope < 2 && scores.coupling < 2
    ? MODEL_IDS[1] : MODEL_IDS[2];
}

export function validateModelSelection(selection, catalog, { allowedModels } = {}) {
  if (allowedModels !== undefined && (!Array.isArray(allowedModels) || !allowedModels.length ||
      allowedModels.some((id) => !validModelId(id)) || new Set(allowedModels).size !== allowedModels.length)) {
    return fail("MODEL_CONSTRAINTS_INVALID");
  }
  if (!object(selection)) return fail("MODEL_SELECTION_INVALID");
  let recommended;
  try { recommended = recommendedModel(selection.scores); }
  catch { return fail("MODEL_SCORES_INVALID"); }
  if (!object(selection.scoreReasons) || !axes.every((axis) => text(selection.scoreReasons[axis])) ||
      !text(selection.rationale) || !text(selection.escalationTrigger)) return fail("MODEL_RATIONALE_REQUIRED");
  if (!validModelId(selection.model)) return fail("MODEL_DISALLOWED");
  if (allowedModels && !allowedModels.includes(selection.model)) return fail("MODEL_CONSTRAINT_CONFLICT");
  if (!Array.isArray(selection.fallbacks) || new Set(selection.fallbacks).size !== selection.fallbacks.length ||
      selection.fallbacks.some((id) => !validModelId(id) || id === selection.model ||
        (allowedModels && !allowedModels.includes(id)))) {
    return fail("MODEL_FALLBACK_INVALID");
  }
  const effort = selection.effort === undefined ? "medium" : selection.effort;
  if (!validReasoningEffort(effort)) return fail("MODEL_EFFORT_DISALLOWED");
  if (!validEffortNecessity(effort, selection.necessity)) return fail("MODEL_NECESSITY_REQUIRED");
  if (!isRuntimeModelCatalog(catalog)) {
    return fail("MODEL_CATALOG_UNKNOWN");
  }
  const available = [selection.model, ...selection.fallbacks]
    .find((id) => catalog.models.some((entry) => entry.id === id));
  if (!available) return fail("MODEL_UNAVAILABLE");
  const entry = catalog.models.find((candidate) => candidate.id === available);
  if (!entry.reasoningEfforts.includes(effort)) return fail("MODEL_EFFORT_UNSUPPORTED");
  return {
    ok: true, policyVersion: MODEL_POLICY_VERSION, model: available, effort,
    recommended, catalogRevision: catalog.revision,
    fallbackReason: available === selection.model ? null : "preferred-unavailable",
  };
}
