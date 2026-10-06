import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  installRuntime,
  verifyInstalledRuntime,
} from "../../plugins/context-mode/scripts/install-runtime.mjs";
import { REQUIRED_FILES } from "../../plugins/context-mode/scripts/runtime-preflight.mjs";
import {
  installGestaltCommands,
  installManagedCommands,
} from "../../scripts/install-managed-commands.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "gestalt-runtime-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, "gestalt home ' $()");
  const source = join(directory, "source");
  mkdirSync(source);
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  return {
    home,
    source,
    env: { GESTALT_HOME: home },
    target: join(home, "runtime", "context-mode"),
  };
}
// Exercise the real copy/preflight/publication path without downloading dependencies.
async function prepare(stage) {
  const files = {};
  for (const name of REQUIRED_FILES) {
    const path = join(stage, name);
    mkdirSync(dirname(path), { recursive: true });
    const content = `fixture artifact ${name}\n`;
    writeFileSync(path, content);
    files[name] = createHash("sha256").update(content).digest("hex");
  }
  writeFileSync(
    join(stage, ".context-mode-prepared.json"),
    JSON.stringify({
      schemaVersion: 2,
      packageVersion: JSON.parse(readFileSync(join(stage, "package.json")))
        .version,
      nodeModulesAbi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      files,
    }),
  );
}

test("upgrades replace the single runtime and migrate legacy version directories", async (t) => {
  const { source, target, home, env } = fixture(t);
  for (const version of ["0.8.0", "0.9.0"])
    mkdirSync(join(target, version, "linux-x64-node-137"), { recursive: true });
  const data = join(home, "workspace-data");
  writeFileSync(data, "keep");
  await installRuntime(source, { env, prepare });
  assert.equal(verifyInstalledRuntime(source, target).ok, true);
  assert.equal(existsSync(join(target, "0.9.0")), false);
  let builds = 0;
  const counted = async (stage) => {
    builds++;
    await prepare(stage);
  };
  assert.equal(await installRuntime(source, { env, prepare: counted }), target);
  assert.equal(builds, 0);
  writeFileSync(join(source, "package.json"), '{"version":"2.0.0"}');
  assert.equal(verifyInstalledRuntime(source, target).ok, false);
  assert.equal(await installRuntime(source, { env, prepare: counted }), target);
  assert.equal(builds, 1);
  assert.equal(
    JSON.parse(readFileSync(join(target, "package.json"))).version,
    "2.0.0",
  );
  assert.deepEqual(readdirSync(dirname(target)), ["context-mode"]);
  assert.equal(readFileSync(data, "utf8"), "keep");
});

test("failed preparation and failed staged verification preserve the previous runtime", async (t) => {
  const { source, target, env } = fixture(t);
  await installRuntime(source, { env, prepare });
  writeFileSync(join(source, "package.json"), '{"version":"2.0.0"}');
  await assert.rejects(
    installRuntime(source, {
      env,
      prepare: async () => {
        throw new Error("build failed");
      },
    }),
    /build failed/,
  );
  await assert.rejects(
    installRuntime(source, { env, prepare: async () => {} }),
    /staged runtime is invalid/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(target, "package.json"))).version,
    "1.0.0",
  );
  assert.deepEqual(readdirSync(dirname(target)), ["context-mode"]);
});

test("an ABI mismatch rebuilds in place and concurrent installers share a lock", async (t) => {
  const { source, target, env } = fixture(t);
  await installRuntime(source, { env, prepare });
  const marker = join(target, ".context-mode-prepared.json");
  const manifest = JSON.parse(readFileSync(marker));
  writeFileSync(marker, JSON.stringify({ ...manifest, nodeModulesAbi: "old" }));
  let builds = 0;
  const counted = async (stage) => {
    builds++;
    await prepare(stage);
  };
  await Promise.all([
    installRuntime(source, { env, prepare: counted }),
    installRuntime(source, { env, prepare: counted }),
  ]);
  assert.equal(builds, 1);
  assert.equal(verifyInstalledRuntime(source, target).ok, true);
  assert.deepEqual(readdirSync(dirname(target)), ["context-mode"]);
});

test("stable commands preserve arguments, environment overrides, and exit status", (t) => {
  const { home, source, target } = fixture(t);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, "cli.bundle.mjs"),
    "console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.GESTALT_HOME}));process.exit(7);",
  );
  const codex = join(home, "codex home");
  mkdirSync(join(codex, "bin"), { recursive: true });
  mkdirSync(join(codex, "lib", "gestalt-org-plan"), { recursive: true });
  const orgSource = join(root, "plugins/gestalt/skills/org-plan/scripts");
  copyFileSync(join(orgSource, "org-plan"), join(codex, "bin", "org-plan"));
  for (const file of readdirSync(orgSource).filter((name) =>
    name.endsWith(".mjs"),
  )) {
    copyFileSync(
      join(orgSource, file),
      join(codex, "lib", "gestalt-org-plan", file),
    );
  }
  installGestaltCommands(home, codex);
  installGestaltCommands(home, codex);
  const env = { ...process.env, GESTALT_HOME: "override" };
  const result = spawnSync(
    join(home, "bin", "context-mode"),
    ["doctor", "an argument", "$(false)", "it's quoted"],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ["doctor", "an argument", "$(false)", "it's quoted"],
    home: "override",
  });
  delete env.GESTALT_HOME;
  assert.equal(
    JSON.parse(
      spawnSync(join(home, "bin", "context-mode"), [], {
        encoding: "utf8",
        env,
      }).stdout,
    ).home,
    home,
  );
  copyFileSync(
    join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"),
    join(source, "plan.org"),
  );
  const org = spawnSync(
    join(home, "bin", "org-plan"),
    ["validate", join(source, "plan.org")],
    { encoding: "utf8", env },
  );
  assert.equal(org.status, 0, org.stderr);
  assert.deepEqual(readdirSync(join(home, "bin")).sort(), [
    "context-mode",
    "org-plan",
  ]);
});

test("the registry accepts future commands and preserves unmanaged files", (t) => {
  const { home } = fixture(t);
  installManagedCommands(home, [
    {
      name: "future-tool",
      command: [process.execPath, "-e", "process.exit(3)"],
    },
  ]);
  assert.equal(spawnSync(join(home, "bin", "future-tool")).status, 3);
  writeFileSync(join(home, "bin", "user-tool"), "user content");
  assert.throws(
    () =>
      installManagedCommands(home, [{ name: "user-tool", command: ["true"] }]),
    /unmanaged command/,
  );
  assert.equal(
    readFileSync(join(home, "bin", "user-tool"), "utf8"),
    "user content",
  );
  assert.throws(
    () =>
      installManagedCommands(home, [{ name: "../escape", command: ["true"] }]),
    /Invalid/,
  );
});
