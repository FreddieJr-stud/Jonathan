import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

/**
 * explorerRoot tracks the last-seen terminal cwd per space (not globally) so
 * switching spaces doesn't leak one space's working directory into another's
 * title bar / file explorer. New tabs, by contrast, always land on the
 * space's own `root` — Ctrl+T is a "go back to base" action, not "follow
 * wherever this terminal cd'd to".
 */
export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  activeSpaceId: string | null,
  activeSpaceRoot: string | null,
): Result {
  const lastTerminalCwdBySpace = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwdBySpace.current.set(activeTab.spaceId, activeTab.cwd);
    }
  }, [activeTab]);

  const explorerRoot = useMemo<string | null>(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    if (activeSpaceId) {
      const last = lastTerminalCwdBySpace.current.get(activeSpaceId);
      if (last) return last;
      const anyTerm = tabs.find(
        (t) => t.kind === "terminal" && t.spaceId === activeSpaceId && t.cwd,
      );
      if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    }
    return activeSpaceRoot ?? home;
  }, [activeTab, activeSpaceId, tabs, activeSpaceRoot, home]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    return activeSpaceRoot ?? home ?? undefined;
  }, [activeSpaceRoot, home]);

  return { explorerRoot, inheritedCwdForNewTab };
}
