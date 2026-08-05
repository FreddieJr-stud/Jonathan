import { LazyStore } from "@tauri-apps/plugin-store";

export type SavedUrl = {
  id: string;
  url: string;
  savedAt: number;
  /** Display label shown instead of the raw URL. Absent/empty falls back to
   * the URL itself; renaming never rewrites `url`. */
  alias?: string;
};

/** Label to show for a saved entry — its alias when set, else the raw URL. */
export function savedUrlLabel(s: SavedUrl): string {
  return s.alias?.trim() ? s.alias : s.url;
}

const STORE_PATH = "terax-ai-preview-saved-urls.json";
const KEY_LIST = "urls";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadSavedUrls(): Promise<SavedUrl[]> {
  const list = (await store.get<SavedUrl[]>(KEY_LIST)) ?? [];
  return [...list].sort((a, b) => b.savedAt - a.savedAt);
}

/** Adds `url` if not already saved (dedupe by exact string match). */
export async function saveUrl(url: string): Promise<SavedUrl[]> {
  const list = (await store.get<SavedUrl[]>(KEY_LIST)) ?? [];
  if (list.some((s) => s.url === url)) return loadSavedUrls();
  const next: SavedUrl[] = [
    ...list,
    { id: newSavedUrlId(), url, savedAt: Date.now() },
  ];
  await store.set(KEY_LIST, next);
  await store.save();
  return loadSavedUrls();
}

/** Renames a saved entry's display alias. An empty/blank alias clears it, so
 * the row falls back to showing the URL. The URL is never touched. */
export async function renameSavedUrl(
  id: string,
  alias: string,
): Promise<SavedUrl[]> {
  const list = (await store.get<SavedUrl[]>(KEY_LIST)) ?? [];
  const trimmed = alias.trim();
  const next = list.map((s) =>
    s.id === id ? { ...s, alias: trimmed || undefined } : s,
  );
  await store.set(KEY_LIST, next);
  await store.save();
  return loadSavedUrls();
}

export async function deleteSavedUrl(id: string): Promise<SavedUrl[]> {
  const list = (await store.get<SavedUrl[]>(KEY_LIST)) ?? [];
  const next = list.filter((s) => s.id !== id);
  await store.set(KEY_LIST, next);
  await store.save();
  return loadSavedUrls();
}

function newSavedUrlId(): string {
  return `su-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
