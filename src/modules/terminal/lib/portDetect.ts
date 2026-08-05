import { useSyncExternalStore } from "react";

/**
 * Scans live PTY output for printed localhost dev-server URLs (e.g. Vite's
 * `Local: http://localhost:5173/`), confirms the port is actually listening
 * with a no-cors probe, and surfaces a dismissable chip the user can click to
 * open the URL in a Preview tab. Detection is driven entirely by *terminal
 * output* — no port scanning — so a chip only ever maps to a server the running
 * command itself announced.
 */

export type PortDetection = {
  /** Normalized origin (scheme + host + port), used as the dedupe key. */
  url: string;
  /** host:port, for the chip label. */
  host: string;
  port: number;
  /** Leaf that printed it — chips are cleared when the leaf is disposed. */
  leafId: number;
  ts: number;
};

// --- store ---------------------------------------------------------------

const MAX_CHIPS = 5;
let detections: PortDetection[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): PortDetection[] {
  return detections;
}

function addDetection(d: PortDetection): void {
  if (detections.some((x) => x.url === d.url)) return;
  detections = [d, ...detections].slice(0, MAX_CHIPS);
  emit();
}

export function dismissDetection(url: string): void {
  const next = detections.filter((d) => d.url !== url);
  if (next.length === detections.length) return;
  detections = next;
  emit();
}

export function clearLeafDetections(leafId: number): void {
  const next = detections.filter((d) => d.leafId !== leafId);
  if (next.length === detections.length) return;
  detections = next;
  emit();
}

export function usePortDetections(): PortDetection[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// --- scanning ------------------------------------------------------------

// http(s) URL whose host is a loopback alias. Trailing path/query is captured
// loosely and trimmed by `new URL`. Bare `localhost:3000` (no scheme) is
// intentionally ignored to keep false positives down.
const LOCAL_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:[/?#][^\s"'`<>]*)?/gi;

// Strips CSI / OSC / charset escape sequences so a URL split across colored
// spans (Vite prints the port in a different SGR color) still matches.
const ANSI_RE =
  /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[78=>]|\x1bc|\x1b[NOP\]X^_]/g;

const PROBE_COOLDOWN_MS = 15_000;
const TAIL_MAX = 8 * 1024;

const decoders = new Map<number, TextDecoder>();
const tails = new Map<number, string>();
// origin -> last time we probed it, so re-printed banners don't re-probe (or
// resurrect a chip the user just dismissed) on every prompt repaint.
const lastProbe = new Map<string, number>();

function normalize(raw: string): { url: string; host: string; port: number } | null {
  try {
    const u = new URL(raw);
    const port = u.port
      ? Number(u.port)
      : u.protocol === "https:"
        ? 443
        : 80;
    return { url: u.origin, host: u.host, port };
  } catch {
    return null;
  }
}

async function probe(url: string): Promise<boolean> {
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

function consider(leafId: number, raw: string): void {
  const hit = normalize(raw);
  if (!hit) return;
  const now = Date.now();
  const last = lastProbe.get(hit.url) ?? 0;
  if (now - last < PROBE_COOLDOWN_MS) return;
  lastProbe.set(hit.url, now);
  if (detections.some((d) => d.url === hit.url)) return;
  void probe(hit.url).then((alive) => {
    if (!alive) return;
    addDetection({ url: hit.url, host: hit.host, port: hit.port, leafId, ts: Date.now() });
  });
}

/**
 * Feed a raw PTY byte chunk for a leaf. Decodes incrementally (chunks split
 * mid-UTF-8 / mid-line), strips ANSI, and probes any loopback URL found on a
 * completed line. Cheap-exits when the chunk can't contain a URL.
 */
export function scanPtyChunk(leafId: number, bytes: Uint8Array): void {
  let dec = decoders.get(leafId);
  if (!dec) {
    dec = new TextDecoder("utf-8");
    decoders.set(leafId, dec);
  }
  const text = dec.decode(bytes, { stream: true });
  if (!text) return;

  let buf = (tails.get(leafId) ?? "") + text;
  const nl = buf.lastIndexOf("\n");
  if (nl === -1) {
    // No complete line yet — keep accumulating, but bound the tail so a
    // newline-less stream (progress bar, TUI) can't grow without limit.
    if (buf.length > TAIL_MAX) buf = buf.slice(-TAIL_MAX);
    tails.set(leafId, buf);
    return;
  }

  const complete = buf.slice(0, nl);
  let rest = buf.slice(nl + 1);
  if (rest.length > TAIL_MAX) rest = rest.slice(-TAIL_MAX);
  tails.set(leafId, rest);

  if (
    !complete.includes("http://") &&
    !complete.includes("https://")
  ) {
    return;
  }
  const clean = complete.replace(ANSI_RE, "");
  const matches = clean.match(LOCAL_URL_RE);
  if (!matches) return;
  for (const m of matches) consider(leafId, m);
}

export function disposePortScan(leafId: number): void {
  decoders.delete(leafId);
  tails.delete(leafId);
}
