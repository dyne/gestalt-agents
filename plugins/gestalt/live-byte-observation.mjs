/** SHA strings only, scoped to one synchronous validation. No authority cache. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const reject = () => { throw Object.assign(new Error("source-changed"), { reason: "source-changed" }); };
const identity = (info) => [info.dev, info.ino, info.uid, info.gid, info.mode, info.size, info.nlink,
  info.ctimeNs, info.mtimeNs, info.birthtimeNs].map(String).join(":");

export function withByteObservation(validate) {
  const paths = new Map(), files = new Map();
  let bytes = 0, reads = 0, hits = 0, active = true;
  const binding = (path) => {
    if (!active || typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) reject();
    const info = lstatSync(path, { bigint: true });
    if (!info.isFile() || info.size > 512n * 1024n * 1024n) reject();
    return { pin: identity(info), key: `${info.dev}:${info.ino}` };
  };
  const use = (path, hashBytes) => {
    const { pin, key } = binding(path), prior = paths.get(path), known = files.get(key);
    if (prior && prior !== pin || known && known.pin !== pin) reject();
    if (!prior && paths.size >= 60064) reject();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (identity(fstatSync(fd, { bigint: true })) !== pin) reject();
      let sha256 = known?.sha256;
      if (hashBytes && !sha256) {
        const hash = createHash("sha256"), chunk = Buffer.allocUnsafe(65536);
        let size = 0, count;
        while ((count = readSync(fd, chunk, 0, chunk.length, null))) {
          size += count; bytes += count;
          if (size > 512 * 1024 * 1024 || bytes > 3 * 1024 * 1024 * 1024) reject();
          hash.update(chunk.subarray(0, count));
        }
        if (BigInt(size) !== fstatSync(fd, { bigint: true }).size) reject();
        sha256 = hash.digest("hex"); reads++;
      } else if (hashBytes) hits++;
      if (identity(fstatSync(fd, { bigint: true })) !== pin || binding(path).pin !== pin) reject();
      if (hashBytes) { paths.set(path, pin); files.set(key, { pin, sha256 }); }
      return sha256;
    } finally { closeSync(fd); }
  };
  const observation = Object.freeze({
    sha256: (path) => use(path, true),
    counts: () => ({ bytes, reads, hits, paths: paths.size }),
  });
  try {
    const result = validate(observation);
    if (result && typeof result.then === "function") reject();
    for (const path of paths.keys()) use(path, false);
    return result;
  } finally { active = false; paths.clear(); files.clear(); }
}
