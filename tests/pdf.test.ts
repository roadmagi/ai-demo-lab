import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdf, normalizeWhitespace, PdfError } from "@/lib/pdf";

describe("normalizeWhitespace", () => {
  it("collapses runs of spaces, tabs, and newlines into single spaces", () => {
    expect(normalizeWhitespace("Total:    $1,296.00")).toBe("Total: $1,296.00");
    expect(normalizeWhitespace("Vendor:\n\tPetrichor")).toBe("Vendor: Petrichor");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  padded  ")).toBe("padded");
  });

  it("leaves already-normal text untouched", () => {
    expect(normalizeWhitespace("Invoice A-1042")).toBe("Invoice A-1042");
  });

  it("handles non-breaking spaces, which PDFs emit freely", () => {
    expect(normalizeWhitespace("Total:\u00a0$99")).toBe("Total: $99");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeWhitespace("  \n\t ")).toBe("");
  });
});

describe("extractPdf", () => {
  it("rejects bytes that are not a PDF", async () => {
    await expect(extractPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(PdfError);
  });

  it("reports the corrupt code so the route can pick a status", async () => {
    await expect(extractPdf(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "corrupt",
    });
  });

  it("leaves the caller's bytes intact", async () => {
    // pdf.js transfers the buffer to its worker, which detaches it. Without a
    // defensive copy the caller is left holding a zero-length array — and the
    // route needs these same bytes afterwards to send the PDF to the model.
    // The symptom is a 400 "PDF cannot be empty" nowhere near the cause.
    const bytes = new Uint8Array(readFileSync("content/invoices/clean.pdf"));
    const before = bytes.length;

    await extractPdf(bytes);

    expect(bytes.length).toBe(before);
  });
});

describe("bundled samples", () => {
  const read = (name: string) =>
    new Uint8Array(readFileSync(`content/invoices/${name}.pdf`));

  for (const name of ["clean", "bad-total", "inferred-field"]) {
    it(`extracts text from ${name}.pdf`, async () => {
      const { text, pages } = await extractPdf(read(name));

      expect(pages).toBe(1);
      expect(text.length).toBeGreaterThan(100);
    });
  }

  it("keeps the deliberately wrong total in bad-total.pdf", async () => {
    const { text } = await extractPdf(read("bad-total"));

    // If this sample is ever "corrected", the demo's best moment dies
    // silently — the arithmetic check would have nothing to catch.
    expect(text).toContain("1,428.00");
    expect(text).toContain("1,200.00");
    expect(text).toContain("96.00");
  });

  it("prints no due date in inferred-field.pdf", async () => {
    const { text } = await extractPdf(read("inferred-field"));

    // The due date is inferable from "Net 30" but never printed, so any
    // quote the model offers for it must fail verification.
    expect(text).toContain("Net 30");
    expect(text).not.toContain("Due 2026");
  });
});
