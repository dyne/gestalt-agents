#!/usr/bin/env node
import { AdmissionError, prepareAdmission, stageAdmission, verifyAdmission } from "../live-admission.mjs";

const [operation, flag, path, ...extra] = process.argv.slice(2);
let result;
try {
  if (!["stage", "prepare", "verify"].includes(operation) || flag !== "--bootstrap" || !path || extra.length) throw new AdmissionError("invalid-admission-command");
  result = ({ stage: stageAdmission, prepare: prepareAdmission, verify: verifyAdmission })[operation](path);
} catch (error) {
  result = { schemaVersion: 1, available: false, liveReady: false, reason: error instanceof AdmissionError ? error.reason : "admission-unavailable" };
}
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.available === true ? 0 : 1;
