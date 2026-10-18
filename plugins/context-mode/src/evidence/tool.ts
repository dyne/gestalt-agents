import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureGitHub, githubSelectorSchema } from "./github.js";
import { evidenceFollowup, ingestEvidence, ingestGitHubCapture, type IngestOptions } from "./extract.js";

export const EVIDENCE_DESCRIPTION = "Capture GitHub test evidence through authenticated gh, or ingest authorized local logs. Returns findings and durable references within 2048 bytes; unknown formats stay uncertain. Use followup with the returned report ID for bounded details.";
const sha = z.string().regex(/^[a-fA-F0-9]{40}$/);
const file = z.object({
  path: z.string().min(1).max(4096), command: z.string().max(512).optional(),
  cwd: z.string().max(4096).optional(), exit: z.number().int().min(-255).max(255).optional(),
  completeness: z.enum(["complete", "partial", "unknown"]).optional(),
}).strict();
const evidenceShape = {
  operation: z.enum(["github", "local", "followup"]),
  github: githubSelectorSchema.optional(),
  files: z.array(file).min(1).max(100).optional(),
  report: z.string().regex(/^report-[A-Za-z0-9]+$/).max(100).optional(),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  maxBytes: z.number().int().min(512).max(2048).optional(),
  milestone: z.string().max(120).optional(),
  candidate: z.object({ sha: sha.optional(), branch: z.string().max(200).optional(), base: sha.optional(), dirtySha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().optional(),
};
export const evidenceRequestSchema = z.object(evidenceShape).strict().superRefine((r, ctx) => {
  const invalid = r.operation === "github"
    ? !r.github || r.files !== undefined || r.report !== undefined || r.offset !== undefined || r.maxBytes !== undefined
    : r.operation === "local"
      ? !r.files || r.github !== undefined || r.report !== undefined || r.offset !== undefined || r.maxBytes !== undefined
      : !r.report || r.github !== undefined || r.files !== undefined || r.milestone !== undefined || r.candidate !== undefined;
  if (invalid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select exactly one evidence operation and its input" });
});

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export interface EvidenceRuntime {
  storageRoot(): string;
  projectDir(): string;
  resolvePath(path: string): string;
  authorizeRead(path: string): boolean;
  authorizeGh(args: readonly string[]): boolean;
  index: IngestOptions["index"];
  respond(result: ToolResult): ToolResult;
}
const error = (reason: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ version: 1, completeness: "unknown", decision: "needs-evidence", reason }) }], isError: true });

export function registerTestEvidence(server: McpServer, runtime: EvidenceRuntime): void {
  server.registerTool("ctx_test_evidence", {
    title: "Capture GitHub or local test evidence",
    description: EVIDENCE_DESCRIPTION,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    // SDK validation normally serializes every Zod issue, including hostile keys.
    // Keep an object root for SDK discovery. Field catches and passthrough defer
    // rejection to the strict handler without serializing hostile keys/issues.
    // The shared shape still advertises each valid field's actual type/bounds.
    // Missing optional fields already parse successfully as undefined. Invalid
    // present fields become null, which no field accepts, so strict validation
    // cannot silently erase a supplied identity, limit or extraneous input.
    inputSchema: z.object(Object.fromEntries(Object.entries(evidenceShape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).catch(null)]))).passthrough(),
  }, async (input, extra) => {
    const parsed = evidenceRequestSchema.safeParse(input);
    if (!parsed.success) return error("invalid evidence request");
    const r = parsed.data;
    try {
      const storageRoot = runtime.storageRoot();
      if (r.operation === "followup") {
        const text = evidenceFollowup(storageRoot, r.report!, r.offset, r.maxBytes);
        return runtime.respond({ content: [{ type: "text", text }] });
      }
      const common = { storageRoot, authorizeRead: runtime.authorizeRead, index: runtime.index, milestone: r.milestone, candidate: r.candidate };
      let text: string;
      let failed = false;
      if (r.operation === "github") {
        const capture = await captureGitHub(r.github, { storageRoot, cwd: runtime.projectDir(), signal: extra?.signal, authorizeCommand: runtime.authorizeGh });
        if (!capture.manifest) return error(capture.reason ?? "GitHub capture unavailable");
        text = ingestGitHubCapture(capture, common).routine;
        failed = capture.completeness !== "complete";
      } else {
        text = ingestEvidence(r.files!.map(f => ({ ...f, path: runtime.resolvePath(f.path) })), {
          ...common, source: { kind: "local", repository: runtime.projectDir(), run: null, attempt: null, job: null, reason: "local evidence; remote run identity inapplicable" },
        }).routine;
      }
      if (Buffer.byteLength(text) > 2048) return error("evidence response exceeded budget; retrieve private manifest");
      return runtime.respond({ content: [{ type: "text", text }], ...(failed ? { isError: true } : {}) });
    } catch {
      return error("evidence unavailable: storage, authorization or report scope failure");
    }
  });
}
