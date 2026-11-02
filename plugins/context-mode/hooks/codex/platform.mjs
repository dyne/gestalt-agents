import { scratchEnvironment } from "../../scripts/session-scratch.mjs";
Object.assign(process.env, scratchEnvironment());
process.env.CONTEXT_MODE_PLATFORM = "codex";
