import { inflateRawSync } from "node:zlib";

/** Narrow ZIP reader: no archive-controlled filesystem paths are ever written. */
export function unpackEvidenceZip(zip: Buffer, maxBytes: number): { name: string; data: Buffer }[] {
  const bad = (): never => { throw new Error("unsafe-archive"); };
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || end < zip.length - 65557) return bad();
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) return bad();
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12);
  let offset = zip.readUInt32LE(end + 16), total = 0;
  if (count > 100 || count !== zip.readUInt16LE(end + 8) || offset + size !== end || end + 22 + zip.readUInt16LE(end + 20) !== zip.length) return bad();
  const members: { name: string; data: Buffer }[] = [], names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || zip.readUInt32LE(offset) !== 0x02014b50) return bad();
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20), uncompressed = zip.readUInt32LE(offset + 24);
    const n = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42), mode = zip.readUInt32LE(offset + 38) >>> 16;
    if (offset + 46 + n + extra + comment > end || n > 1024 || zip.readUInt16LE(offset + 34)) return bad();
    const rawName = zip.subarray(offset + 46, offset + 46 + n), name = rawName.toString("utf8");
    if (!Buffer.from(name).equals(rawName) || /[\x00-\x1f\x7f\\:]/.test(name) || name.startsWith("/") || name.split("/").some(p => p === ".." || p === ".") || names.has(name) || !name || (mode & 0xf000) === 0xa000) return bad();
    names.add(name);
    if (flags & 1 || ![0, 8].includes(method) || total + uncompressed > maxBytes || compressed > maxBytes || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return bad();
    const ln = zip.readUInt16LE(local + 26), le = zip.readUInt16LE(local + 28);
    const start = local + 30 + ln + le;
    if (start + compressed > zip.readUInt32LE(end + 16) || !zip.subarray(local + 30, local + 30 + ln).equals(rawName) || zip.readUInt16LE(local + 8) !== method) return bad();
    const bytes = zip.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(bytes) : inflateRawSync(bytes, { maxOutputLength: Math.max(1, Math.min(maxBytes - total, uncompressed)) });
    if (data.length !== uncompressed || crc32(data) !== zip.readUInt32LE(offset + 16)) return bad();
    total += data.length;
    if (!name.endsWith("/")) members.push({ name, data });
    offset += 46 + n + extra + comment;
  }
  if (offset !== end) return bad();
  return members;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
