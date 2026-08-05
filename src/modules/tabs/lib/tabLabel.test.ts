import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type { EditorTab, PreviewTab, TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai", customTitle: "Server" })),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

describe("labelFor (non-terminal tabs)", () => {
  const editorTab = (over: Partial<EditorTab> = {}): EditorTab => ({
    id: 1,
    kind: "editor",
    spaceId: "default",
    title: "App.tsx",
    path: "/src/App.tsx",
    dirty: false,
    preview: false,
    ...over,
  });

  it("uses the stored title by default", () => {
    expect(labelFor(editorTab())).toBe("App.tsx");
  });

  it("prefers a custom title without touching the file path", () => {
    const t = editorTab({ customTitle: "Entry point" });
    expect(labelFor(t)).toBe("Entry point");
    expect(t.path).toBe("/src/App.tsx");
  });

  it("applies a custom title to a preview tab too", () => {
    const t: PreviewTab = {
      id: 2,
      kind: "preview",
      spaceId: "default",
      title: "localhost:5173",
      url: "http://localhost:5173",
      customTitle: "Dev server",
    };
    expect(labelFor(t)).toBe("Dev server");
  });
});
