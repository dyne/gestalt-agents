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
import { closeSync, constants, cpSync, lstatSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export function optionalStat(path) {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Resolve existing components before normalizing missing suffixes, without writes. */
export function resolveRoot(requested, label, userHome, { allowControlCharacters = false } = {}) {
  if (!requested || !isAbsolute(requested) || (allowControlCharacters ? /\0/ : /\0|\r|\n/).test(requested)) throw new Error(`${label} must be an absolute path: ${requested}`);
  if (process.platform === "win32" && ["\\\\?\\", "\\\\.\\", "\\??\\"].some((prefix) => requested.startsWith(prefix))) throw new Error(`device namespace is not a managed destination: ${label}`);
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
  $trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $adminMembers = $null
  function Is-TrustedNamespacePrincipal([string]$identity) {
    if ($identity -in $trusted) { return $true }
    if ($identity -notmatch '^S-1-(5-21|12-1)-') { return $false }
    if ($null -eq $script:adminMembers) {
      $script:adminMembers = @(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | Where-Object { $_.ObjectClass -eq 'User' } | ForEach-Object { $_.SID.Value })
    }
    return $identity -in $script:adminMembers
  }
  $mutating = [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor [Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes
  $ancestor = (New-Object IO.DirectoryInfo($path)).Parent
  while ($null -ne $ancestor) {
    $item = Get-Item -LiteralPath $ancestor.FullName -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Redirected namespace parent' }
    $acl = $item.GetAccessControl()
    $raw = New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $raw.DiscretionaryAcl) { throw 'Unrestricted namespace parent ACL' }
    if (-not (Is-TrustedNamespacePrincipal $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value)) { throw 'Untrusted namespace parent owner' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
      if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $mutating) -ne 0 -and -not (Is-TrustedNamespacePrincipal $rule.IdentityReference.Value)) { throw 'Untrusted namespace parent can redirect managed storage' }
    }
    $ancestor = $ancestor.Parent
  }
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
      if ($rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18') -and ($env:GESTALT_STORAGE_PRIVATE -eq '1' -or ($rule.FileSystemRights -band $mutating) -ne 0)) { throw 'ACL permits another principal' }
      if ($rule.IdentityReference.Value -eq $sid.Value -and (($rule.FileSystemRights -band 2032127) -eq 2032127)) { $full = $true }
    }
  }
  if (-not $full) { throw 'Current user lacks private full control' }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

function assertMacAcl(path, privateRoot = false) {
  if (process.platform !== "darwin") return;
  // -b escapes filename newlines before the ACL rows are parsed. Explicit
  // profile destinations retain their historical control-character support.
  const listing = execFileSync("/bin/ls", ["-ldeb", path], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
  const trusted = new Set([`user:${userInfo().username}`, `user:${process.getuid()}`, "user:root", "user:0"]);
  for (const line of listing.split("\n").slice(1).filter((value) => value.trim())) {
    const match = /^\s*\d+:\s+(.+?)\s+(allow|deny)\s+(.+)$/.exec(line);
    if (!match) throw new Error(`cannot inspect managed directory ACL: ${path}`);
    if (match[2] === "allow" && !trusted.has(match[1]) && (privateRoot || /(?:^|,)(?:write|add_file|add_subdirectory|delete|delete_child|chown|writeattr|writeextattr|writesecurity)(?:,|$)/.test(match[3]))) throw new Error(`managed directory ACL permits another user: ${path}`);
  }
}

export function ensureManagedRoot(path, { privateMode = true, create = true } = {}) {
  const info = optionalStat(path);
  if (!info && !create) throw new Error(`managed directory does not exist: ${path}`);
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`not a real managed directory: ${path}`);
  const forbiddenMode = privateMode ? 0o077 : 0o022;
  if (process.platform !== "win32" && info && (info.uid !== process.getuid() || (info.mode & forbiddenMode))) throw new Error(`managed directory must be ${privateMode ? 'private to' : 'writable only by'} its owner: ${path}`);
  if (!optionalStat(dirname(path))) ensureManagedRoot(dirname(path));
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows SystemRoot is unavailable");
    try {
      execFileSync(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(privateDirectoryScript, "utf16le").toString("base64"),
      ], { env: { ...process.env, GESTALT_SETUP_PATH: Buffer.from(path).toString("base64"), GESTALT_STORAGE_PRIVATE: privateMode ? "1" : "0" }, shell: false, windowsHide: true, timeout: 10_000, stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      throw new Error(`Windows managed storage refused: ${String(error.stderr ?? error.code ?? "permission inspection failed").trim().slice(0, 1000)}`, { cause: error });
    }
  } else {
    for (let ancestor = dirname(path); ; ancestor = dirname(ancestor)) {
      const parent = lstatSync(ancestor);
      if (!parent.isDirectory() || parent.isSymbolicLink() || ![0, process.getuid()].includes(parent.uid) || ((parent.mode & 0o022) && !(parent.uid === 0 && (parent.mode & 0o1000)))) throw new Error(`untrusted managed directory ancestor: ${ancestor}`);
      assertMacAcl(ancestor);
      if (ancestor === dirname(ancestor)) break;
    }
    if (!info) mkdirSync(path, { mode: 0o700 });
    const actual = lstatSync(path);
    if (actual.uid !== process.getuid() || (actual.mode & forbiddenMode)) throw new Error(`managed directory must be ${privateMode ? 'private to' : 'writable only by'} its owner: ${path}`);
    assertMacAcl(path, privateMode);
  }
}

/** Exclusive empty creation with private ACL before any payload is written. */
export function writePrivateFile(path, contents, mode = 0o600) {
  let created = false;
  try {
    if (process.platform === "win32") {
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows SystemRoot is unavailable");
      const script = String.raw`$ErrorActionPreference='Stop'
try {
 $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:GESTALT_STORAGE_FILE))
 $s=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $a=New-Object Security.AccessControl.FileSecurity
 $a.SetOwner($s);$a.SetAccessRuleProtection($true,$false)
 $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($s,'FullControl','Allow')))
 $f=New-Object IO.FileStream($p,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$a)
 $f.Dispose()
} catch {[Console]::Error.WriteLine($_.Exception.Message);exit 1}`;
      execFileSync(join(systemRoot,"System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{env:{...process.env,GESTALT_STORAGE_FILE:Buffer.from(path).toString("base64")},shell:false,windowsHide:true,timeout:10_000,stdio:["ignore","ignore","pipe"]});
      created = true;
      writeFileSync(path, contents, { flag: "r+" });
    } else {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
      created = true;
      try {
        if (process.platform === "darwin") execFileSync("/bin/chmod", ["-N", path], { stdio: "ignore", timeout: 5000 });
        writeFileSync(fd, contents);
      } finally { closeSync(fd); }
    }
  } catch (error) {
    if (created) rmSync(path, { force: true });
    throw error;
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
