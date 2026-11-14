#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_HOOK_EVENTS = [
  ["PreToolUse", "pretooluse", "local_shell|shell|shell_command|exec_command|Bash|Shell|apply_patch|Edit|Write|grep_files|ctx_execute|ctx_execute_file|ctx_batch_execute|ctx_fetch_and_index|ctx_search|ctx_index|mcp__"],
  ["PostToolUse", "posttooluse"],
  ["SessionStart", "sessionstart"],
  ["PreCompact", "precompact"],
  ["UserPromptSubmit", "userpromptsubmit"],
  ["Stop", "stop"],
];

function requireAbsolute(path, label) {
  if (!path || !isAbsolute(path)) throw new Error(`${label} must be an absolute path: ${path ?? ""}`);
  return resolve(path);
}

function requireVersionedPluginRoot(pluginRoot) {
  const expectedVersion = pluginRoot.split(/[\\/]/).at(-1);
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? "")) {
    throw new Error(`context-mode plugin root must end with a stable package version: ${pluginRoot}`);
  }
  let packageVersion;
  try {
    packageVersion = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")).version;
  } catch {
    throw new Error(`context-mode plugin root is missing a readable package.json: ${pluginRoot}`);
  }
  if (packageVersion !== expectedVersion) {
    throw new Error(`context-mode plugin root version mismatch: path=${expectedVersion} package=${packageVersion ?? "<missing>"}`);
  }
}

function tomlString(value) {
  return JSON.stringify(value);
}

function shellQuote(value) {
  if (/\0|\r|\n/.test(value)) throw new Error("hook launcher path contains an unsupported character");
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function tomlError() {
  throw new Error("Unsupported or ambiguous Codex TOML; configuration was not changed");
}

function keyPath(source) {
  const parts = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "") && index < source.length) index += 1;
    const start = index;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (quote === '"' && source[index] === "\\") index += 1;
        index += 1;
      }
      if (index === source.length) tomlError();
      index += 1;
      try {
        parts.push(quote === '"' ? JSON.parse(source.slice(start, index)) : source.slice(start + 1, index - 1));
      } catch { tomlError(); }
    } else {
      const bare = source.slice(index).match(/^[A-Za-z0-9_-]+/)?.[0];
      if (!bare) tomlError();
      parts.push(bare);
      index += bare.length;
    }
    while (/\s/.test(source[index] ?? "") && index < source.length) index += 1;
    if (index === source.length) return parts;
    if (source[index++] !== "." || index === source.length) tomlError();
  }
  tomlError();
}

// Read logical statements without interpreting user values. Delimiters and
// table-shaped text inside strings/arrays cannot become a section boundary.
// Unsupported/unterminated syntax is rejected before any integration writes.
function tomlRecords(source) {
  if (/\r(?!\n)/.test(source)) tomlError();
  const records = [];
  const brackets = [];
  let start = 0, code = "", quote = null, comments = [];
  function finish(end) {
    const raw = source.slice(start, end);
    const text = code.trim();
    const record = { raw, comments, type: "trivia" };
    if (text.startsWith("[")) {
      const array = text.startsWith("[[");
      if (!text.endsWith(array ? "]]" : "]")) tomlError();
      record.type = "table";
      record.path = keyPath(text.slice(array ? 2 : 1, array ? -2 : -1).trim());
      record.array = array;
    } else if (text) {
      let keyQuote = null, equal = -1;
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (keyQuote) {
          if (char === "\\" && keyQuote === '"') index += 1;
          else if (char === keyQuote) keyQuote = null;
        } else if (char === '"' || char === "'") keyQuote = char;
        else if (char === "=") { equal = index; break; }
      }
      if (equal < 1 || !text.slice(equal + 1).trim()) tomlError();
      record.type = "assignment";
      record.path = keyPath(text.slice(0, equal).trim());
      record.code = text;
    }
    records.push(record);
    start = end;
    code = "";
    comments = [];
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      code += char;
      if (char === "\\" && quote[0] === '"') {
        if (index + 1 === source.length) tomlError();
        if (quote.length === 1 && /[\r\n]/.test(source[index + 1])) tomlError();
        code += source[++index];
      } else if (source.startsWith(quote, index)) {
        if (quote.length === 3) {
          let end = index + 3;
          while (source[end] === char) end += 1;
          if (end - index > 5) tomlError();
          code += source.slice(index + 1, end);
          index = end - 1;
        }
        quote = null;
      } else if (quote.length === 1 && (char === "\n" || char === "\r")) tomlError();
      continue;
    }
    if (char === "#") {
      let commentStart = index;
      while (commentStart > start && /[ \t]/.test(source[commentStart - 1])) commentStart -= 1;
      let end = source.indexOf("\n", index);
      if (end === -1) end = source.length;
      else end += 1;
      comments.push(source.slice(commentStart, end));
      index = end - 1;
      code += "\n";
      if (!brackets.length) finish(end);
      continue;
    }
    if (char === '"' || char === "'") {
      quote = source.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
      code += quote;
      index += quote.length - 1;
      continue;
    }
    if (char === "[" || char === "{") brackets.push(char);
    else if (char === "]" || char === "}") {
      if (brackets.pop() !== (char === "]" ? "[" : "{")) tomlError();
    }
    code += char;
    if (char === "\n" && !brackets.length) finish(index + 1);
  }
  if (quote || brackets.length) tomlError();
  if (start < source.length) finish(source.length);
  return records;
}

