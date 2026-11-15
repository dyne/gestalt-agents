#!/usr/bin/env node
/** Hosted CI only: build a pinned, read-only Manager L2 command-port fixture. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { instrumentWindowsOwnedHelper } from "./owned-helper-diagnostics.mjs";

const pin = "cb7dbf1bfb2221bd0b3f4366311280e53cd712be";
const root = realpathSync(resolve(process.argv[2]));
assert.equal(execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), pin);
assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "", "ownership fixture tracked inputs must match the pin");
const sources = ["scripts/build-owned-process.mjs", "src/cli/contracts.ts", "src/cli/platform/processes.ts", "src/cli/platform/executables.ts", "src/cli/platform/native/owned-process.c"];
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sourceHashes = Object.fromEntries(sources.map((name) => [name, sha256(join(root, name))]));
const { buildOwnedProcess } = await import(pathToFileURL(join(root, "scripts/build-owned-process.mjs")).href);
const helper = await buildOwnedProcess(root, join(root, ".agents-test-native"));
const receipt = { schemaVersion: 1, repository: "https://github.com/dyne/gestalt", pin, sourceHashes, helper: ".agents-test-native/" + (process.platform === "win32" ? "gestalt-owned-process.exe" : "gestalt-owned-process"), helperSha256: sha256(helper), provenance: JSON.parse(readFileSync(`${helper}.provenance.json`, "utf8")), observedAt: new Date().toISOString() };
if (process.platform === "win32") {
  const original = join(root, "src/cli/platform/native/owned-process.c");
  const diagnosticRoot = join(root, ".agents-test-diagnostic-source");
  const diagnosticSource = join(diagnosticRoot, "src/cli/platform/native/owned-process.c");
  const diagnostic = instrumentWindowsOwnedHelper(readFileSync(original, "utf8"));
  mkdirSync(join(diagnosticRoot, "src/cli/platform/native"), { recursive: true });
  writeFileSync(diagnosticSource, diagnostic.source);
  const patchPath = join(diagnosticRoot, "diagnostics.patch");
  const patch = spawnSync("git", ["diff", "--no-index", "--", original, diagnosticSource], { encoding: "utf8", shell: false });
  assert.equal(patch.status, 1, patch.stderr); writeFileSync(patchPath, patch.stdout);
  const binary = await buildOwnedProcess(diagnosticRoot, join(root, ".agents-test-diagnostic-native"));
  receipt.diagnostic = {
    testOnly: true, replacesAcceptance: false, originalPin: pin, originalSourceSha256: sha256(original),
    source: ".agents-test-diagnostic-source/src/cli/platform/native/owned-process.c", sourceSha256: sha256(diagnosticSource),
    patch: ".agents-test-diagnostic-source/diagnostics.patch", patchSha256: sha256(patchPath),
    helper: ".agents-test-diagnostic-native/gestalt-owned-process.exe", helperSha256: sha256(binary),
    provenance: JSON.parse(readFileSync(`${binary}.provenance.json`, "utf8")), sites: diagnostic.sites, counts: diagnostic.counts,
  };
}
writeFileSync(join(root, "agents-fixture.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(`Built pinned ${process.platform}/${process.arch} ownership fixture ${receipt.helperSha256}`);
