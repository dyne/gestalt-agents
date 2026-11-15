/** TEST ONLY: instrument the pinned Windows helper without changing decisions. */
import assert from "node:assert/strict";
const preamble = `
/* Agents TEST-ONLY diagnostics. Original ownership/proof decisions unchanged. */
static DWORD ga_diag_wait = 0xffffffff, ga_diag_wait_error = 0;
static DWORD ga_diag_multi = 0xffffffff, ga_diag_multi_error = 0;
static BOOL ga_diag_exit_ok = FALSE;
static DWORD ga_diag_exit_code = STILL_ACTIVE, ga_diag_exit_error = 0;
static DWORD ga_diag_WaitForSingleObject(HANDLE handle, DWORD milliseconds) {
  DWORD value = WaitForSingleObject(handle, milliseconds), error = GetLastError();
  ga_diag_wait = value; ga_diag_wait_error = error; SetLastError(error); return value;
}
static DWORD ga_diag_WaitForMultipleObjects(DWORD count, const HANDLE *handles, BOOL all, DWORD milliseconds) {
  DWORD value = WaitForMultipleObjects(count, handles, all, milliseconds), error = GetLastError();
  ga_diag_multi = value; ga_diag_multi_error = error; SetLastError(error); return value;
}
static BOOL ga_diag_GetExitCodeProcess(HANDLE handle, LPDWORD code) {
  BOOL value = GetExitCodeProcess(handle, code); DWORD error = GetLastError();
  ga_diag_exit_ok = value; if (value) ga_diag_exit_code = *code;
  ga_diag_exit_error = error; SetLastError(error); return value;
}
static int ga_diag_failure(unsigned int original_line) {
  DWORD error = GetLastError(); int saved_errno = errno;
  fprintf(stderr, "AGENTS_TEST_DIAGNOSTIC original-line=%u last-error=%lu wait-result=%lu wait-error=%lu multi-result=%lu multi-error=%lu exit-ok=%d exit-code=%lu exit-error=%lu output-failed=%ld\\n",
      original_line, (unsigned long)error, (unsigned long)ga_diag_wait, (unsigned long)ga_diag_wait_error,
      (unsigned long)ga_diag_multi, (unsigned long)ga_diag_multi_error, (int)ga_diag_exit_ok,
      (unsigned long)ga_diag_exit_code, (unsigned long)ga_diag_exit_error, (long)output_failed);
  errno = saved_errno; SetLastError(error); return 2;
}
`;

export function instrumentWindowsOwnedHelper(original) {
  assert.equal(typeof original, "string");
  const start = original.indexOf("static int run_owned_windows(");
  const boundary = /\r?\n#endif\r?\n\r?\n#ifndef _WIN32/.exec(original.slice(start));
  const end = boundary ? start + boundary.index : -1;
  const main = original.indexOf("int wmain(", end);
  assert.ok(start > 0 && end > start && main > end, "pinned Windows helper boundaries changed");
  const rewrites = [], sites = [];
  let offset = 0, returns = 0, waits = 0, multiple = 0, exits = 0;
  const lines = original.split("\n").map((line, index) => {
    const at = offset; offset += line.length + 1;
    if (!((at >= start && at < end) || at >= main)) return line;
    const before = line;
    line = line.replace(/\bWaitForSingleObject\(/g, () => { waits++; return "ga_diag_WaitForSingleObject("; });
    line = line.replace(/\bWaitForMultipleObjects\(/g, () => { multiple++; return "ga_diag_WaitForMultipleObjects("; });
    line = line.replace(/\bGetExitCodeProcess\(/g, () => { exits++; return "ga_diag_GetExitCodeProcess("; });
    line = line.replace(/return 2;/g, () => { returns++; sites.push({ originalLine: index + 1, source: before }); return `return ga_diag_failure(${index + 1});`; });
    if (line !== before) rewrites.push({ originalLine: index + 1, before, after: line });
    return line;
  });
  assert.deepEqual({ returns, waits, multiple, exits }, { returns: 13, waits: 3, multiple: 1, exits: 2 }, "diagnostic sites differ from pinned helper");
  const modified = lines.join("\n");
  const source = modified.slice(0, start) + preamble + modified.slice(start);
  // Byte-exact reversibility guards the deliberately narrow transformation.
  let restored = source.replace(preamble, "");
  for (const { before, after } of [...rewrites].reverse()) restored = restored.replace(after, before);
  assert.equal(restored, original, "diagnostics changed more than the declared sites");
  return { source, rewrites, sites, counts: { returns, waits, multiple, exits } };
}
