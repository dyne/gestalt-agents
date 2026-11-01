#!/usr/bin/env node
/** Run Mobile's documented actual-helper tests against this source or a temp install. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installOrgPlan } from "../../scripts/install-org-plan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [mobileArgument, mode, scope] = process.argv.slice(2);
if (!mobileArgument || !["source", "installed"].includes(mode) || !["handoff", "policy"].includes(scope) || process.argv.length !== 5) {
  throw new Error("usage: run-org-helper-integration.mjs MOBILE_CHECKOUT {source|installed} {handoff|policy}");
}
const mobile = resolve(mobileArgument);
const directory = mkdtempSync(join(tmpdir(), "org-helper-integration-"));
try {
  const home = join(directory, "home");
  const codex = join(directory, "codex");
  const gestalt = join(directory, "gestalt");
  for (const path of [home, codex, gestalt]) mkdirSync(path);
  let helper = join(root, "plugins/gestalt/skills/org-plan/scripts/org-plan");
  if (mode === "installed") {
    await installOrgPlan(root, codex);
    helper = join(codex, "bin/org-plan");
  }
  const planFile = "src/server/features/plans/application/model-policy.test.ts";
  const autopilotFile = "src/server/features/autopilot/application/service.test.ts";
  // The documented selector's 'model policy' alternative currently matches no
  // policy-file identity. Keep its two handoff identities, then test the real
  // policy-publication identity separately instead of claiming absent coverage.
  const selector = scope === "handoff"
    ? "hands accepted L10 to exactly one root turn|hands accepted L9 through a nested stack|model policy"
    : "consumes actual Agents publication, negotiation and suspend/reopen/resume without policy loss";
  const files = scope === "handoff" ? [planFile, autopilotFile] : [planFile];
  const report = join(directory, "vitest.json");
  const env = { ...process.env, HOME: home, CODEX_HOME: codex, GESTALT_HOME: gestalt,
    GESTALT_TEST_ORG_PLAN_HELPER: helper };
  for (const key of Object.keys(env)) if (key.startsWith("GESTALT_MOBILE_ORG_PLAN_")) delete env[key];
  const result = spawnSync(process.execPath, [join(mobile, "node_modules/vitest/vitest.mjs"),
    "run", ...files, "-t", selector, "--reporter=default", "--reporter=json", `--outputFile=${report}`], {
    cwd: mobile, env, stdio: "inherit", timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Mobile actual-helper tests failed (${result.status ?? result.signal})`);
  const data = JSON.parse(readFileSync(report, "utf8"));
  const assertions = data.testResults.flatMap((file) => file.assertionResults);
  const passed = assertions.filter((test) => test.status === "passed");
  const expected = scope === "handoff" ? 2 : 1;
  const names = passed.map((test) => test.fullName);
  const intended = scope === "handoff"
    ? ["hands accepted L10 to exactly one root turn", "hands accepted L9 through a nested stack"]
    : [selector];
  if (data.numPassedTests !== expected || data.numFailedTests !== 0 || passed.length !== expected ||
      !intended.every((identity) => names.some((name) => name.includes(identity)))) {
    throw new Error(`Wrong actual-helper test selection: expected ${expected} named passes`);
  }
  console.log(JSON.stringify({ mode, scope, passed: passed.length, failed: data.numFailedTests,
    excluded: data.numPendingTests, names,
    agentsHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    mobileHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: mobile, encoding: "utf8" }).trim() }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
