import { describe, expect, it } from "vitest";
import { localPdfPath } from "./localPdf";

describe("localPdfPath", () => {
  it("strips the leading slash from a Windows drive path", () => {
    expect(localPdfPath("file:///C:/Users/frpag/Downloads/a.pdf")).toBe(
      "C:/Users/frpag/Downloads/a.pdf",
    );
  });

  it("keeps POSIX paths absolute", () => {
    expect(localPdfPath("file:///home/f/a.pdf")).toBe("/home/f/a.pdf");
  });

  it("decodes percent-encoded segments", () => {
    expect(localPdfPath("file:///C:/My%20Docs/phd%20paper.pdf")).toBe(
      "C:/My Docs/phd paper.pdf",
    );
  });

  it("matches the extension case-insensitively", () => {
    expect(localPdfPath("file:///C:/a.PDF")).toBe("C:/a.PDF");
  });

  it("ignores a query or fragment when matching the extension", () => {
    expect(localPdfPath("file:///C:/a.pdf?x=1#page=2")).toBe("C:/a.pdf");
  });

  it("rejects non-file schemes, including a remote PDF", () => {
    expect(localPdfPath("https://example.com/a.pdf")).toBeNull();
    expect(localPdfPath("http://localhost:1420/a.pdf")).toBeNull();
  });

  it("rejects local files that are not PDFs", () => {
    expect(localPdfPath("file:///C:/a.html")).toBeNull();
    expect(localPdfPath("file:///C:/pdf")).toBeNull();
  });

  it("rejects empty and malformed input", () => {
    expect(localPdfPath("")).toBeNull();
    expect(localPdfPath("not a url")).toBeNull();
  });
});
