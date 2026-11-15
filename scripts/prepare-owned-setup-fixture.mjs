#!/usr/bin/env node
/** Hosted CI only: build a pinned, read-only Manager L2 command-port fixture. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

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
writeFileSync(join(root, "agents-fixture.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(`Built pinned ${process.platform}/${process.arch} ownership fixture ${receipt.helperSha256}`);
