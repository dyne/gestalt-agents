/** npm cmd-shim form: works in cmd and PowerShell without execution-policy changes. */
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export function cmdShim(entry) {
  if (!/^[a-z][a-z0-9-]*$/.test(entry)) throw new Error("invalid native shim entry");
  return ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", "", 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ")", "", `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${entry}" %*`, ""].join("\r\n");
}

export function checkCmdShim(path, entry) {
  const text = cmdShim(entry);
  let info;
  try { info = lstatSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (info && (!info.isFile() || info.isSymbolicLink() || readFileSync(path, "utf8") !== text)) throw new Error(`Refusing to replace unmanaged native command: ${path}`);
  return !!info;
}

export function installCmdShim(path, entry) {
  const text = cmdShim(entry);
  if (checkCmdShim(path, entry)) return false;
  const temporary = `${path}.tmp-${randomUUID()}`;
  try { writeFileSync(temporary, text, { flag: "wx", mode: 0o755 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
  return true;
}
