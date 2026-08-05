import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level regression test for the native preview webview's security
 * posture. The Preview tab is now a Tauri child webview (see
 * `src-tauri/src/modules/preview.rs`) loading arbitrary remote URLs, so the two
 * invariants that keep it safe are:
 *   1. `on_navigation` only allows http(s) — never file:/tauri:/custom schemes.
 *   2. The `preview-*` webview labels are NOT granted any capability, so the
 *      remote page receives no Tauri IPC (`window.__TAURI__` is absent).
 * If a future change silently breaks either, this test fails.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const previewRs = readFileSync(
  path.join(repoRoot, "src-tauri", "src", "modules", "preview.rs"),
  "utf8",
);
const defaultCap = readFileSync(
  path.join(repoRoot, "src-tauri", "capabilities", "default.json"),
  "utf8",
);
const previewPaneTsx = readFileSync(path.join(here, "PreviewPane.tsx"), "utf8");

describe("native preview webview security", () => {
  it("creates the webview via the multiwebview add_child API", () => {
    expect(previewRs).toMatch(/\.add_child\(/);
    expect(previewRs).toMatch(/on_navigation/);
  });

  it("restricts navigation to http(s) schemes", () => {
    expect(previewRs).toMatch(/scheme\(\)\s*!=\s*"http"/);
    expect(previewRs).toMatch(/scheme\(\)\s*!=\s*"https"/);
    // The guard must bail (cancel navigation) for anything else.
    expect(previewRs).toMatch(/return false/);
  });

  it("does NOT grant any capability to the preview-* webview labels", () => {
    const cap = JSON.parse(defaultCap) as { windows: string[] };
    for (const label of cap.windows) {
      expect(label.startsWith("preview")).toBe(false);
    }
  });
});

/**
 * Guards the fix for "preview stays painted on top after switching tab/space".
 *
 * `preview_open` is async and `add_child` creates the child webview VISIBLE,
 * while `preview_hide` and `preview_close` both no-op when the webview does not
 * exist yet. So a hide or close issued during the create is silently dropped,
 * and nothing re-runs the visibility effect afterwards — `createdRef` is a ref,
 * so flipping it causes no render, and visible/suppressed/url have not changed.
 * The pane must therefore re-decide once the create resolves.
 *
 * Source-level, matching the suite above: it cannot prove the ordering (see
 * PreviewPane.race.test.tsx for that), but it does catch a future refactor
 * quietly dropping the `.then()` and reintroducing a bug that only an app
 * restart clears.
 */
describe("preview webview create/hide race", () => {
  it("re-applies visibility once the async create resolves", () => {
    expect(previewPaneTsx).toMatch(
      /previewOpen\([^)]*\)[\s\S]{0,1200}?\.then\(/,
    );
    expect(previewPaneTsx).toMatch(/applyVisibilityRef\.current\(\)/);
  });

  it("closes a webview whose pane unmounted mid-create", () => {
    expect(previewPaneTsx).toMatch(/disposedRef\.current\s*=\s*true/);
    expect(previewPaneTsx).toMatch(
      /if\s*\(disposedRef\.current\)\s*\{[\s\S]{0,200}?previewClose\(label\)/,
    );
  });

  it("keeps the backend no-ops that make the race possible documented", () => {
    // If these ever start erroring instead of returning Ok on a missing
    // webview, the frontend guards above can be simplified — and this test
    // should fail loudly rather than let them rot.
    expect(previewRs).toMatch(
      /pub async fn preview_hide[\s\S]{0,400}?get_webview\(&label\)\s*else\s*\{\s*return Ok\(\(\)\);/,
    );
    expect(previewRs).toMatch(
      /pub async fn preview_close[\s\S]{0,200}?if let Some\(webview\) = app\.get_webview\(&label\)/,
    );
  });
});
