/**
 * Short, stable, filesystem-safe suffix derived from a project root path, so
 * per-window persisted stores (spaces, AI chat sessions) don't collide when a
 * single-instance process hosts multiple project windows. djb2 hash is
 * plenty for this -- collisions just mean two projects briefly share a store
 * file, not a security boundary.
 */
export function storeSuffix(root: string | null | undefined): string {
  if (!root) return "";
  let h = 5381;
  for (let i = 0; i < root.length; i++) {
    h = ((h << 5) + h + root.charCodeAt(i)) | 0;
  }
  return `-${(h >>> 0).toString(36)}`;
}