function appendTomlSection(source, name, values, newline) {
  if (source && !source.endsWith("\n")) source += newline;
  if (source && !/(?:\r?\n){2}$/.test(source)) source += newline;
  return source + [`[${name}]`, ...values, ""].join(newline);
}

export function reconcileCodexToml(source, { launcherPath, pluginId }) {
  const records = tomlRecords(source);
  const newline = source.match(/\r\n|\n/)?.[0] ?? "\n";
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const features = ["features"], plugin = ["plugins", pluginId];
  const server = ["mcp_servers", "context-mode"];
  const legacy = ["plugins", pluginId, "mcp_servers", "context-mode"];
  const managed = [features, plugin, server, legacy];
  const generatedTables = [features, plugin, server];
  const controlledFields = [
    { section: features, key: "hooks" }, { section: plugin, key: "enabled" },
    ...["command", "args", "env_vars", "enabled", "required", "default_tools_approval_mode"]
      .map((key) => ({ section: server, key })),
  ];
  const prefix = (parent, child) => parent.length <= child.length &&
    parent.every((part, index) => part === child[index]);
  let section = [];
  const seen = new Set();
  for (const record of records) {
    if (record.type === "table") {
      section = record.path;
      if (record.array && generatedTables.some((path) => prefix(section, path))) tomlError();
      if (controlledFields.some((field) => prefix([...field.section, field.key], section))) tomlError();
      if (managed.some((path) => same(path, section))) {
        const identity = JSON.stringify(section);
        if (record.array || seen.has(identity)) tomlError();
        seen.add(identity);
      }
    }
    record.section = section;
    if (record.type === "assignment") {
      const fullPath = [...section, ...record.path];
      const legacyInline = same(section, ["mcp_servers"]) && same(record.path, ["context-mode"]);
      // Assignment-created parents are sealed inline/scalar values. A new
      // child table cannot safely be appended beneath them. Compare decoded
      // paths so quoted and dotted spellings have the same rejection boundary.
      if (!legacyInline && generatedTables.some((path) => prefix(fullPath, path))) tomlError();
      if (!legacyInline && controlledFields.some((field) => {
        const target = [...field.section, field.key];
        const overlaps = prefix(fullPath, target) || prefix(target, fullPath);
        const supported = same(section, field.section) && same(record.path, [field.key]);
        return overlaps && !supported;
      })) tomlError();
    }
  }
  const hasControl = (path, key) => {
    const assignments = records.filter((record) => record.type === "assignment" &&
      same(record.section, path) && record.path[0] === key);
    if (assignments.length > 1 || assignments.some((record) => record.path.length !== 1)) tomlError();
    return assignments.length === 1;
  };
  const hooks = hasControl(features, "hooks");
  const enabled = hasControl(plugin, "enabled");
  const values = ['command = "node"', `args = [${tomlString(launcherPath)}]`,
    'env_vars = ["GESTALT_SESSION_TMP_CONTEXT", "TMPDIR", "TMP", "TEMP"]',
    "enabled = true", "required = true", 'default_tools_approval_mode = "approve"'];
  const canonical = ["[mcp_servers.context-mode]", ...values, ""].join(newline);
  let output = "";
  for (const record of records) {
    const removed = same(record.section, server) || same(record.section, legacy);
    if (record.type === "table" && same(record.path, server)) {
      output += canonical + record.comments.join("");
    } else if (removed && record.type !== "trivia") {
      output += record.comments.join("");
    } else if (record.type === "assignment" && same(record.section, ["mcp_servers"]) &&
        same(record.path, ["context-mode"])) {
      output += record.comments.join("");
    } else if (record.type === "assignment" &&
        (same(record.section, features) && same(record.path, ["hooks"]) ||
         same(record.section, plugin) && same(record.path, ["enabled"]))) {
      const value = same(record.section, features) ? "hooks = true" : "enabled = false";
      if (record.code === value) output += record.raw;
      else output += value + (record.comments.length ? record.comments.join("") : record.raw.match(/\r\n$|\n$/)?.[0] ?? "");
    } else {
      output += record.raw;
      if (record.type === "table" && (same(record.path, features) && !hooks || same(record.path, plugin) && !enabled)) {
        if (!output.endsWith("\n")) output += newline;
        output += (same(record.path, features) ? "hooks = true" : "enabled = false") + newline;
      }
    }
  }
  if (!seen.has(JSON.stringify(features))) output = appendTomlSection(output, "features", ["hooks = true"], newline);
  if (!seen.has(JSON.stringify(plugin))) output = appendTomlSection(output, `plugins.${tomlString(pluginId)}`, ["enabled = false"], newline);
  if (!seen.has(JSON.stringify(server))) output = appendTomlSection(output, "mcp_servers.context-mode", values, newline);
  return output;
}

