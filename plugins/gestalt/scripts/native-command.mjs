/** Native argv execution, including standard npm Node command shims on Windows. */
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

function environmentValue(env, name) {
  const keys = Object.keys(env).filter((key) => process.platform === "win32" ? key.toUpperCase() === name : key === name);
  if (keys.length > 1) throw new Error(`Ambiguous environment aliases for ${name}`);
  return keys.length ? env[keys[0]] : undefined;
}

export function resolveExecutable(name, env = process.env) {
  if (!name || name.includes("\0")) throw new Error("Invalid executable name");
  const explicit = /[\\/]/.test(name) || isAbsolute(name);
  if (explicit && !isAbsolute(name)) throw new Error("Explicit executable path must be absolute");
  const extensions = process.platform === "win32" && !extname(name)
    ? (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((item) => /^\.[a-z0-9]+$/i.test(item)) : [""];
  const directories = explicit ? [""] : (environmentValue(env, "PATH") ?? "").split(delimiter)
    .map((value) => value.replace(/^"(.*)"$/, "$1")).filter(isAbsolute);
  for (const directory of directories) for (const extension of extensions) {
    const candidate = explicit ? name + extension : join(directory, name + extension);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return realpathSync(candidate);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
    }
  }
  throw new Error(`Required executable is missing: ${name}`);
}

// Original recognizer for the npm cmd-shim protocol, observed in npm 11.19.1
// (cmd-shim 8.0.0). Compare every line; never evaluate arbitrary batch source.
export function commandTarget(executable) {
  if (!/\.(cmd|bat)$/i.test(executable)) return { executable, prefix: [] };
  // Node's bundled npm.cmd/npx.cmd are bespoke batch programs, not cmd-shim
  // output. Select their declared package bin directly; do not interpret them.
  const npmBin = /^(npm|npx)\.cmd$/i.exec(basename(executable))?.[1]?.toLowerCase();
  if (npmBin) {
    const packageRoot = join(dirname(executable), "node_modules/npm");
    try {
      const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      const declared = `bin/${npmBin}-cli.js`;
      if (manifest.name === "npm" && manifest.bin?.[npmBin] === declared) {
        const target = realpathSync(join(packageRoot, declared));
        if (!/^#!\s*(?:\/usr\/bin\/env\s+)?node\s*$/.test(readFileSync(target, "utf8").split(/\r?\n/, 1)[0])) throw new Error("npm package bin is not a plain Node entry");
        return { executable: process.execPath, prefix: [target] };
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const source = readFileSync(executable, "utf8").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const invocation = lines.at(-2);
  const entry = invocation?.match(/"%dp0%\\([^"%\r\n]+)" %\*$/)?.[1];
  const inside = lines.includes("  SET PATHEXT=%PATHEXT:;.JS;=;%");
  const expected = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", "", 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', ...(inside ? ["  SET PATHEXT=%PATHEXT:;.JS;=;%"] : []), ")", "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ${inside ? "" : "set PATHEXT=%PATHEXT:;.JS;=;% & "}"%_prog%"  "%dp0%\\${entry}" %*`, ""].join("\n");
  if (!entry || source !== expected) {
    throw new Error(`Unsupported batch shim; a standard npm Node shim is required: ${executable}`);
  }
  const target = realpathSync(resolve(dirname(executable), entry.split("\\").join(sep)));
  if (!/^#!\s*(?:\/usr\/bin\/env\s+)?node\s*$/.test(readFileSync(target, "utf8").split(/\r?\n/, 1)[0])) {
    throw new Error(`npm shim target is not a plain Node entry: ${target}`);
  }
  return { executable: process.execPath, prefix: [target] };
}

export function runCommand(command, args, options = {}) {
  const target = commandTarget(resolveExecutable(command, options.env));
  const result = spawnSync(target.executable, [...target.prefix, ...args], {
    encoding: "utf8", stdio: "inherit", windowsHide: true, timeout: 300_000,
    ...options, shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
  return result.stdout;
}
