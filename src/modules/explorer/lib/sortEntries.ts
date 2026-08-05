import type { DirEntry } from "./useFileTree";

export type SortField = "name" | "size" | "type" | "modified";
export type SortDir = "asc" | "desc";

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function compareAsc(a: DirEntry, b: DirEntry, field: SortField): number {
  switch (field) {
    case "size":
      return a.size - b.size || a.name.localeCompare(b.name);
    case "modified":
      return a.mtime - b.mtime || a.name.localeCompare(b.name);
    case "type":
      return (
        extensionOf(a.name).localeCompare(extensionOf(b.name)) ||
        a.name.localeCompare(b.name)
      );
    case "name":
    default:
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  }
}

function kindRank(kind: DirEntry["kind"]): number {
  switch (kind) {
    case "dir":
      return 0;
    case "symlink":
      return 1;
    default:
      return 2;
  }
}

/** Dirs, then symlinks, then files (matches the backend's default grouping,
 * so the default Name/Asc sort doesn't shift anything). Within the dir/symlink
 * groups, entries sort by name unless the field is "modified" (mtime is
 * meaningful there too). Within the file group, entries sort by the chosen
 * field. */
export function sortEntries(
  entries: DirEntry[],
  field: SortField,
  dir: SortDir,
): DirEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const rankA = kindRank(a.kind);
    const rankB = kindRank(b.kind);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA !== 2 && field !== "modified") {
      return compareAsc(a, b, "name") * sign;
    }
    return compareAsc(a, b, field) * sign;
  });
}