function hookCommands(value, commands = []) {
  if (!value || typeof value !== "object") return commands;
  if (typeof value.command === "string") commands.push(value.command);
  if (Array.isArray(value)) for (const item of value) hookCommands(item, commands);
  else for (const item of Object.values(value)) hookCommands(item, commands);
  return commands;
}

function isManagedHook(value) {
  return hookCommands(value).some((command) =>
    /context-mode-hook\.mjs|context-mode\s+hook\s+codex|context-mode[/\\].*runtime-hook\.mjs/.test(command),
  );
}

export function reconcileCodexHooks(source, hookLauncherPath) {
  const parsed = source.trim() ? JSON.parse(source) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("hooks.json must contain a JSON object");
  }
  if (parsed.hooks === undefined) parsed.hooks = {};
  if (!parsed.hooks || typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks)) {
    throw new Error("hooks.json hooks must contain a JSON object");
  }
  for (const [event, argument, matcher] of MANAGED_HOOK_EVENTS) {
    const existing = parsed.hooks[event];
    if (existing !== undefined && !Array.isArray(existing)) {
      throw new Error(`hooks.json ${event} must contain an array`);
    }
    const entry = {
      ...(matcher ? { matcher } : {}),
      hooks: [
        {
          type: "command",
          command: `: ${shellQuote(`context-mode hook codex ${argument}`)}; node ${shellQuote(hookLauncherPath)} ${argument}`,
        },
      ],
    };
    parsed.hooks[event] = [...(existing ?? []).filter((item) => !isManagedHook(item)), entry];
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function writeIfChanged(path, contents, mode = 0o644) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === contents) return false;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, contents, { encoding: "utf8", mode });
  if (existsSync(path)) chmodSync(temporary, statSync(path).mode & 0o777);
  renameSync(temporary, path);
  return true;
}

function mcpLauncher(pluginRoot, gestaltHome) {
  return `#!/usr/bin/env node
import { pathToFileURL } from "node:url";

process.env.GESTALT_HOME ||= ${JSON.stringify(gestaltHome)};
process.env.CONTEXT_MODE_PLATFORM = "codex";
process.env.CONTEXT_MODE_WORKSPACE ||= process.cwd();
await import(pathToFileURL(${JSON.stringify(join(pluginRoot, "start.mjs"))}).href);
`;
}

function hookLauncher(pluginRoot, gestaltHome) {
  return `#!/usr/bin/env node
import { pathToFileURL } from "node:url";

process.env.GESTALT_HOME ||= ${JSON.stringify(gestaltHome)};
process.env.CONTEXT_MODE_PLATFORM = "codex";
await import(pathToFileURL(${JSON.stringify(join(pluginRoot, "hooks", "runtime-hook.mjs"))}).href);
`;
}

export function configureCodexIntegration({ codexHome, gestaltHome, pluginRoot, pluginId }) {
  codexHome = requireAbsolute(codexHome, "CODEX_HOME");
  gestaltHome = requireAbsolute(gestaltHome, "GESTALT_HOME");
  pluginRoot = requireAbsolute(pluginRoot, "context-mode plugin root");
  requireVersionedPluginRoot(pluginRoot);
  if (!pluginId || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9._+-]+$/.test(pluginId)) {
    throw new Error(`invalid context-mode plugin id: ${pluginId ?? ""}`);
  }
  for (const relative of ["start.mjs", join("hooks", "runtime-hook.mjs")]) {
    if (!existsSync(join(pluginRoot, relative))) throw new Error(`context-mode script is missing: ${join(pluginRoot, relative)}`);
  }

  const bin = join(codexHome, "bin");
  const launcherPath = join(bin, "context-mode-mcp.mjs");
  const hookLauncherPath = join(bin, "context-mode-hook.mjs");
  const configPath = join(codexHome, "config.toml");
  const hooksPath = join(codexHome, "hooks.json");
  const changed = [];
  const config = reconcileCodexToml(existsSync(configPath) ? readFileSync(configPath, "utf8") : "", {
    launcherPath,
    pluginId,
  });
  const hooks = reconcileCodexHooks(existsSync(hooksPath) ? readFileSync(hooksPath, "utf8") : "", hookLauncherPath);
  if (writeIfChanged(launcherPath, mcpLauncher(pluginRoot, gestaltHome), 0o755)) changed.push(launcherPath);
  if (writeIfChanged(hookLauncherPath, hookLauncher(pluginRoot, gestaltHome), 0o755)) changed.push(hookLauncherPath);
  if (writeIfChanged(configPath, config)) changed.push(configPath);
  if (writeIfChanged(hooksPath, hooks)) changed.push(hooksPath);
  return { changed, configPath, hooksPath, launcherPath, hookLauncherPath };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument: ${key ?? ""}`);
    options[key.slice(2)] = value;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = configureCodexIntegration({
    codexHome: options["codex-home"],
    gestaltHome: options["gestalt-home"],
    pluginRoot: options["plugin-root"],
    pluginId: options["plugin-id"],
  });
  process.stdout.write(
    result.changed.length > 0
      ? `context-mode Codex integration repaired: ${result.changed.length} file(s) updated\n`
      : "context-mode Codex integration already current\n",
  );
}
