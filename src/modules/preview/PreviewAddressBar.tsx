import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  AiChat02Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  Bookmark02Icon,
  CropIcon,
  Delete02Icon,
  Globe02Icon,
  Home01Icon,
  LinkSquare02Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  deleteSavedUrl,
  loadSavedUrls,
  renameSavedUrl,
  type SavedUrl,
  savedUrlLabel,
  saveUrl,
} from "./lib/savedUrls";

type PortPreset = {
  port: number;
  label: string;
  hint: string;
};

// Curated dev-server ports. Ordered by frontend frequency, then backend.
const PORT_PRESETS: readonly PortPreset[] = [
  { port: 5173, label: "Vite", hint: "vite, sveltekit" },
  { port: 5174, label: "Vite (alt)", hint: "second vite instance" },
  { port: 3000, label: "Next.js", hint: "next, express, rails" },
  { port: 3001, label: "Next.js (alt)", hint: "second next instance" },
  { port: 4173, label: "Vite preview", hint: "vite preview" },
  { port: 4200, label: "Angular", hint: "angular cli" },
  { port: 4321, label: "Astro", hint: "astro" },
  { port: 5500, label: "Live Server", hint: "vscode live server" },
  { port: 6006, label: "Storybook", hint: "storybook" },
  { port: 8080, label: "Webpack", hint: "webpack, vue cli" },
  { port: 8081, label: "Metro", hint: "react native metro" },
  { port: 8000, label: "Django / FastAPI", hint: "django, fastapi" },
  { port: 8888, label: "Jupyter", hint: "jupyter notebook" },
  { port: 5000, label: "Flask", hint: "flask" },
  { port: 7860, label: "Gradio", hint: "gradio" },
];

export type PreviewAddressBarHandle = {
  focus: () => void;
};

type Props = {
  url: string;
  onSubmit: (url: string) => void;
  onReload: () => void;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onSnip: () => void;
  snipDisabled: boolean;
};

