# Testing the preview "stays painted on top" races

Two bugs, one root cause. `preview_open` is async and `add_child` creates the
child webview **visible**, while `preview_hide` (`preview.rs:502`) and
`preview_close` (`preview.rs:541`) both **no-op when the webview does not exist
yet**. Anything issued during the create is silently dropped:

| During the create you… | Dropped call | Result |
|---|---|---|
| switch tab / space | `preview_hide` | webview appears visible over the app; nothing re-runs the visibility effect (`createdRef` is a ref → no render; `visible`/`suppressed`/`url` unchanged) |
| close the tab / switch space (unmount) | `preview_close` | **orphan** webview with no React owner left — only an app restart clears it |

Fix: `PreviewPane`'s `openWebview` re-decides once the create resolves, and
closes the orphan if the pane was disposed meanwhile.

## 1. Automated — behavioral (the real proof)

```
pnpm vitest run src/modules/preview
```

`PreviewPane.race.test.tsx` makes `previewOpen` a deferred the test resolves by
hand, so the ordering is exact rather than lucky. Covers: hide-during-create,
show-when-still-active (the mirror case — re-applying must not blanket-hide a
pane the user is looking at), close-during-create, and rollback on create
rejection.

Needs `jsdom` + `@testing-library/react` (added as devDeps). The environment is
set per file via `// @vitest-environment jsdom`, so the rest of the suite keeps
running in node.

**Verified to bite:** with the `.then()` body removed, 5 tests fail — 3 in
`PreviewPane.race.test.tsx`, 2 in `PreviewPane.test.ts`. A green run is
meaningful only because a red run was demonstrated.

## 2. Automated — source level

`PreviewPane.test.ts` pins the same invariants textually, in the style the file
already used. It cannot prove ordering, but it catches a refactor quietly
dropping the `.then()`, and it fails loudly if the backend no-ops that make the
race possible ever change.

## 3. Manual — deterministic repro

The real create window is a few hundred milliseconds, so clicking only hits the
bug by luck. `TERAX_PREVIEW_OPEN_DELAY_MS` widens it on demand:

```powershell
$env:TERAX_PREVIEW_OPEN_DELAY_MS = "3000"
pnpm dev:agent-browser
```

Each of these, three times — the pane must end up **hidden or destroyed**, never
floating:

1. Open a Preview tab → `Ctrl+Tab` to another tab within 3s.
2. Open a Preview tab → switch space within 3s.
3. Open a Preview tab → close it within 3s (this is the orphan case; a failure
   here survives every later tab and space switch).

To confirm the repro is real, stash the `PreviewPane.tsx` fix and repeat — all
three must fail.

## 4. Agent-driven soak

With `pnpm dev:agent-browser` running and `TERAX_PREVIEW_OPEN_DELAY_MS` set,
from a terax terminal tab ask the agent to hammer the sequence via the Phase 2
tools:

> Using terax-preview, repeat 10 times: `preview_open_tab` on https://example.com,
> then immediately `preview_focus_tab` on a different tab, then `preview_close_tab`
> the one you opened. Then `preview_list_tabs` and report anything left behind.

Exercises the race and the Phase 2 MCP surface together. Note the agent cannot
see a stuck native layer — it can only report tab bookkeeping, so judge the
visual outcome yourself. Timing is still luck-based without the delay env var.
