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
});
