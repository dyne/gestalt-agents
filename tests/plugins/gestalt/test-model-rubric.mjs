import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODEL_IDS, recommendedModel, validateModelSelection,
} from "../../../plugins/gestalt/skills/org-plan/scripts/org-plan-model-policy.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/model-rubric.json", import.meta.url), "utf8"));
const axes = ["ambiguity", "scope", "coupling", "correctnessRisk", "testWeakness"];
const base = {
  scores: Object.fromEntries(axes.map((axis) => [axis, 0])),
  scoreReasons: {
    ambiguity: "Exact replacement specified by acceptance criteria",
    scope: "One mechanical fixture edit",
    coupling: "No shared interface changes",
    correctnessRisk: "Reversible fixture-only edit",
    testWeakness: "Deterministic expected output check",
  },
  model: "gpt-6-luna",
  rationale: "The smallest tier can perform this exact edit with direct verification",
  fallbacks: [],
  escalationTrigger: "Focused output check exposes behavior outside the specified replacement",
};
let passed = 0;
function check(name, run) {
  try { run(); passed += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
const evaluate = (patch = {}, catalog = fixture.catalog, constraints) =>
  validateModelSelection({ ...structuredClone(base), ...patch }, catalog, constraints);
const rejects = (patch, code, catalog = fixture.catalog, constraints) =>
  assert.deepEqual(evaluate(patch, catalog, constraints), { ok: false, code });

for (const item of fixture.cases) {
  check(`${item.id} selects expected tier and medium`, () => {
    const scores = Object.fromEntries(axes.map((axis, index) => [axis, item.scores[index]]));
    assert.equal(recommendedModel(scores), item.model);
    const result = evaluate({ scores, model: item.model });
    assert.equal(result.ok, true);
    assert.equal(result.model, item.model);
    assert.equal(result.effort, "medium");
    assert.equal(result.catalogRevision, fixture.catalog.revision);
    assert.equal(result.fallbackReason, null);
  });
}
check("explicit medium on every tier", () => {
  for (const model of MODEL_IDS) assert.equal(evaluate({ model, effort: "medium" }).effort, "medium");
});
const necessity = {
  kind: "unresolved-correctness",
  whyMediumInadequate: "Focused medium investigation leaves two ownership orderings unresolved",
  evidence: "Isolated trace fixture race-17 and failed invariant check ownership-3",
  affectedScope: "Ownership ordering proof for the bounded handoff",
  returnToMedium: "Ordering proven and captured in deterministic regression ownership-3",
};
check("justified high exception", () => {
  assert.equal(evaluate({ model: "gpt-6-sol", effort: "high", necessity }).ok, true);
});
check("specific reasoning exception", () => {
  assert.equal(evaluate({ effort: "high", necessity: { ...necessity, kind: "specific-reasoning" } }).ok, true);
});
check("xhigh requires scope reassessment", () => {
  rejects({ model: "gpt-6-sol", effort: "xhigh", necessity }, "MODEL_NECESSITY_REQUIRED");
  assert.equal(evaluate({ model: "gpt-6-sol", effort: "xhigh", necessity: { ...necessity, scopeReassessment: "The invariant cannot be split across independent acceptance outcomes" } }).ok, true);
});
check("complexity and retry labels cannot justify high", () => {
  for (const kind of ["complexity", "concurrency", "protocol", "rejected-review", "retry", "elapsed-time"]) {
    rejects({ effort: "high", necessity: { ...necessity, kind } }, "MODEL_NECESSITY_REQUIRED");
  }
});
check("every exception field required", () => {
  rejects({ effort: "high" }, "MODEL_NECESSITY_REQUIRED");
  for (const key of Object.keys(necessity)) {
    const incomplete = { ...necessity };
    delete incomplete[key];
    rejects({ effort: "high", necessity: incomplete }, "MODEL_NECESSITY_REQUIRED");
  }
});
check("unavailable preferred fails without allowed fallback", () => {
  rejects({}, "MODEL_UNAVAILABLE", { ...fixture.catalog, models: fixture.catalog.models.slice(1) });
});
check("explicit available fallback retains medium and provenance", () => {
  const result = evaluate({ fallbacks: ["gpt-6-sol", "gpt-6.1-sol"] }, { ...fixture.catalog, models: fixture.catalog.models.slice(1) });
  assert.equal(result.model, "gpt-6-sol");
  assert.equal(result.effort, "medium");
  assert.equal(result.fallbackReason, "preferred-unavailable");
});
check("fallback cannot underpower rubric", () => {
  rejects({ model: "gpt-6.1-sol", scores: { ...base.scores, scope: 2 }, fallbacks: ["gpt-6-luna"] }, "MODEL_FALLBACK_INVALID");
});
check("unsupported effort never auto-escalates or silently falls back", () => {
  const catalog = { ...fixture.catalog, models: [{ id: "gpt-6-luna", reasoningEfforts: ["high"] }, fixture.catalog.models[1]] };
  rejects({ fallbacks: ["gpt-6-sol"] }, "MODEL_EFFORT_UNSUPPORTED", catalog);
  rejects({ effort: "xhigh", necessity: { ...necessity, scopeReassessment: "Same bounded invariant" } }, "MODEL_EFFORT_UNSUPPORTED");
});
check("Astra, aliases and unsupported models rejected even in catalog", () => {
  for (const model of ["gpt-6-astra", "gpt-6", "gpt-6.1", "luna", "kimi", "gpt-5.6-sol"]) {
    rejects({ model }, "MODEL_DISALLOWED", { ...fixture.catalog, models: [...fixture.catalog.models, { id: model, reasoningEfforts: ["medium"] }] });
    rejects({ fallbacks: [model] }, "MODEL_FALLBACK_INVALID");
  }
});
check("effort ceiling", () => {
  for (const effort of ["max", "ultra", "HIGH", "low", "", null]) rejects({ effort }, "MODEL_EFFORT_DISALLOWED");
});
check("catalog missing, unknown, unversioned or malformed", () => {
  for (const catalog of [null, {}, { ...fixture.catalog, source: "profile" }, { ...fixture.catalog, revision: "" }, { ...fixture.catalog, models: [] }, { ...fixture.catalog, models: [...fixture.catalog.models, fixture.catalog.models[0]] }, { ...fixture.catalog, models: [{ id: "gpt-6-luna", reasoningEfforts: [] }] }]) {
    rejects({}, "MODEL_CATALOG_UNKNOWN", catalog);
  }
});
check("conflicting user constraints", () => {
  rejects({ model: "gpt-6.1-sol", scores: { ...base.scores, scope: 2 } }, "MODEL_CONSTRAINT_CONFLICT", fixture.catalog, { allowedModels: ["gpt-6-luna"] });
  rejects({ model: "gpt-6-luna", scores: { ...base.scores, scope: 2 } }, "MODEL_BELOW_RUBRIC");
  rejects({ fallbacks: ["gpt-6-sol"] }, "MODEL_FALLBACK_INVALID", fixture.catalog, { allowedModels: ["gpt-6-luna"] });
});
check("invalid constraints cannot widen policy", () => {
  for (const allowedModels of [[], ["gpt-6-astra"], ["gpt-6-sol", "gpt-6-sol"]]) {
    rejects({}, "MODEL_CONSTRAINTS_INVALID", fixture.catalog, { allowedModels });
  }
});
check("all selection rationale and score axes required", () => {
  for (const key of ["scoreReasons", "rationale", "escalationTrigger"]) rejects({ [key]: null }, "MODEL_RATIONALE_REQUIRED");
  for (const scores of [{}, { ...base.scores, ambiguity: 3 }, { ...base.scores, scope: 0.5 }, { ...base.scores, extra: 0 }]) rejects({ scores }, "MODEL_SCORES_INVALID");
});
check("fallback declaration required and unique", () => {
  for (const fallbacks of [undefined, null, ["gpt-6-sol", "gpt-6-sol"], ["gpt-6-luna"]]) rejects({ fallbacks }, "MODEL_FALLBACK_INVALID");
});
check("pure validation never alters inputs", () => {
  const selection = structuredClone(base), catalog = structuredClone(fixture.catalog);
  const before = JSON.stringify({ selection, catalog });
  validateModelSelection(selection, catalog);
  assert.equal(JSON.stringify({ selection, catalog }), before);
});
console.log(`Model rubric: ${passed} passed, 0 failed, 0 skipped, ${passed} total (synthetic catalog; live quality unverified)`);
