// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioral guard for "preview stays painted on top after switching tab or
 * space".
 *
 * `preview_open` is async and `add_child` creates the child webview VISIBLE,
 * while `preview_hide` and `preview_close` both no-op when the webview does not
 * exist yet. Anything issued during the create is therefore silently dropped,
 * and nothing re-runs the visibility effect afterwards: `createdRef` is a ref
 * (flipping it causes no render) and visible/suppressed/url have not changed.
 * The native layer ends up painted over the whole app — for the close case,
 * with no component left to ever hide it, so only an app restart clears it.
 *
 * Both cases hinge on *ordering around an unresolved promise*, so they cannot be
 * reproduced reliably by clicking: the real window is a few hundred
 * milliseconds. Here `previewOpen` is a deferred the test resolves by hand,
 * which makes the ordering exact instead of lucky.
 *
 * Companion pieces: `PreviewPane.test.ts` pins the same invariants at source
 * level, and `TERAX_PREVIEW_OPEN_DELAY_MS` (preview.rs) widens the real window
 * for manual repro.
 */

const previewOpen = vi.fn();
const previewShow = vi.fn();
const previewHide = vi.fn();
const previewClose = vi.fn();
const previewSetBounds = vi.fn();

vi.mock("./lib/previewWebview", () => ({
  previewLabel: (id: number) => `preview-${id}`,
  previewOpen: (...a: unknown[]) => previewOpen(...a),
  previewShow: (...a: unknown[]) => previewShow(...a),
  previewHide: (...a: unknown[]) => previewHide(...a),
  previewClose: (...a: unknown[]) => previewClose(...a),
  previewSetBounds: (...a: unknown[]) => previewSetBounds(...a),
  previewNavigate: vi.fn(() => Promise.resolve()),
  previewBack: vi.fn(() => Promise.resolve()),
  previewForward: vi.fn(() => Promise.resolve()),
  clearPreviewNav: vi.fn(),
  usePreviewNav: () => ({ url: "", canGoBack: false, canGoForward: false }),
}));

vi.mock("./lib/previewSuppress", () => ({
  usePreviewSuppress: (sel: (s: { suppressed: boolean }) => unknown) =>
    sel({ suppressed: false }),
}));

const aiRect = { rect: null };
vi.mock("@/modules/ai/lib/aiWindowRect", () => ({
  useAiWindowRect: Object.assign(
    (sel: (s: typeof aiRect) => unknown) => sel(aiRect),
    { getState: () => aiRect },
  ),
}));

// The address bar pulls in the whole saved-URLs / ports stack, none of which
// this test exercises.
vi.mock("./PreviewAddressBar", () => ({
  PreviewAddressBar: () => null,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("@hugeicons/core-free-icons", () => ({ Globe02Icon: {} }));

const { PreviewPane } = await import("./PreviewPane");

/** A promise the test resolves by hand, standing in for the async create. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const URL_A = "https://example.com/";

beforeEach(() => {
  vi.clearAllMocks();

  // jsdom reports a zero rect for everything, which `measure()` treats as
  // unmeasurable — the pane would then hide for the wrong reason and the test
  // would pass without proving anything.
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, x: 0, y: 0 }) as DOMRect;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe("preview webview create races", () => {
  it("hides the webview when the tab was switched away during the create", async () => {
    const create = deferred();
    previewOpen.mockReturnValue(create.promise);

    const view = render(
      <PreviewPane
        tabId={1}
        url={URL_A}
        visible={true}
        onUrlChange={() => {}}
      />,
    );
    expect(previewOpen).toHaveBeenCalledTimes(1);

    // Switch away while the create is still in flight. This hide reaches a
    // backend that has no webview yet, so it is dropped on the floor.
    view.rerender(
      <PreviewPane
        tabId={1}
        url={URL_A}
        visible={false}
        onUrlChange={() => {}}
      />,
    );
    previewShow.mockClear();
    previewHide.mockClear();

    // The webview now exists — and `add_child` made it visible.
    await act(async () => {
      create.resolve();
      await create.promise;
    });

    expect(previewHide).toHaveBeenCalledWith("preview-1");
    expect(previewShow).not.toHaveBeenCalled();
  });

  it("shows the webview when the tab is still active once the create resolves", async () => {
    const create = deferred();
    previewOpen.mockReturnValue(create.promise);

    render(
      <PreviewPane
        tabId={2}
        url={URL_A}
        visible={true}
        onUrlChange={() => {}}
      />,
    );
    previewShow.mockClear();
    previewHide.mockClear();

    await act(async () => {
      create.resolve();
      await create.promise;
    });

    // The mirror of the test above: re-applying must not blanket-hide a pane
    // the user is actually looking at.
    expect(previewShow).toHaveBeenCalledWith("preview-2");
    expect(previewHide).not.toHaveBeenCalled();
  });

  it("closes the orphan when the pane unmounted during the create", async () => {
    const create = deferred();
    previewOpen.mockReturnValue(create.promise);

    const view = render(
      <PreviewPane
        tabId={3}
        url={URL_A}
        visible={true}
        onUrlChange={() => {}}
      />,
    );

    // Closing the tab, or switching space, unmounts the pane. Its
    // `preview_close` is dropped for the same reason the hide was.
    view.unmount();
    previewClose.mockClear();

    await act(async () => {
      create.resolve();
      await create.promise;
    });

    // Without this the webview outlives every React owner: visible, floating
    // over the app, clearable only by restarting.
    expect(previewClose).toHaveBeenCalledWith("preview-3");
  });

  it("does not leave createdRef set when the create rejects", async () => {
    // WebView2 genuinely rejects when two builds share a user-data folder with
    // disagreeing browser args. A stuck createdRef makes every later navigate
    // target a webview that was never built.
    previewOpen.mockReturnValue(Promise.reject(new Error("boom")));

    const view = render(
      <PreviewPane
        tabId={4}
        url={URL_A}
        visible={true}
        onUrlChange={() => {}}
      />,
    );
    await act(async () => {});

    previewClose.mockClear();
    view.unmount();
    // createdRef was rolled back, so teardown must not try to close a webview
    // that does not exist.
    expect(previewClose).not.toHaveBeenCalled();
  });
});
