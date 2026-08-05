import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Tauri store plugin, which needs a running app.
const backing = new Map<string, unknown>();

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get<T>(key: string): Promise<T | undefined> {
      return backing.get(key) as T | undefined;
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.set(key, value);
    }
    async save(): Promise<void> {}
  },
}));

const { loadSavedUrls, renameSavedUrl, saveUrl, savedUrlLabel } = await import(
  "./savedUrls"
);

describe("saved URL aliases", () => {
  beforeEach(() => backing.clear());

  it("renames an entry without touching its URL", async () => {
    const [saved] = await saveUrl("http://localhost:5173");
    const next = await renameSavedUrl(saved.id, "  Vite dev  ");
    expect(next[0].alias).toBe("Vite dev");
    expect(next[0].url).toBe("http://localhost:5173");
  });

  it("clears the alias when renamed to blank, falling back to the URL", async () => {
    const [saved] = await saveUrl("http://localhost:3000");
    await renameSavedUrl(saved.id, "API");
    const next = await renameSavedUrl(saved.id, "   ");
    expect(next[0].alias).toBeUndefined();
    expect(savedUrlLabel(next[0])).toBe("http://localhost:3000");
  });

  it("keeps dedupe keyed on the URL, not the alias", async () => {
    const [saved] = await saveUrl("http://localhost:8080");
    await renameSavedUrl(saved.id, "Webpack");
    const next = await saveUrl("http://localhost:8080");
    expect(next).toHaveLength(1);
    expect(next[0].alias).toBe("Webpack");
  });

  it("survives entries written before aliases existed", async () => {
    backing.set("urls", [
      { id: "su-legacy", url: "http://localhost:4200", savedAt: 1 },
    ]);
    const list = await loadSavedUrls();
    expect(savedUrlLabel(list[0])).toBe("http://localhost:4200");
  });
});
