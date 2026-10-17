/** Independent consumer of Manager's original-installed-launch-source-v1.
 * No package code is executed and no observation is cached across calls.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && stable(Object.keys(value).sort()) === stable([...keys].sort());
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const inside = (root, path) => path === root || path.startsWith(`${root === "/" ? "" : root}/`);
const fileIdentity = (info) => ({ dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode,
  size: info.size, nlink: info.nlink, ctime: info.ctimeMs, mtime: info.mtimeMs });

export function observeOriginalLaunchSources(manifest, input) {
  if (!Object.hasOwn(manifest, "originalLaunchSources")) return [];
  const reject = () => fail("invalid-installed-launch-source");
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.originalLaunchSources) || manifest.originalLaunchSources.length !== 1) reject();
  const source = manifest.originalLaunchSources[0];
  if (!exact(source, ["kind", "path", "sha256", "gestaltHome", "interpreter", "package", "runtime"])
    || source.kind !== "context-mode-bridge-v1" || !hash(source.sha256)
    || !exact(source.interpreter, ["path", "sha256"]) || !hash(source.interpreter.sha256)
    || !exact(source.package, ["root", "version", "treeDigest"]) || !hash(source.package.treeDigest)
    || !/^\d+\.\d+\.\d+$/.test(source.package.version)
    || !exact(source.runtime, ["root", "treeDigest"]) || !hash(source.runtime.treeDigest)) reject();
  // Bind the descriptor to the independently admitted package, prepared runtime
  // and interpreter. A self-consistent caller descriptor is not sufficient.
  const pkgPin = input.packages.find((item) => item.name === "context-mode");
  if (!pkgPin || source.package.root !== pkgPin.root || source.package.treeDigest !== pkgPin.sha256
    || source.runtime.root !== input.runtime.root || source.runtime.treeDigest !== input.runtime.sha256
    || stable(source.interpreter) !== stable(input.node)) reject();
  const writeRoots = manifest.sandboxState.permissionProfile.file_system.entries.filter((entry) => entry.access === "write").map((entry) => {
    if (entry.path?.type === "path") return entry.path.path;
    if (entry.path?.type === "special" && entry.path.value?.kind === "root") return "/";
    if (entry.path?.type === "special" && entry.path.value?.kind === "slash_tmp") return "/tmp";
    reject();
  });
  const parents = new Map();
  const canonical = (path) => {
    if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) fail("untrusted-installed-launch-source");
  };
  const protectedInfo = (path, directory = false, ancestry = false) => {
    canonical(path);
    const info = lstatSync(path);
    if ((directory ? !info.isDirectory() : !info.isFile()) || ![0, process.getuid()].includes(info.uid)
      || ((info.mode & 0o022) && !(ancestry && (info.mode & 0o1000)))
      || writeRoots.some((root) => typeof root !== "string" || inside(root, path))) fail("untrusted-installed-launch-source");
    return info;
  };
  const directoryPin = (path, ancestry = false) => {
    protectedInfo(path, true, ancestry);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try {
      const before = fstatSync(fd);
      const pin = (info) => ({ dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode,
        ctime: info.ctimeMs, mtime: info.mtimeMs, birthtime: info.birthtimeMs });
      if (!before.isDirectory() || (!ancestry && before.uid !== process.getuid())
        || stable(pin(before)) !== stable(pin(fstatSync(fd))) || stable(pin(before)) !== stable(pin(lstatSync(path)))) fail("installed-launch-source-changed");
      return ancestry ? { dev: before.dev, ino: before.ino, uid: before.uid, mode: before.mode } : pin(before);
    } finally { closeSync(fd); }
  };
  const checkedPath = (path, directory = false) => {
    protectedInfo(path, directory);
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      if (parents.has(parent)) break;
      parents.set(parent, directoryPin(parent, true));
      if (parent === "/") break;
    }
  };
  const read = (path, treeMember = false) => {
    checkedPath(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink < 1 || (!treeMember && before.nlink !== 1) || before.size > 512 * 1024 * 1024) fail("installed-launch-source-changed");
      const bytes = readFileSync(fd), identity = fileIdentity(before);
      if (realpathSync(path) !== path || stable(identity) !== stable(fileIdentity(fstatSync(fd)))
        || stable(identity) !== stable(fileIdentity(lstatSync(path)))) fail("installed-launch-source-changed");
      return { bytes, observation: { sha256: digest(bytes), identity } };
    } finally { closeSync(fd); }
  };
  const tree = (root) => {
    const files = [], identities = [], contents = new Map(), groups = new Map(), directories = [];
    let nodes = 0, bytes = 0;
    const walk = (directory) => {
      if (++nodes > 20000) reject();
      checkedPath(directory, true);
      const pin = directoryPin(directory), names = readdirSync(directory).sort();
      directories.push({ directory, pin, names }); identities.push([relative(root, directory), pin]);
      for (const name of names) {
        const path = join(directory, name), info = lstatSync(path);
        if (info.isDirectory()) { walk(path); continue; }
        if (++nodes > 20000 || (bytes += info.size) > 512 * 1024 * 1024) reject();
        const current = read(path, true), rel = relative(root, path), identity = current.observation.identity;
        const key = stable([identity.dev, identity.ino]), group = groups.get(key) ?? { identity, paths: [] };
        if (stable(group.identity) !== stable(identity)) fail("installed-launch-source-changed");
        group.paths.push(path); groups.set(key, group);
        files.push([rel, info.mode & 0o777, current.observation.sha256]); identities.push([rel, identity]); contents.set(rel, current.bytes);
      }
      if (stable(names) !== stable(readdirSync(directory).sort()) || stable(pin) !== stable(directoryPin(directory))) fail("installed-launch-source-changed");
    };
    const recheck = () => {
      for (const { identity, paths } of groups.values()) {
        if (paths.length !== identity.nlink) fail("installed-launch-source-changed");
        for (const path of paths) {
          checkedPath(path);
          if (stable(fileIdentity(lstatSync(path))) !== stable(identity)) fail("installed-launch-source-changed");
        }
      }
      for (const { directory, pin, names } of directories) {
        checkedPath(directory, true);
        if (stable(pin) !== stable(directoryPin(directory)) || stable(names) !== stable(readdirSync(directory).sort())) fail("installed-launch-source-changed");
      }
    };
    walk(root); recheck();
    return { contents, recheck, observation: { treeDigest: digest(stable(files)), identityDigest: digest(stable(identities)) } };
  };
  const home = manifest.owningRuntime?.home ?? manifest.runtimeHome, bin = join(home, "bin");
  checkedPath(home, true); checkedPath(bin, true); checkedPath(source.gestaltHome, true);
  const homeInfo = lstatSync(home), launcherInfo = lstatSync(source.path);
  if (homeInfo.uid !== process.getuid() || homeInfo.mode & 0o077 || lstatSync(bin).uid !== process.getuid()
    || source.path !== join(bin, "context-mode-mcp.mjs") || launcherInfo.uid !== process.getuid() || (launcherInfo.mode & 0o7777) !== 0o755) fail("untrusted-installed-launch-source");
  if (source.package.root.split("/").at(-1) !== source.package.version || source.package.root.split("/").at(-2) !== "context-mode"
    || source.runtime.root !== join(source.gestaltHome, "runtime/context-mode") || inside(home, source.package.root) || inside(source.package.root, source.runtime.root)) reject();
  const interpreter = read(source.interpreter.path), launcher = read(source.path);
  if (!(interpreter.observation.identity.mode & 0o111) || interpreter.observation.sha256 !== source.interpreter.sha256) fail("installed-launch-source-changed");
  const pkg = tree(source.package.root), runtime = tree(source.runtime.root);
  pkg.recheck(); runtime.recheck();
  for (const [parent, pin] of parents) if (stable(directoryPin(parent, true)) !== stable(pin)) fail("installed-launch-source-changed");
  for (const [path, observed] of [[source.path, launcher], [source.interpreter.path, interpreter]])
    if (stable(fileIdentity(lstatSync(path))) !== stable(observed.observation.identity)) fail("installed-launch-source-changed");
  const expected = `#!/usr/bin/env node\nimport { pathToFileURL } from "node:url";\n\nprocess.env.GESTALT_HOME ||= ${JSON.stringify(source.gestaltHome)};\nprocess.env.CONTEXT_MODE_PLATFORM = "codex";\nprocess.env.CONTEXT_MODE_WORKSPACE ||= process.cwd();\nawait import(pathToFileURL(${JSON.stringify(join(source.package.root, "start.mjs"))}).href);\n`;
  if (launcher.bytes.toString() !== expected || launcher.observation.sha256 !== source.sha256
    || pkg.observation.treeDigest !== source.package.treeDigest || runtime.observation.treeDigest !== source.runtime.treeDigest) fail("installed-launch-source-changed");
  const json = (contents, path) => { try { return JSON.parse(contents.get(path)?.toString()); } catch { reject(); } };
  const packageJson = json(pkg.contents, "package.json"), runtimeJson = json(runtime.contents, "package.json"), prepared = json(runtime.contents, ".context-mode-prepared.json");
  if (packageJson?.name !== "context-mode" || packageJson.version !== source.package.version || runtimeJson?.name !== "context-mode" || runtimeJson.version !== source.package.version
    || !pkg.contents.has("start.mjs") || !exact(prepared, ["schemaVersion", "packageVersion", "preparedAt", "node", "nodeModulesAbi", "platform", "arch", "bun", "files"])
    || prepared.schemaVersion !== 2 || prepared.packageVersion !== source.package.version || prepared.platform !== process.platform || prepared.arch !== process.arch
    || prepared.nodeModulesAbi !== process.versions.modules || typeof prepared.node !== "string" || typeof prepared.preparedAt !== "string"
    || !prepared.files || typeof prepared.files !== "object" || Array.isArray(prepared.files)) reject();
  const required = ["start.mjs", "scripts/codex-profile.mjs", "scripts/runtime-location.mjs", "scripts/runtime-preflight.mjs", "server.bundle.mjs", "cli.bundle.mjs",
    ...["security", "session-db", "session-extract", "session-attribution", "session-snapshot", "codex-usage"].map((name) => `hooks/${name}.bundle.mjs`),
    "node_modules/better-sqlite3/package.json", "node_modules/better-sqlite3/build/Release/better_sqlite3.node", "node_modules/turndown/package.json", "node_modules/turndown-plugin-gfm/package.json", "node_modules/@mixmark-io/domino/package.json"];
  if (required.some((path) => !hash(prepared.files[path]) || !runtime.contents.has(path))
    || Object.entries(prepared.files).some(([path, sha]) => !hash(sha) || !runtime.contents.has(path) || digest(runtime.contents.get(path)) !== sha)) reject();
  return [{ kind: "installed-launch-source", descriptor: source, observation: { launcher: launcher.observation, interpreter: interpreter.observation,
    package: pkg.observation, runtime: runtime.observation, parentsDigest: digest(stable([...parents].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))),
    home: directoryPin(home, true), bin: directoryPin(bin, true), gestaltHome: directoryPin(source.gestaltHome, true) } }];
}
