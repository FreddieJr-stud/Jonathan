// Formats the bundled 7z.exe can extract without extra codecs (no rar/arj/paq/zpaq/zst).
const EXTRACTABLE_EXTS = new Set([
  "7z",
  "zip",
  "tar",
  "gz",
  "bz2",
  "tgz",
  "tbz",
  "tbz2",
  "xz",
  "z",
]);

function lastExt(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

export function isExtractableArchive(name: string): boolean {
  return EXTRACTABLE_EXTS.has(lastExt(name));
}

export function baseNameWithoutExt(name: string): string {
  const ext = lastExt(name);
  return ext ? name.slice(0, name.length - ext.length - 1) : name;
}
