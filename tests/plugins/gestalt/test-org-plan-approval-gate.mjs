import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessOrgPlanStartup } from "../../../plugins/gestalt/scripts/org-plan-preflight.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const temporary = realpathSync(
  mkdtempSync(join(tmpdir(), "org-plan-approval-gate-")),
);
try {
  for (const mode of ["baseline", "approve", "tool-override"]) {
    const home = join(temporary, mode);
    const workspace = join(home, "workspace");
    const statusDirectory = join(workspace, "status");
    mkdirSync(statusDirectory, { recursive: true, mode: 0o700 });
    const plan = join(workspace, "fixture.org");
    copyFileSync(
      join(root, "tests/plugins/gestalt/fixtures/valid-minimal.org"),
      plan,
    );
    const original = readFileSync(plan, "utf8");
    const environment = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: home,
      GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY: statusDirectory,
    };
    for (const args of [
      ["plugin", "marketplace", "add", root],
      ["plugin", "add", "gestalt@dyne-gestalt-agents"],
    ]) {
      await new Promise((resolve, reject) => {
        const installer = spawn("codex", args, {
          cwd: workspace,
          env: environment,
          stdio: "ignore",
        });
        const timer = setTimeout(() => {
          installer.kill();
          reject(new Error("fixture plugin installation timed out"));
        }, 15000);
        installer.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        installer.on("exit", (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(new Error("fixture plugin installation failed"));
        });
      });
    }
    const version = JSON.parse(
      readFileSync(
        join(root, "plugins/gestalt/.codex-plugin/plugin.json"),
        "utf8",
      ),
    ).version;
    const manifestPath = join(
      home,
      "plugins/cache/dyne-gestalt-agents/gestalt",
      version,
      ".mcp.json",
    );
    if (mode === "baseline") {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      delete manifest.mcpServers["gestalt-org-plan"]
        .default_tools_approval_mode;
      writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    let requests = 0;
    const model = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      requests += 1;
      const namespace = input.tools?.find(
        (tool) =>
          tool.type === "namespace" && tool.name === "mcp__gestalt_org_plan",
      );
      const name = namespace
        ? "org_plan_signal"
        : input.tools?.find((tool) => tool.name?.endsWith("__org_plan_signal"))
            ?.name;
      if (requests === 1 && !name) {
        response.writeHead(400);
        response.end("fixture MCP tool missing");
        return;
      }
      const item =
        requests === 1
          ? {
              id: "fc_1",
              type: "function_call",
              status: "completed",
              name,
              ...(namespace ? { namespace: namespace.name } : {}),
              call_id: "call_1",
              arguments: JSON.stringify({ plan, reason: "supervision-start" }),
            }
          : {
              id: "msg_1",
              type: "message",
              status: "completed",
              role: "assistant",
              content: [
                { type: "output_text", text: "Done.", annotations: [] },
              ],
            };
      const result = {
        id: `resp_${requests}`,
        object: "response",
        created_at: 1,
        status: "completed",
        model: "fixture",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of [
        {
          type: "response.created",
          response: { ...result, status: "in_progress", output: [] },
        },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ])
        response.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      response.end();
    });
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    const port = model.address().port;
    writeFileSync(
      join(home, "config.toml"),
      `model_provider = "fixture"\nmodel = "fixture"\n[model_providers.fixture]\nname = "Local approval fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\n[features]\ntool_search = false\n[plugins."gestalt@dyne-gestalt-agents"]\nenabled = true\n${mode === "tool-override" ? '[plugins."gestalt@dyne-gestalt-agents".mcp_servers.gestalt-org-plan.tools.org_plan_signal]\napproval_mode = "prompt"\n' : ""}`,
    );
    const child = spawn("codex", ["app-server", "--stdio"], {
      cwd: workspace,
      env: environment,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const pending = new Map();
    let nextId = 0;
    let finish;
    let rejectTurn;
    const completion = new Promise((resolve, reject) => {
      finish = resolve;
      rejectTurn = reject;
    });
    // RPC startup can fail before the turn is awaited.
    completion.catch(() => {});
    const calls = [];
    const fail = (error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      rejectTurn(error);
    };
    const timer = setTimeout(
      () => fail(new Error(`${mode}: approval gate test timed out`)),
      30000,
    );
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("exit", () =>
      fail(new Error(`${mode}: Codex exited before completion`)),
    );
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        message.error
          ? waiter.reject(new Error("fixture RPC failed"))
          : waiter.resolve(message.result);
      }
      if (
        message.method === "item/completed" &&
        message.params?.item?.type === "mcpToolCall"
      )
        calls.push(message.params.item);
      if (message.method === "turn/completed") {
        if (message.params.turn.error) console.error(message.params.turn.error);
        finish(message.params.turn.status);
      }
      if (message.method?.endsWith("requestApproval"))
        fail(new Error("never-policy fixture unexpectedly requested approval"));
    });
    const rpc = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    try {
      await rpc("initialize", {
        clientInfo: { name: "org-plan-approval-gate-test", version: "1" },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(
        `${JSON.stringify({ method: "initialized", params: {} })}\n`,
      );
      const configured = await rpc("config/read", { includeLayers: false });
      const report = assessOrgPlanStartup({
        config: configured.config,
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
        approvalPolicy: "never",
        environment,
      });
      assert.equal(
        report.ready,
        mode === "approve",
        `${mode}: preflight must match the model's gate`,
      );
      const started = await rpc("thread/start", {
        cwd: workspace,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        ephemeral: true,
      });
      await rpc("mcpServerStatus/list", {
        threadId: started.thread.id,
        detail: "toolsAndAuthOnly",
      });
      await rpc("turn/start", {
        threadId: started.thread.id,
        input: [
          {
            type: "text",
            text: "Execute the fixture MCP signal, then finish.",
          },
        ],
      });
      assert.equal(await completion, "completed");
      assert.equal(
        requests,
        2,
        `${mode}: expected one tool request and one final response`,
      );
      assert.equal(
        calls.length,
        1,
        `${mode}: expected exactly one model-triggered MCP call`,
      );
      assert.equal(calls[0].tool, "org_plan_signal");
      if (mode === "approve") {
        assert.equal(calls[0].status, "completed");
        const files = readdirSync(statusDirectory).filter((name) =>
          name.endsWith(".plan-status.json"),
        );
        assert.equal(files.length, 1);
        const signal = JSON.parse(
          readFileSync(join(statusDirectory, files[0]), "utf8"),
        );
        assert.equal(signal.planPath, plan);
        assert.equal(signal.reason, "supervision-start");
      } else {
        assert.equal(calls[0].status, "failed");
        assert.match(
          calls[0].error?.message ?? "",
          /requires approval, but approval policy is never/,
        );
        assert.equal(readdirSync(statusDirectory).length, 0);
      }
      assert.equal(readFileSync(plan, "utf8"), original);
      console.log(`${mode}: model-triggered Org-plan approval gate passed`);
    } finally {
      clearTimeout(timer);
      lines.close();
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve));
      child.stdin.end();
      child.kill();
      await exited;
      model.closeAllConnections();
      await new Promise((resolve) => model.close(resolve));
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
