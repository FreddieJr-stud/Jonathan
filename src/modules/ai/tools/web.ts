import { invoke } from "@tauri-apps/api/core";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

const FETCH_CHAR_CAP = 25 * 1024;
// Cap the bytes we decode so a giant response can't freeze the renderer.
const MAX_BYTES = 4 * 1024 * 1024;
// The shared HTTP client has no overall request timeout (it's reused by the
// streaming LLM proxy, which must run long), so guard the fetch here instead.
const FETCH_TIMEOUT_MS = 25_000;

// Shape of the backend `ai_http_request` command (net.rs). `body` is the raw
// response bytes, serialized as a number[] across the IPC boundary.
type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: number[];
};

/** Best-effort HTML → readable text. Drops scripts/styles/comments, turns block
 * closers into newlines, strips remaining tags, and decodes the few entities
 * that matter for prose. Good enough to feed a page as model context. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|pre)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function buildWebTools(_ctx: ToolContext) {
  return {
    fetch_url: tool({
      description:
        "Fetch a public web page or HTTP(S) API endpoint and return its readable text. HTML is stripped to text; JSON / plain text is returned as-is. Use this when you need the live content of a URL — e.g. to read more of the page open in the Preview tab than the user pasted. Reaches only PUBLIC, unauthenticated content (the Preview tab's logged-in session is not shared, and private/loopback hosts are blocked). Large bodies are windowed by CHARACTER position: `offset`/`limit` are character positions, not lines. Defaults to the first 25KB.",
      inputSchema: z.object({
        url: z.string().describe("Absolute http(s) URL."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("0-based start character. Default 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Max characters to return. Default 25600."),
      }),
      execute: async ({ url, offset, limit }) => {
        const clean = url
          .trim()
          .replace(/^["'`]+|["'`]+$/g, "")
          .trim();
        if (!/^https?:\/\//i.test(clean)) {
          return {
            error: "url must start with http:// or https://",
            url: clean,
          };
        }
        try {
          const resp = await Promise.race([
            invoke<HttpResponse>("ai_http_request", {
              url: clean,
              method: "GET",
              headers: {
                Accept:
                  "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(new Error(`timed out after ${FETCH_TIMEOUT_MS}ms`)),
                FETCH_TIMEOUT_MS,
              ),
            ),
          ]);
          const body =
            resp.body.length > MAX_BYTES
              ? resp.body.slice(0, MAX_BYTES)
              : resp.body;
          const bytes = new Uint8Array(body);
          const ctype = (resp.headers["content-type"] ?? "").toLowerCase();
          const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          const text = ctype.includes("html") ? htmlToText(raw) : raw.trim();
          if (resp.status >= 400) {
            return {
              url: clean,
              status: resp.status,
              error:
                resp.status === 403 || resp.status === 429
                  ? `server returned ${resp.status} (blocked or rate-limited). Don't retry the same URL repeatedly; answer from the excerpt and your own knowledge instead.`
                  : `server returned ${resp.status}`,
              content: text.slice(0, 2000),
            };
          }
          const total = text.length;
          const start = offset ?? 0;
          const content = text.slice(start, start + (limit ?? FETCH_CHAR_CAP));
          const truncated = start + content.length < total;
          return {
            url: clean,
            status: resp.status,
            content_type: ctype || undefined,
            total_chars: total,
            start_char: start,
            content,
            ...(truncated
              ? {
                  truncated: true,
                  hint: "call fetch_url with a higher offset to continue",
                }
              : {}),
          };
        } catch (e) {
          return { error: String(e), url: clean };
        }
      },
    }),
  };
}
