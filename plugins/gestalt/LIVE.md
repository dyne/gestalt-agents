# Live packaged tools (contract 1)

This is a private controller integration, not a model-accessible host execution
API. Normal plugin manifests, context-mode startup and Org workflows are
unchanged. Live requires a separate prepared configuration. Every response has
`liveReady:false`; admission alone does not establish native confinement or
production readiness.

`scripts/live-admission.mjs stage|prepare|verify --bootstrap ABS` accepts only a
private bootstrap file in the accepted manager's protected policy directory.
No inline commands, environment, credentials, policy overrides or model paths
are accepted. Errors contain a fixed reason, never raw exception/config text.

The owning controller must resolve **all** effective launch surfaces before
writing bootstrap. Do not synthesize an empty inventory while ignoring an
owning-session plugin, configuration layer or hook. The exact bootstrap is:

```json
{
  "schemaVersion": 1,
  "manifestPath": "/private/live/manifest.json",
  "workspaceRoot": "/project",
  "packages": [
    {"name":"context-mode","root":"/protected/context-mode","sha256":"TRUSTED_TREE_SHA256"},
    {"name":"gestalt","root":"/protected/gestalt","sha256":"TRUSTED_TREE_SHA256"}
  ],
  "runtime": {"root":"/protected/prepared/context-mode","sha256":"TRUSTED_TREE_SHA256"},
  "node": {"path":"/protected/node-bin/node","sha256":"TRUSTED_BINARY_SHA256"},
  "effectiveConfig": {
    "plugins": [
      {"name":"context-mode","root":"/protected/context-mode"},
      {"name":"gestalt","root":"/protected/gestalt"}
    ],
    "mcpServers": [
      {"name":"context-mode","command":"node","args":["./start.mjs"],"cwd":"/protected/context-mode","env":{"CONTEXT_MODE_PLATFORM":"codex"},"default_tools_approval_mode":"approve"},
      {"name":"gestalt-org-plan","command":"node","args":["./org-plan-mcp.mjs"],"cwd":"/protected/gestalt","env_vars":["GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY","GESTALT_MOBILE_ORG_PLAN_STATUS_FILE"],"default_tools_approval_mode":"approve"}
    ],
    "hooks": [], "remoteMcp": [], "executables": []
  },
  "plans": ["/project/.gestalt/assigned.org"]
}
```

Tree pins come from trusted installation/release preparation after the package
provenance and prepared-runtime checks, never from a project request that asks
to trust its own measured content. `measureTree` binds every regular installed
file's relative name, mode and contents. It rejects symlinks, writable files or
directories, special files and excessive inventories. Production installation
must provide canonical roots protected from the original writable policy;
owner-only file modes alone are not a same-UID sandbox boundary.

There are exactly two admitted MCP aliases. Additional plugins/aliases, command
or argument substitution, remote MCP, hooks and ambient executable surfaces are
explicitly unavailable. Project `.codex` in any app ancestor is unavailable;
the manager also rejects system configuration. The prepared configuration lists
the unavailable workflows instead of modifying user plugins or hiding them.
The controller must surface incompatibility before Live model/tool work.

The manager manifest must have exactly one fixed native command:

```json
{"context-mode-call": {
  "executable":"/protected/node-bin/node", "sha256":"TRUSTED_BINARY_SHA256",
  "args":["/protected/gestalt/live-context-worker.mjs","--runtime","/protected/prepared/context-mode","--workspace","/project"],
  "timeoutMs":120000
}}
```

Preparation order is bounded:

1. Trusted controller writes the bootstrap and manager manifest. `stage`
   validates package identity, launch inventories and original permissions,
   then atomically writes `live-mcp-config.json` next to the manifest. Active
   manager dispatch prevents staging.
2. Controller inventories **both** bootstrap and prepared config in manager
   `configFiles`, in addition to the manager's isolated
   `runtimeHome/config.toml` and owning configuration inventory. Include the
   actual bytes/configuration that the owning runtime consumes; this JSON must
   not be treated as a substitute for resolving the owning runtime config.
3. Controller runs accepted `gestalt live-policy prepare --manifest ABS`.
4. `prepare` authenticates that receipt, verifies the accepted manager afresh,
   recomputes all installed/configured inputs, and signs
   `admission-receipt.json` with the private manager key. `verify` repeats these
   checks before admitting work.

Receipt HMAC uses recursively sorted JSON. It binds bootstrap, full manager
policy receipt, native command table, configuration, component pins, package
and runtime inventories, interpreter and the exact lifecycle plan allowlist.
Missing/forged receipts, changed configuration, packages, checksum, policy,
controller identity or components invalidate it. The private receipt/key and
bootstrap must never be forwarded to the confined interpreter. L11 must combine
admission with owning-session authority and actual process receipts; a valid
policy or admission receipt cannot adopt a PID or existing MCP connection.

