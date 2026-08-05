// Stages pdf.js runtime assets into `public/pdfjs/` so they are served at
// `/pdfjs/**` in dev and bundled into `dist/` for release.
//
// pdf.js v6 loads these lazily at runtime from *base directory* URLs it is told
// about via API options (`${wasmUrl}openjpeg.wasm`, and so on). That rules out
// `?url` imports, which produce one hashed file URL rather than a directory —
// the files have to exist under a real, predictable path.
//
// Without them pdf.js degrades silently rather than throwing: JPEG 2000 images
// (common in papers exported from LaTeX/Word) fail to decode while the page's
// text renders fine, and the only clue is a console `warn`. See PdfView.tsx for
// the consuming side and the full failure chain.
//
// Copied rather than committed so the assets always match the installed
// pdfjs-dist; `public/pdfjs/` is gitignored. A version stamp makes re-runs
// cheap, so chaining this into `dev`/`build` costs nothing after the first run.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "public", "pdfjs");
const stamp = path.join(dest, ".version");

// wasm: openjpeg (JPEG 2000) and jbig2 image decoders, plus qcms for ICC color.
// The `*_nowasm_fallback.js` files live here too and are resolved against the
// same base URL, so this directory is required even where wasm is unavailable.
// iccs: the CMYK profile. cmaps + standard_fonts: CJK and non-embedded fonts.
const DIRS = ["wasm", "iccs", "cmaps", "standard_fonts"];

const pkgPath = require.resolve("pdfjs-dist/package.json");
const src = path.dirname(pkgPath);
const version = require(pkgPath).version;

const current = await fs.readFile(stamp, "utf8").catch(() => null);
if (current === version) {
  console.log(`pdfjs assets up to date (${version})`);
  process.exit(0);
}

await fs.rm(dest, { recursive: true, force: true });
await fs.mkdir(dest, { recursive: true });

for (const dir of DIRS) {
  const from = path.join(src, dir);
  if (!(await fs.stat(from).catch(() => null))) {
    // A missing directory means the upstream layout moved; failing loudly here
    // beats shipping a build whose PDFs quietly lose their images.
    console.error(`pdfjs-dist has no "${dir}/" — expected at ${from}`);
    process.exit(1);
  }
  await fs.cp(from, path.join(dest, dir), { recursive: true });
}

await fs.writeFile(stamp, version);
console.log(`copied pdfjs assets (${version}): ${DIRS.join(", ")}`);