export const PreviewAddressBar = forwardRef<PreviewAddressBarHandle, Props>(
  function PreviewAddressBar(
    {
      url,
      onSubmit,
      onReload,
      onBack,
      onForward,
      onHome,
      canGoBack,
      canGoForward,
      onSnip,
      snipDisabled,
    },
    ref,
  ) {
    const [draft, setDraft] = useState(url);
    const inputRef = useRef<HTMLInputElement>(null);

    // Keep draft in sync when the parent updates the URL externally
    // (AI tool, detected localhost chip, etc.).
    useEffect(() => {
      setDraft(url);
    }, [url]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.select();
        },
      }),
      [],
    );

    const [notice, setNotice] = useState<string | null>(null);
    const [checkingPort, setCheckingPort] = useState<number | null>(null);
    const [savedUrls, setSavedUrls] = useState<SavedUrl[]>([]);
    // Saved entry currently being renamed, plus its in-flight alias draft.
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [aliasDraft, setAliasDraft] = useState("");

    const refreshSavedUrls = useCallback(() => {
      void loadSavedUrls().then(setSavedUrls);
    }, []);

    const commitAlias = useCallback((id: string, alias: string) => {
      setRenamingId(null);
      void renameSavedUrl(id, alias).then(setSavedUrls);
    }, []);

    const isCurrentUrlSaved = savedUrls.some((s) => s.url === url);

    const submit = () => {
      const next = normalizeUrl(draft);
      if (!next) {
        setNotice("Enter a URL or pick a port preset.");
        return;
      }
      setNotice(null);
      if (next !== url) onSubmit(next);
      else onReload();
    };

    const tryPort = async (port: number) => {
      setNotice(null);
      setCheckingPort(port);
      const url = `http://localhost:${port}`;
      const ok = await probeUrl(url);
      setCheckingPort(null);
      if (!ok) {
        setNotice(`No server listening on :${port}.`);
        return;
      }
      setDraft(url);
      onSubmit(url);
    };

    return (
      <div className="shrink-0 border-b border-border/60">
        <div className="flex h-9 items-center gap-1 bg-card/40 px-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            disabled={!canGoBack}
            title="Back"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              size={15}
              strokeWidth={1.75}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onForward}
            disabled={!canGoForward}
            title="Forward"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={15}
              strokeWidth={1.75}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onReload}
            title="Reload"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              size={14}
              strokeWidth={1.75}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onHome}
            disabled={!url}
            title="Home (site root)"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={Home01Icon} size={14} strokeWidth={1.75} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="Common dev-server ports"
                className="h-7 shrink-0 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Globe02Icon}
                  size={13}
                  strokeWidth={1.75}
                />
                <span className="hidden sm:inline">Ports</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 min-w-56 overflow-y-auto"
            >
              {PORT_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.port}
                  onSelect={(e) => {
                    e.preventDefault();
                    void tryPort(p.port);
                  }}
                >
                  <span className="flex-1">{p.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {checkingPort === p.port ? "checking…" : `:${p.port}`}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex min-w-0 flex-1 items-center">
            <Input
              ref={inputRef}
              value={draft}
              placeholder="http://localhost:3000"
              spellCheck={false}
              autoComplete="off"
              className="h-7 w-full bg-muted/60 px-2 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(url);
                  inputRef.current?.blur();
                }
              }}
            />
          </div>
          <DropdownMenu
            onOpenChange={(open) => {
              setRenamingId(null);
              if (open) refreshSavedUrls();
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Saved URLs"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Bookmark02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-80 min-w-64 overflow-y-auto"
            >
              <DropdownMenuItem
                disabled={!url || isCurrentUrlSaved}
                onSelect={(e) => {
                  e.preventDefault();
                  if (!url) return;
                  void saveUrl(url).then(setSavedUrls);
                }}
              >
                {isCurrentUrlSaved
                  ? "Current URL already saved"
                  : "Save current URL"}
              </DropdownMenuItem>
              {savedUrls.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {savedUrls.map((s) =>
                    renamingId === s.id ? (
                      // Rendered outside DropdownMenuItem: a menu item would
                      // swallow typing into the menu's typeahead and steal
                      // focus from the input.
                      <div key={s.id} className="px-1 py-0.5">
                        <Input
                          autoFocus
                          value={aliasDraft}
                          placeholder={s.url}
                          aria-label="Saved URL alias"
                          onChange={(e) => setAliasDraft(e.target.value)}
                          onBlur={() => commitAlias(s.id, aliasDraft)}
                          onKeyDown={(e) => {
                            // Keep every keystroke out of the menu's typeahead,
                            // which would otherwise steal focus mid-rename.
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitAlias(s.id, aliasDraft);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                          className="h-7 text-xs"
                        />
                      </div>
                    ) : (
                      <DropdownMenuItem
                        key={s.id}
                        onSelect={(e) => {
                          e.preventDefault();
                          setDraft(s.url);
                          if (s.url !== url) onSubmit(s.url);
                          else onReload();
                        }}
                        className="group"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{savedUrlLabel(s)}</span>
                          {s.alias?.trim() ? (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {s.url}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          title="Rename"
                          className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAliasDraft(s.alias ?? "");
                            setRenamingId(s.id);
                          }}
                        >
                          <HugeiconsIcon
                            icon={PencilEdit02Icon}
                            size={12}
                            strokeWidth={1.75}
                          />
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void deleteSavedUrl(s.id).then(setSavedUrls);
                          }}
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            size={12}
                            strokeWidth={1.75}
                          />
                        </button>
                      </DropdownMenuItem>
                    ),
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("terax:ai-ask-preview"))
            }
            title="Ask Jonathan about the highlighted text"
            className="h-7 shrink-0 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={AiChat02Icon} size={13} strokeWidth={1.75} />
            <span className="hidden sm:inline">Ask Jonathan</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onSnip}
            disabled={snipDisabled}
            title="Snip a region of this page"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={CropIcon} size={14} strokeWidth={1.75} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (url) void openUrl(url).catch(console.error);
            }}
            title="Open in system browser"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            disabled={!url}
          >
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              size={14}
              strokeWidth={1.75}
            />
          </Button>
        </div>
        {notice ? (
          <div className="flex items-center gap-1.5 bg-amber-500/8 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400">
            <span className="truncate">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="ml-auto rounded px-1 text-[10px] opacity-80 hover:bg-accent hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    );
  },
);

async function probeUrl(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(900),
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A space can never appear in a URL, so multi-word input is unambiguously
  // a search query — skip the domain-like check below entirely. Otherwise
  // something like "node.js tutorial" would match as a "domain" (the regex
  // only needs to match a prefix) and try to navigate to a broken URL with a
  // literal space in it instead of searching.
  if (!/\s/.test(trimmed)) {
    if (/^localhost(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`;
    if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed))
      return `http://${trimmed}`;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  }
  // Anything else isn't a URL we can recognize — treat it as a Google search,
  // same as typing into a browser's combined address/search bar.
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
