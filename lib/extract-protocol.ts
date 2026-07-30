import type { VerifiedInvoice } from "./verify";

export type ExtractEvent =
  /** Extraction takes long enough that silence reads as a hang. */
  | { type: "stage"; stage: "reading" | "extracting" | "verifying" }
  | { type: "result"; invoice: VerifiedInvoice; text: string; cached: boolean }
  | {
      type: "notice";
      kind: "rate_limited" | "budget_exhausted" | "error";
      message: string;
    };

/**
 * Cached under a hash of the PDF bytes. Holds only the verified result and the
 * extracted text needed to highlight it — never the PDF itself.
 */
export type CachedExtraction = {
  invoice: VerifiedInvoice;
  text: string;
};