Org lifecycle authority is only the signed exact plan allowlist and the typed
Org protocol. It grants no arbitrary command, path, environment, credentials or
status destination. Native context work uses the manager's fixed command ID and
per-call ownership. Persistent native workers and credential-dependent tools
are unavailable. Actual execution and host proof are separately required.

The admission regression suite uses private disposable fixtures and a fixed
stand-in manager. Inside the development native sandbox it isolates only the
empty read-only `/tmp/.codex` mask in the test filesystem observation. Neither
the production ancestry check nor manager verification is relaxed. These
offline tests establish admission/refusal behavior, not native enforcement.

`workspaceRoot` is the canonical owning-session workspace, which must contain
`appRoot`. The signed Org allowlist permits only immediate
`workspaceRoot/.gestalt/*.org` files. It supports a workspace plan while Live
edits an app in a nested repository; it grants no general workspace filesystem
access to the host shim.

Live installation uses `scripts/prepare-live-runtime.mjs --source ABS --target
ABS` on a trusted, provenance-checked context-mode distribution. It builds and
verifies in an isolated stage, removes npm `.bin` aliases (never in the Live
PATH), rejects other symlinks, normalizes package modes, and atomically publishes
a complete measured runtime. Failed preparation or post-publication validation
restores the prior runtime. Normal installation is unchanged. Runtime databases,
statistics and interpreter state live in `appRoot/.gestalt`, outside that
immutable inventory.

The prepared launch descriptors point to `live-mcp-proxy.mjs`, with fixed
bootstrap and server arguments. The controller MUST use a reconstructed
environment containing only `PATH=/usr/bin:/bin`, its isolated `HOME` and
`LANG=C.UTF-8`. Ambient loader, shell, credential and publication variables are
unsupported. The proxy authenticates admission before startup and each request.
An owning-runtime adapter must consume these exact descriptors and inventory its
actual generated configuration; project descriptors are never merged into them.

The accepted manager's host shell dispatch resolves `node` through PATH. The
bridge constructs that **host-only** PATH from the verified interpreter's
directory followed by `/usr/bin:/bin`; it never inherits a project/ambient PATH.
The admitted executable must be named `node`. Outside canonical `/usr/bin`, its
protected canonical directory must contain only that pinned file, preventing
extra host utility aliases; directory changes revoke execution. Trusted
installation copies a pinned Node binary into such a directory when Node is
installed in a tool cache. The manager's native launch environment remains
exactly L9's fixed PATH. Inside confinement the worker discovers that same
admitted interpreter through `process.execPath`, without adding filesystem or
network grants.

Context requests dispatch only manager command `context-mode-call`, with a new
UUID and process lifetime for every transaction. The native worker loads the
actual installed server bundle in embedded mode and uses its SDK schemas and
handlers. Only execute, execute-file, batch-execute, index, search, stats and
purge are admitted. Network fetch, doctor, upgrade and Insight are explicitly
unavailable for Live; normal MCP retains its complete tool set. Background
execution is refused. Interpreter descendants use POSIX pipe bridges inside the
native sandbox so native denied `getsockname` cannot break Node child stdio.
No bridge alters permissions or launches work outside native confinement.

The manager monitors controller/native/policy identity. During a transaction the
proxy separately monitors package/runtime bytes and admission/configuration
changes. It cancels only its owned manager caller; L9 owns descendant cleanup.
Manager verification is deliberately performed before launch, since native
temporarily materializes app metadata during its lifetime. A response is
returned only after an authenticated manager `exited` receipt and fresh package
inputs; unconfirmed cleanup fails closed. Changed/narrowed authority requires
Stop, reaping, new manager/admission preparation and fresh dispatch. No prior
native process is reused by a long-lived proxy.

Org requests remain on the trusted host solely to preserve the canonical typed
lifecycle API. The bridge validates the tool's existing strict schema and exact
signed plan. It opens the owning workspace and `.gestalt` through pinned Linux
directory descriptors and opens only the plan basename with `O_NOFOLLOW`.
Symlink/hardlink escapes and oversized plans fail closed. It copies content into
an owner-only temporary snapshot, invokes the canonical state machine there,
then compares original inode/bytes and publishes only to the pinned plan slot.
The private snapshot path is removed from responses. No model-controlled path,
command, environment, credentials or publication target crosses this interface.
Status publication is unconfigured in contract 1; the owning controller can
publish its existing lifecycle status separately.

`scripts/live-packaged-native-proof.mjs` and the isolated
`live-packaged-proof.yml` hosted workflow exercise installed runtime bytes,
native interpreter and detached descendants, private files/Caddy/controller/
daemon/proc/FD denial, typed Org authority, missing/forged admission, narrowing,
restart, cleanup and installed-byte invalidation. It uses pinned native 0.161
and the accepted manager bytes, preserves bundled bubblewrap, and never repairs
the native masked daemon directory. Its report binds the exact Agents Git tree,
installed package/runtime hashes, binary/resource hashes and process receipts.
This proof still does not establish production picker or owning-session model
integration; those remain L11 requirements.
