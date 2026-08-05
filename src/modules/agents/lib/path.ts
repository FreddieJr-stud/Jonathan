/** Last N path segments, e.g. `truncatePath("C:\\a\\b\\c\\d", 3)` -> `"b\\c\\d"`. */
export function truncatePath(path: string, segments = 3): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= segments) return path;
  return parts.slice(-segments).join(sep);
}
