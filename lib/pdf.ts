import { extractText, getDocumentProxy } from "unpdf";

/**
 * Collapses every run of whitespace to a single space.
 *
 * PDF text extraction linearises tables and columns, so the spacing in the
 * extracted text will not match what the model quotes from the rendered page.
 * Normalising both sides absorbs that difference without weakening the check —
 * the words and their order still have to be present.
 *
 * The non-breaking space is named explicitly even though `\s` already covers
 * it: PDFs emit it constantly, and spelling it out keeps a future edit to this
 * character class from dropping it by accident.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

export type PdfErrorCode = "encrypted" | "corrupt" | "no_text";

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfError";
  }
}

/**
 * Returns the document's text already normalised. Callers treat this as the
 * canonical text: it is what the client renders and what quote spans index
 * into, so there is only ever one representation to reason about.
 */
export async function extractPdf(
  bytes: Uint8Array,
): Promise<{ text: string; pages: number }> {
  let raw: string;
  let pages: number;

  try {
    // pdf.js transfers the buffer to its worker, which detaches it and leaves
    // the caller holding a zero-length array. The route needs these same bytes
    // afterwards to send the PDF to the model, and the resulting failure — a
    // 400 "PDF cannot be empty" — points nowhere near this line. Copy first.
    const doc = await getDocumentProxy(bytes.slice());
    const result = await extractText(doc, { mergePages: true });
    raw = result.text;
    pages = result.totalPages;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypt/i.test(message)) {
      throw new PdfError("encrypted", "That PDF is password protected.");
    }
    throw new PdfError("corrupt", "That file could not be read as a PDF.");
  }

  const text = normalizeWhitespace(raw);
  if (!text) {
    // Almost always a scan. Images inside PDFs can't be read as text, so this
    // is a real limitation rather than a failure, and should read like one.
    throw new PdfError(
      "no_text",
      "That PDF has no extractable text — it looks like a scan. This demo reads text-based PDFs.",
    );
  }

  return { text, pages };
}
