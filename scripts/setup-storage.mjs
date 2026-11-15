/** Destination validation and recoverable setup snapshots; no live profile defaults. */
/* Windows ACL helper portions: Copyright (c) 2026 Dyne.org contributors. MIT.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
import { cpSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export function optionalStat(path) {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Resolve existing components before normalizing missing suffixes, without writes. */
export function resolveRoot(requested, label, userHome) {
  if (!requested || !isAbsolute(requested) || /\0|\r|\n/.test(requested)) throw new Error(`${label} must be an absolute path: ${requested}`);
  let current = parse(requested).root;
  for (const component of requested.slice(current.length).split(process.platform === "win32" ? /[\\/]/ : /\//).filter(Boolean)) {
    if (component === ".") continue;
    if (component === "..") { current = dirname(current); continue; }
    if (process.platform === "win32" && (/[<>:"|?*]|[. ]$/.test(component) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(component))) throw new Error(`ambiguous Windows destination: ${component}`);
    const next = join(current, component);
    const info = optionalStat(next);
    if (info) {
      const physical = realpathSync(next);
      if (!lstatSync(physical).isDirectory()) throw new Error(`${label} ancestor is not a directory: ${next}`);
      current = physical;
    } else current = next;
  }
  const home = optionalStat(userHome) ? realpathSync(userHome) : resolve(userHome);
  const equal = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (equal(current, parse(current).root) || equal(current, home)) throw new Error(`refusing unsafe resolved ${label}: ${requested}`);
  return current;
}

// Fixed PowerShell source, data passed separately. Adapted from dyne/gestalt
// cb7dbf1b (MIT); a new directory receives its ACL during creation.
const privateDirectoryScript = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:GESTALT_SETUP_PATH))
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if (-not [IO.Directory]::Exists($path)) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    (New-Object IO.DirectoryInfo($path)).Create($acl)
  }
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point refused' }
  $acl = $item.GetAccessControl()
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Storage owner differs from current user' }
  $full = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow') {
      if ($rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18')) { throw 'ACL permits another principal' }
      if ($rule.IdentityReference.Value -eq $sid.Value -and (($rule.FileSystemRights -band 2032127) -eq 2032127)) { $full = $true }
    }
  }
  if (-not $full) { throw 'Current user lacks private full control' }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export function ensureManagedRoot(path) {
  const info = optionalStat(path);
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`not a real managed directory: ${path}`);
  if (!optionalStat(dirname(path))) ensureManagedRoot(dirname(path));
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows SystemRoot is unavailable");
    execFileSync(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(privateDirectoryScript, "utf16le").toString("base64"),
    ], { env: { ...process.env, GESTALT_SETUP_PATH: Buffer.from(path).toString("base64") }, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  } else {
    if (!info) mkdirSync(path, { mode: 0o700 });
    const actual = lstatSync(path);
    if (actual.uid !== process.getuid() || (actual.mode & 0o022)) throw new Error(`managed directory is writable by another user: ${path}`);
  }
}

function checkedPath(root, relative) {
  let path = root;
  for (const component of relative.split("/")) {
    path = join(path, component);
    const info = optionalStat(path);
    if (info?.isSymbolicLink() || (info?.isFile() && info.nlink !== 1)) throw new Error(`redirected setup destination: ${path}`);
  }
  return path;
}

/** Keep an owned snapshot on failure to restore; never delete unknown leftovers. */
export function beginSetupSnapshot(root, paths) {
  const stage = join(root, `.gestalt-setup-state-${randomUUID()}`);
  mkdirSync(stage, { mode: 0o700 });
  const records = [];
  let finished = false;
  try {
    for (const [index, relative] of paths.entries()) {
      const path = checkedPath(root, relative);
      const present = optionalStat(path) !== null;
      if (present) cpSync(path, join(stage, String(index)), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      records.push({ relative, present, index });
    }
    writeFileSync(join(stage, "owner.json"), JSON.stringify({ schemaVersion: 1, pid: process.pid, root, records }), { mode: 0o600, flag: "wx" });
  } catch (error) { rmSync(stage, { recursive: true, force: true }); throw error; }
  return {
    commit() { if (!finished) { rmSync(stage, { recursive: true }); finished = true; } },
    rollback() {
      if (finished) return;
      try {
        for (const { relative, present, index } of records) {
          const path = checkedPath(root, relative);
          rmSync(path, { recursive: true, force: true });
          if (present) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); cpSync(join(stage, String(index)), path, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true }); }
        }
        rmSync(stage, { recursive: true }); finished = true;
      } catch (error) { throw new Error(`setup rollback incomplete; snapshot retained at ${stage}`, { cause: error }); }
    },
  };
}
