# Setup API v1

Import `setupAgents`, `SETUP_API_VERSION` and `SETUP_API_CAPABILITIES` from
`gestalt-setup.mjs`. Importing it performs no setup and installs no signal
handlers. Node 24+ is required. The standalone CLI owns its signal handlers.

```js
const result = await setupAgents(["--prepare-only"], {
  mode: "managed",
  commands: { apiVersion: 1, launch: ownedProcesses.launch.bind(ownedProcesses) },
  environment: { ...environment, GESTALT_HOME, CODEX_HOME },
  cwd: absoluteWorkspace,
  signal: controller.signal,
  streams: { stdin: inputBytes, stdout: writeOutput, stderr: writeError },
});
```

Each environment is copied; setup never temporarily changes `process.env`.
Keep `GESTALT_SESSION_TMP_CONTEXT`, `TMPDIR`, `TMP` and `TEMP` together exactly
as supplied by the owning session. Present invalid scratch context fails before
mutations. Homes must be absolute, separate private directories with trusted
host ancestors. Profile configuration and runtime filesystem transactions run
in the caller's host namespace, where the real ancestor owners remain visible.

`launch(executable, invocation, streams, limits)` asynchronously returns a lease:

- `executable` is absolute. `invocation` contains literal `argv` tokens, absolute
  `cwd`, and a copied `environment`. No shell command string is provided.
- `streams.stdin` is an async iterable of byte arrays; `stdout(bytes)` and
  `stderr(bytes)` are awaited callbacks. Honor their backpressure and failures.
- `limits` contains `graceMs` and `deadlineMs` for bounded owned cleanup.
- A lease has a nonempty `id`, `result` and `completed` promises, and an
  idempotent asynchronous `stop()`. A command result is `{kind:"exit",code}`,
  `{kind:"signal",signal}` or `{kind:"spawn-error",message}`. It does not prove
  that descendants have stopped.
- `completed` and `stop()` return a claim with the same `lease` id. A managed
  release is `{kind:"released",lease,backend,result}` from the injected native
  ownership capability. An unknown claim includes `kind:"unknown"` and `reason`.
  Stream closure, parent exit and a persisted PID are insufficient evidence.

Setup awaits stop/completion before compensation. Cancellation aborts active
leases and preserves the signal status. Launch must return an owned handle
promptly even if the target fails to start; an aborted or timed-out launch is
unknown, and a late handle is stopped without erasing that unknown decision.
Malformed capabilities and leases fail explicitly. Managed mode has no default
adapter or unconfined CLI fallback. A caller must trust its injected capability;
this API cannot attest another implementation's native ownership proof.

The default `mode:"standalone"` uses Node direct-child execution for CLI
compatibility. Its result explicitly says `ownership.kind:"standalone"` and
`completeTree:false`; it makes no complete-tree claim. An injected capability
requires explicit managed mode. Unknown interruption retains state in either
mode. Managed Linux/Windows success requires release proof. On macOS a command
can succeed while descendant lifetime remains unknown: the successful setup
result and retained cleanup authority are reported separately.

Before each command, setup fences every held transaction lock with an exclusive
private marker. Unknown lifetime is sticky: no rollback, snapshot/stage deletion
or lock release is authorized, including after the orchestration PID dies.
Inspect retained paths and the exact lock records before manual recovery. A
second installer cannot treat owner death or elapsed time as command absence.
This retention deliberately can prevent an automatic macOS repeat or update.

The same context covers npm/Bun probes and installation, explicit allowlisted
dependency installers, native-addon load verification, TypeScript/esbuild and
bundle checks, Org syntax/help validation, optional skills, and both Codex
catalog/RPC sessions. Runtime/configuration/Org/managed-command/profile owners
are called as libraries. The fixed host filesystem exception is limited to
absolute system PowerShell ACL scripts (`NoProfile`, encoded fixed source,
base64 path data) and macOS `/bin/ls` ACL inspection and `/bin/chmod -N`, with
bounded timeouts. These helpers neither select tools from profile PATH nor run
package/build code. They do not broaden ancestor trust or mapped UID handling.

Configured marketplace continuation imports only its fixed
`scripts/setup-agents.mjs` owner and requires API version 1 plus all advertised
capabilities, including shared-context-v1. Missing/incompatible APIs fail with
an update instruction; the old whole-CLI subprocess path is not used. The
shared context is internal to these fixed owners and is never serialized.

The hosted integration fixture builds the pinned MIT Manager L2 ownership
helper solely for tests. Product Agents has no Manager package, compiler,
service, privileged UID-map or helper-download dependency.
