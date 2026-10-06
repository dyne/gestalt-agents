import { basename, dirname, isAbsolute, resolve } from "node:path";

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value) =>
  typeof value === "string" || Number.isSafeInteger(value);
const errorResponse = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** Dispatch only requests. Notifications never run tools or receive replies. */
export function handleLine(line, dispatch) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return errorResponse(null, -32700, "Parse error");
  }
  if (
    !object(request) ||
    request.jsonrpc !== "2.0" ||
    typeof request.method !== "string" ||
    (Object.hasOwn(request, "id") && !validId(request.id))
  ) {
    return errorResponse(null, -32600, "Invalid Request");
  }
  if (!Object.hasOwn(request, "id")) return null;
  if (Object.hasOwn(request, "params") && !object(request.params)) {
    return errorResponse(request.id, -32602, "params must be an object");
  }
  try {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: dispatch(request.method, request.params ?? {}),
    };
  } catch (error) {
    return error instanceof ProtocolError
      ? errorResponse(request.id, error.code, error.message)
      : errorResponse(request.id, -32603, "Internal error");
  }
}

/** Explicit launch context keeps plugin cwd distinct from the session workspace. */
export function resolveMcpPlanPath(
  path,
  { cwd, pluginDirectory, statusDirectory },
) {
  if (isAbsolute(path)) return path;
  if (statusDirectory !== undefined) {
    if (
      typeof statusDirectory !== "string" ||
      !isAbsolute(statusDirectory) ||
      !/^[a-f0-9]{64}$/.test(basename(statusDirectory)) ||
      basename(dirname(statusDirectory)) !== "status" ||
      basename(dirname(dirname(statusDirectory))) !== ".gestalt"
    ) {
      throw new Error(
        "Invalid session workspace handoff. Pass the absolute plan path.",
      );
    }
    return resolve(dirname(dirname(dirname(statusDirectory))), path);
  }
  if (resolve(cwd) === resolve(pluginDirectory)) {
    throw new Error(
      "A relative Org Plan path requires the session workspace. Pass the absolute plan path.",
    );
  }
  return resolve(cwd, path);
}

const dateTime =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
export function isDateTime(value) {
  if (typeof value !== "string") return false;
  const match = dateTime.exec(value);
  if (!match || match[0] !== value) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHour = "0",
    offsetMinute = "0",
  ] = match;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    Number(offsetHour) <= 23 &&
    Number(offsetMinute) <= 59
  );
}

/** The small JSON Schema subset used by this adapter's tool definitions. */
export function validate(value, schema, at = "arguments") {
  const invalid = (message) => {
    throw new ProtocolError(-32602, `${at} ${message}`);
  };
  switch (schema.type) {
    case "object": {
      if (!object(value)) invalid("must be an object");
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) invalid(`requires ${key}`);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) invalid(`does not allow ${key}`);
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        if (Object.hasOwn(value, key))
          validate(value[key], child, `${at}.${key}`);
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") invalid("must be a string");
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength)
        invalid("is too short");
      if (schema.maxLength !== undefined && length > schema.maxLength)
        invalid("is too long");
      if (schema.enum && !schema.enum.includes(value))
        invalid("has an invalid value");
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        invalid("has an invalid format");
      if (schema.format === "date-time" && !isDateTime(value))
        invalid("must be a valid date-time");
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") invalid("must be a boolean");
      return;
    case "integer":
      if (!Number.isSafeInteger(value)) invalid("must be an integer");
      if (schema.minimum !== undefined && value < schema.minimum)
        invalid("is below the minimum");
      if (schema.maximum !== undefined && value > schema.maximum)
        invalid("is above the maximum");
      return;
    default:
      throw new Error(`Unsupported schema type: ${schema.type}`);
  }
}
