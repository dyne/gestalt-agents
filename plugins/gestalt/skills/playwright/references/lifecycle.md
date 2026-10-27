# Lifecycle and capability requests

The manager owns explicit package installation/update and the shared stdio
launcher. Chrome is installed and maintained externally. Operator commands
`gestalt playwright version --json` and `gestalt playwright doctor --json` expose
the read-only version-1 package and Chrome diagnostics separately; doctor with
`--cwd /absolute/workspace` also reports workspace readiness without creating
state. These checks do not establish a connected session. Startup, resume and
doctor never install or repair dependencies.

The host owns `gestalt playwright mcp --cwd /absolute/workspace` and its browser
descendants. This is a host entry point, never an agent-shell fallback. The
launcher uses stdio and a browser pipe, retains Chrome's sandbox, and does not
launch nested Codex or an HTTP MCP listener. Package presence is independent of
Chrome readiness, profile consent and tool connection.

## Supervisor requests

Use only a verified host capability interface actually exposed by the current
runtime. Discover its schema; request Playwright start, status or stop within
the calling root/session's retained workspace and plan. Never invent a tool
name or pass arbitrary commands, environment, executable paths or another
session's identity. An opted-in profile authorizes browser access; a start
request controls activation. Opt-in alone does not eagerly launch Chrome.
Explicit disabled/off settings prevail over requests and declarations.

An L1 may declare exactly one optional field:

```org
- Managed MCP :: playwright
```

The Org helper validates this requirement and exposes `managedMcp: ["playwright"]`
in L1 descriptions and in the projection while that L1 is WIP. Omission means
no automatic request. It grants neither consent nor permission to install.
Only a compatible trusted host may consume it; older consumers must not treat
an ignored or unsupported declaration as successful activation. Declarations
never resume Manual Off or attention-paused work.

The Agents package supplies guidance and the declaration contract, not runtime
attachment controls. CLI/Mobile integration must supply and verify those
controls. If unavailable, report unavailable; do not claim a queued request.
When the host acknowledges activation at a supported next-turn/resume boundary,
report pending until that boundary completes and the connection/tools are
verified. A start acknowledgement or installed package is not a readiness
signal. Status must distinguish pending, connected, unavailable and busy.
Stop releases only the calling host's owned processes and retains browser state.

## Recovery

| Observation | Next action |
|---|---|
| Disabled profile | Keep browser access off; a requirement does not override the choice. |
| Missing package/runtime or Chrome; incompatible Chrome | Report the specific diagnostic. Installation/update belongs to an explicit operator task, never startup repair. |
| Connected without expected tools | Keep guidance unavailable; report the incomplete connection. |
| Pending attachment | Continue independent work; verify tools after the supported boundary. |
| Workspace busy/locked | Release the owning session normally or wait for it; never kill another browser or delete live locks. |
| Suspected stale ownership | Let the manager recover only after owner and process group are proven gone; unknown ownership remains busy. |

State is private and keyed by the canonical workspace under Gestalt storage.
Workspace aliases share one lease; different workspaces have separate cookies.
Never expose state paths, credentials or page data in lifecycle status reports.
