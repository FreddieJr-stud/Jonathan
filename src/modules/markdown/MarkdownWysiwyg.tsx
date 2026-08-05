import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";
import { cn } from "@/lib/utils";
import { useDocument } from "@/modules/editor/lib/useDocument";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { MarkdownViewToggle } from "./MarkdownViewToggle";

// Debounce window after the last keystroke before persisting to disk.
const AUTOSAVE_DELAY_MS = 600;

export type MarkdownWysiwygHandle = {
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
};

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
  onDirtyChange?: (dirty: boolean) => void;
};

/**
 * Editable rendered-markdown view. Renders the file as formatted WYSIWYG
 * (Milkdown Crepe) instead of read-only HTML; edits serialize back to markdown
 * and persist through `useDocument` (debounced autosave → fs_write_file).
 *
 * Crepe owns its document state once created, so an external on-disk edit
 * doesn't live-refresh on its own — `reload()` (exposed via ref, driven by
 * `useEditorFileSync`) updates `useDocument`'s content when the buffer is
 * clean, which changes `content` below and remounts Crepe with the fresh text.
 */
export const MarkdownWysiwyg = forwardRef<MarkdownWysiwygHandle, Props>(
  function MarkdownWysiwyg({ path, visible, onSetView, onDirtyChange }, ref) {
  const { doc, onChange, save, reload } = useDocument({ path, onDirtyChange });
  const hostRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  // Keep the latest onChange/save without re-running the create effect on every keystroke.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveRef = useRef(save);
  saveRef.current = save;

  // Disk content for the current file (null until the read resolves). Updated by
  // useDocument only on load/reload — never on local typing — so the editor is
  // built once per file and recreated only when the file is reopened/externally
  // changed (while clean).
  const content = doc.status === "ready" ? doc.content : null;

  useEffect(() => {
    if (content === null) return;
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;
    // Guaranteed debounced autosave: useDocument's own autosave is gated on the
    // global editorAutoSave pref, but this view's contract is always-autosave, so
    // we also schedule save() here (a no-op when the buffer is already clean).
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const crepe = new Crepe({ root: host, defaultValue: content });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveRef
            .current()
            .catch((e) => console.error("[markdown-wysiwyg] autosave", e));
        }, AUTOSAVE_DELAY_MS);
      });
    });
    crepe.create().then(
      () => {
        if (destroyed) void crepe.destroy();
      },
      (e) => console.error("[markdown-wysiwyg] create failed", e),
    );

    return () => {
      destroyed = true;
      if (saveTimer) clearTimeout(saveTimer);
      // Flush any pending edit before tearing down (no-op when clean).
      saveRef.current().catch(() => {});
      void crepe.destroy();
    };
  }, [content]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background zoom-exempt",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      {/* data-markdown-rendered / data-md-path keep the "Ask Jonathan" selection
          popup working and let it cite the source file. */}
      <div
        className="flex-1 overflow-auto"
        data-markdown-rendered
        data-md-path={path}
      >
        {doc.status === "loading" && (
          <p className="px-8 py-6 text-[12px] text-muted-foreground">
            Loading…
          </p>
        )}
        {doc.status === "error" && (
          <p className="px-8 py-6 text-[12px] text-destructive">
            Failed to read file: {doc.message}
          </p>
        )}
        {doc.status === "binary" && (
          <p className="px-8 py-6 text-[12px] text-muted-foreground">
            Binary file — cannot render as markdown.
          </p>
        )}
        {doc.status === "toolarge" && (
          <p className="px-8 py-6 text-[12px] text-muted-foreground">
            File is {doc.size} bytes; limit {doc.limit}.
          </p>
        )}
        {/* Crepe mounts into this host; transparent surface so the pane bg shows. */}
        {doc.status === "ready" && (
          <div
            ref={hostRef}
            className="markdown-wysiwyg [&_.milkdown]:bg-transparent [&_.milkdown]:px-4 [&_.milkdown]:py-2"
          />
        )}
      </div>
    </div>
  );
  },
);
