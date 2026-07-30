# `/extract` — Invoice Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/extract`, a demo that pulls structured data out of a PDF invoice and proves every field against the document text and its own arithmetic.

**Architecture:** One Claude call per document carrying a strict tool whose schema requires a verbatim `quote` beside every value. The server extracts the PDF's text locally, confirms each quote appears in it, computes character spans itself, and independently reconciles the arithmetic. Fields failing either check route to an inline review queue. Nothing uploaded is persisted.

**Tech Stack:** Next 16.2.12 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · vitest · `@anthropic-ai/sdk` · a PDF text-extraction library chosen in Task 1.

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing route or page code.** Next 16 differs from training data.
- **Model:** `claude-opus-5`, via `getClient()` from `lib/anthropic.ts`. Never construct `new Anthropic()` elsewhere.
- **Citations must stay OFF** on the extract path. `citations: {enabled: true}` + `output_config.format` is a hard 400: `"Citations cannot be enabled when output format is set."` The schema travels as a **strict tool**, not `output_config.format`.
- **Post-response bookkeeping goes through `after()`** from `next/server`. Work scheduled after `controller.close()` races the serverless freeze and loses silently.
- **Rate limit / budget exhaustion return HTTP 200 with a `notice` SSE event**, never 4xx. Validation failures (bad file, too large) *do* return real status codes.
- **Never persist uploaded PDFs, their text, or extraction results** to Redis or disk beyond the response cache, which is keyed on a hash of the bytes and stores only the verified result.
- **Hard limits:** reject > 5 MB or > 10 pages. API ceilings are 32 MB / 600 pages; ours are deliberately far below.
- **Rate limit bucket:** `"extract"`, 5 per visitor per hour.
- **TDD:** write the failing test, run it, watch it fail, then implement. Every task commits.
- **`npm test` and `npm run lint` must pass before any commit.**
- **All work happens on the `demo-2-extract` branch.** Never push to `main`; it deploys to production.
- **`lib/invoice.ts` stays free of server-only imports** (no `node:`, store, or Anthropic). The client imports `reconcile` from it, so one implementation of the arithmetic serves both sides.
- **`vitest` is configured for `tests/**/*.test.ts` in a `node` environment.** There is no component-test infrastructure in this repo and no existing component tests; `.tsx` files are outside the test glob.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/pdf.ts` | PDF bytes → `{ text, pages }`; whitespace normalisation shared by document and quote |
| `lib/invoice.ts` | `Invoice` types, the tool schema, arithmetic reconciliation |
| `lib/verify.ts` | Quote → span resolution; flattening a raw `Invoice` into `VerifiedInvoice` |
| `lib/extract-protocol.ts` | `ExtractEvent` union, `CachedExtraction` |
| `lib/protocol.ts` | *Modify:* widen `encodeEvent` / `createEventParser` to a type parameter |
| `lib/guard.ts` | *Modify:* add `recordExtraction`, sibling to `recordTurn` |
| `app/api/extract/route.ts` | Intake, validation, guards, model call, SSE |
| `app/extract/page.tsx` | Server component listing bundled samples |
| `components/ExtractWorkbench.tsx` | Upload, table, flags, inline correction, export |
| `components/InvoicePane.tsx` | Extracted text with quote spans highlighted |
| `content/invoices/*.pdf` | Three bundled samples |
| `assets/invoices/*.html` | Editable sources for those samples |

---

### Task 1: Validate a PDF library on deployed Vercel

No production code depends on this until it passes. A library that works locally but not on Vercel's runtime would invalidate the route, verification layer, and tests together — so this is settled first, in the environment that actually matters.

**Files:**
- Create: `app/api/pdf-spike/route.ts` (deleted at the end of this task)
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: a decision — the library name that works on deployed Vercel. Task 2 depends on it.

- [ ] **Step 1: Install the leading candidate**

`unpdf` is first choice because it explicitly targets serverless runtimes and ships without native bindings, which Vercel's Node runtime cannot load.

```bash
npm install unpdf
```

- [ ] **Step 2: Write a throwaway route that parses a PDF**

Create `app/api/pdf-spike/route.ts`:

```ts
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const doc = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(doc, { mergePages: true });
    return Response.json({
      ok: true,
      pages: totalPages,
      chars: text.length,
      head: text.slice(0, 200),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Verify it works locally first**

```bash
npm run dev
```

In a second terminal, using any PDF on disk:

```bash
curl -s -X POST http://localhost:3000/api/pdf-spike \
  --data-binary @path/to/any.pdf -H "Content-Type: application/pdf"
```

Expected: `{"ok":true,"pages":N,"chars":M,"head":"..."}` with `chars` > 0.

If this fails locally, stop and try `pdfjs-dist` (6.2.108), then `pdf-parse` (2.4.5), repeating Steps 2–3. Do not proceed on a library that fails here.

- [ ] **Step 4: Deploy and verify on Vercel — the step that actually matters**

All work happens on the `demo-2-extract` branch. Vercel preview-deploys branches
automatically, which exercises the same serverless runtime as production without
putting a debug endpoint on the live site.

```bash
git add -A && git commit -m "spike: probe PDF extraction on deployed runtime"
git push -u origin demo-2-extract
```

Get the preview URL from the push output or with `vercel ls`, then:

```bash
curl -s -X POST https://<preview-url>/api/pdf-spike \
  --data-binary @path/to/any.pdf -H "Content-Type: application/pdf"
```

If the preview is protected by Vercel SSO, the response will be an HTML login
page rather than JSON. **A 200 is not sufficient evidence here** — confirm the
body is the expected JSON. If SSO blocks it, disable deployment protection for
preview builds or use `vercel --prod=false` with a bypass token.

Expected: the same `{"ok":true,...}` shape with `chars` > 0.

A 500 here — bundling failure, missing worker file, native binding — means this library is unusable regardless of local success. Try the next candidate and repeat from Step 2.

- [ ] **Step 5: Record the outcome in the spec**

Replace the "Open question for implementation" section of `docs/superpowers/specs/2026-07-30-extract-design.md` with the resolved decision: which library, which version, and that it was verified on deployed Vercel with a page count and character count.

- [ ] **Step 6: Delete the spike route and commit**

```bash
rm app/api/pdf-spike/route.ts
git add -A
git commit -m "Confirm PDF extraction works on Vercel, remove spike"
git push origin demo-2-extract
```

The deployed check is the deliverable; the route itself is scaffolding.

---

### Task 2: `lib/pdf.ts` — text extraction and normalisation

**Files:**
- Create: `lib/pdf.ts`
- Test: `tests/pdf.test.ts`

**Interfaces:**
- Consumes: the library chosen in Task 1
- Produces:
  - `normalizeWhitespace(text: string): string`
  - `extractPdf(bytes: Uint8Array): Promise<{ text: string; pages: number }>`
  - `PdfError` with `code: "encrypted" | "corrupt" | "no_text"`

Normalisation is central to correctness, not cosmetic. PDF extraction linearises tables and columns, so runs of spaces and line breaks will not match what the model quotes. Normalising both sides absorbs that while still requiring the words and their order to be present.

The **normalised text is the canonical text**: it is what gets sent to the client, what spans index into, and what quotes are matched against. Keeping one representation removes an entire class of offset-mapping bugs.

- [ ] **Step 1: Write the failing test**

Create `tests/pdf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeWhitespace } from "@/lib/pdf";

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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/pdf.test.ts
```

Expected: FAIL — `normalizeWhitespace` is not exported from `@/lib/pdf`.

- [ ] **Step 3: Implement normalisation**

Create `lib/pdf.ts`:

```ts
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Collapses every run of whitespace to a single space.
 *
 * PDF text extraction linearises tables and columns, so the spacing in the
 * extracted text will not match what the model quotes from the rendered page.
 * Normalising both sides absorbs that difference without weakening the check —
 * the words and their order still have to be present.
 *
 * `\s` misses the non-breaking space, which PDFs emit constantly, so it is
 * matched explicitly.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}
```

- [ ] **Step 4: Run and confirm green**

```bash
npm test -- tests/pdf.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the extraction test**

Append to `tests/pdf.test.ts`:

```ts
import { PdfError, extractPdf } from "@/lib/pdf";

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
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npm test -- tests/pdf.test.ts
```

Expected: FAIL — `extractPdf` and `PdfError` are not exported.

- [ ] **Step 7: Implement extraction**

Append to `lib/pdf.ts`:

```ts
export type PdfErrorCode = "encrypted" | "corrupt" | "no_text";

export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode, message: string) {
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
    const doc = await getDocumentProxy(bytes);
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
```

- [ ] **Step 8: Run and confirm green**

```bash
npm test -- tests/pdf.test.ts
npm run lint
```

Expected: PASS, 7 tests. Lint clean.

- [ ] **Step 9: Commit**

```bash
git add lib/pdf.ts tests/pdf.test.ts package.json package-lock.json
git commit -m "Add PDF text extraction with shared whitespace normalisation"
```

---

### Task 3: `lib/invoice.ts` — schema and arithmetic reconciliation

**Files:**
- Create: `lib/invoice.ts`
- Test: `tests/invoice.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Field<T> = { value: T; quote: string }`
  - `type LineItem`, `type Invoice`
  - `INVOICE_TOOL` — the strict tool definition
  - `type ReconcileIssue = { code: ReconcileCode; message: string; paths: string[] }`
  - `reconcile(invoice: Invoice): ReconcileIssue[]`

This module is pure. No store, no network, no Anthropic import — which is why it carries the heaviest test coverage in the plan.

- [ ] **Step 1: Write the failing test**

Create `tests/invoice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type Invoice, reconcile } from "@/lib/invoice";

const f = <T>(value: T) => ({ value, quote: String(value) });

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    vendor: f("Petrichor Systems"),
    invoiceNumber: f("A-1042"),
    issueDate: f("2026-07-01"),
    dueDate: f("2026-07-31"),
    currency: f("USD"),
    lineItems: [
      { description: f("Support retainer"), quantity: f(2), unitPrice: f(500), amount: f(1000) },
      { description: f("Onboarding"), quantity: f(1), unitPrice: f(200), amount: f(200) },
    ],
    subtotal: f(1200),
    tax: f(96),
    total: f(1296),
    ...overrides,
  };
}

describe("reconcile", () => {
  it("returns no issues when everything adds up", () => {
    expect(reconcile(invoice())).toEqual([]);
  });

  it("catches a line item whose amount is not quantity times unit price", () => {
    const broken = invoice({
      lineItems: [
        { description: f("Support retainer"), quantity: f(2), unitPrice: f(500), amount: f(900) },
        { description: f("Onboarding"), quantity: f(1), unitPrice: f(200), amount: f(200) },
      ],
      subtotal: f(1100),
      tax: f(88),
      total: f(1188),
    });
    const issues = reconcile(broken);
    expect(issues.map((i) => i.code)).toContain("line_item_amount");
    expect(issues[0].paths).toContain("lineItems.0.amount");
  });

  it("catches line items that do not sum to the subtotal", () => {
    const issues = reconcile(invoice({ subtotal: f(1500), tax: f(120), total: f(1620) }));
    expect(issues.map((i) => i.code)).toContain("subtotal_mismatch");
  });

  it("flags every field in the failing relationship, since any could be wrong", () => {
    const issues = reconcile(invoice({ subtotal: f(1500), tax: f(120), total: f(1620) }));
    const subtotalIssue = issues.find((i) => i.code === "subtotal_mismatch")!;
    expect(subtotalIssue.paths).toContain("subtotal");
    expect(subtotalIssue.paths).toContain("lineItems.0.amount");
    expect(subtotalIssue.paths).toContain("lineItems.1.amount");
  });

  it("catches a total that is not subtotal plus tax", () => {
    const issues = reconcile(invoice({ total: f(1300) }));
    expect(issues.map((i) => i.code)).toContain("total_mismatch");
  });

  it("tolerates rounding within one minor unit", () => {
    // 0.005 of drift is a rounding artefact, not an extraction error.
    expect(reconcile(invoice({ total: f(1296.01) }))).toEqual([]);
  });

  it("does not tolerate drift beyond one minor unit", () => {
    expect(reconcile(invoice({ total: f(1296.05) })).map((i) => i.code)).toContain(
      "total_mismatch",
    );
  });

  it("treats an absent tax as zero rather than an error", () => {
    expect(reconcile(invoice({ tax: null, total: f(1200) }))).toEqual([]);
  });

  it("reports no subtotal issue when there are no line items to sum", () => {
    const issues = reconcile(invoice({ lineItems: [] }));
    expect(issues.map((i) => i.code)).not.toContain("subtotal_mismatch");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/invoice.test.ts
```

Expected: FAIL — `reconcile` is not exported from `@/lib/invoice`.

- [ ] **Step 3: Implement types and reconciliation**

Create `lib/invoice.ts`:

```ts
/**
 * Every extracted value travels with the verbatim text it came from. The quote
 * is what makes the value checkable: `lib/verify.ts` confirms it appears in the
 * document, and a quote that doesn't is a hard failure rather than a low score.
 */
export type Field<T> = { value: T; quote: string };

export type LineItem = {
  description: Field<string>;
  quantity: Field<number>;
  unitPrice: Field<number>;
  amount: Field<number>;
};

export type Invoice = {
  vendor: Field<string>;
  invoiceNumber: Field<string>;
  issueDate: Field<string>;
  dueDate: Field<string> | null;
  currency: Field<string>;
  lineItems: LineItem[];
  subtotal: Field<number>;
  tax: Field<number> | null;
  total: Field<number>;
};

export type ReconcileCode =
  | "line_item_amount"
  | "subtotal_mismatch"
  | "total_mismatch";

export type ReconcileIssue = {
  code: ReconcileCode;
  message: string;
  /** Dotted paths of every field implicated, e.g. "lineItems.0.amount". */
  paths: string[];
};

/** Money in minor units. Floating-point sums of currency drift; integers don't. */
const minor = (value: number) => Math.round(value * 100);

/** One minor unit of slack absorbs rounding without hiding real errors. */
const agrees = (a: number, b: number) => Math.abs(a - b) <= 1;

const money = (value: number) =>
  (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

/**
 * Checks the invoice against itself. Entirely independent of the model and of
 * the quotes — this is the second, unrelated signal, so a confident and
 * well-quoted wrong number still gets caught.
 */
export function reconcile(invoice: Invoice): ReconcileIssue[] {
  const issues: ReconcileIssue[] = [];

  invoice.lineItems.forEach((item, index) => {
    const expected = minor(item.quantity.value * item.unitPrice.value);
    const stated = minor(item.amount.value);
    if (!agrees(expected, stated)) {
      issues.push({
        code: "line_item_amount",
        message: `Line ${index + 1}: ${item.quantity.value} × ${money(minor(item.unitPrice.value))} is ${money(expected)}, but the line reads ${money(stated)}.`,
        paths: [
          `lineItems.${index}.quantity`,
          `lineItems.${index}.unitPrice`,
          `lineItems.${index}.amount`,
        ],
      });
    }
  });

  if (invoice.lineItems.length > 0) {
    const summed = invoice.lineItems.reduce(
      (total, item) => total + minor(item.amount.value),
      0,
    );
    const stated = minor(invoice.subtotal.value);
    if (!agrees(summed, stated)) {
      issues.push({
        code: "subtotal_mismatch",
        message: `The line items total ${money(summed)}, but the subtotal reads ${money(stated)}.`,
        // Any of these could be the wrong one, so a reviewer needs to see all.
        paths: [
          "subtotal",
          ...invoice.lineItems.map((_, index) => `lineItems.${index}.amount`),
        ],
      });
    }
  }

  const expectedTotal = minor(invoice.subtotal.value) + minor(invoice.tax?.value ?? 0);
  const statedTotal = minor(invoice.total.value);
  if (!agrees(expectedTotal, statedTotal)) {
    issues.push({
      code: "total_mismatch",
      message: `Subtotal plus tax is ${money(expectedTotal)}, but the total reads ${money(statedTotal)}.`,
      paths: invoice.tax ? ["subtotal", "tax", "total"] : ["subtotal", "total"],
    });
  }

  return issues;
}
```

- [ ] **Step 4: Run and confirm green**

```bash
npm test -- tests/invoice.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Add the tool definition**

Append to `lib/invoice.ts`. Schema constraints from the structured-outputs docs: `additionalProperties` must be `false`, no recursive schemas, and numeric bounds like `minimum` are unsupported — range checks belong in `reconcile`, not here.

```ts
const field = (type: "string" | "number", description: string) => ({
  type: "object" as const,
  properties: {
    value: { type, description },
    quote: {
      type: "string",
      description:
        "The exact text from the document this value was read from, copied verbatim including punctuation and currency symbols. Never paraphrase or reconstruct it.",
    },
  },
  required: ["value", "quote"],
  additionalProperties: false,
});

/**
 * Carried as a strict tool rather than `output_config.format`. Both enforce the
 * schema, but citations are a hard 400 alongside `output_config.format`, and
 * the tool form leaves room to add a cited prose pass later without
 * restructuring the call.
 */
export const INVOICE_TOOL = {
  name: "record_invoice",
  description: "Record every field extracted from the invoice, with the verbatim source text for each.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      vendor: field("string", "The company issuing the invoice."),
      invoiceNumber: field("string", "The invoice's own identifier."),
      issueDate: field("string", "Date of issue, as ISO 8601 (YYYY-MM-DD)."),
      dueDate: field("string", "Payment due date as ISO 8601, or null if absent."),
      currency: field("string", "ISO 4217 code, e.g. USD."),
      lineItems: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            description: field("string", "What the line is for."),
            quantity: field("number", "Units billed."),
            unitPrice: field("number", "Price per unit."),
            amount: field("number", "Line total as printed."),
          },
          required: ["description", "quantity", "unitPrice", "amount"],
          additionalProperties: false,
        },
      },
      subtotal: field("number", "Total before tax, as printed."),
      tax: field("number", "Tax charged, or null if none is shown."),
      total: field("number", "Amount payable, as printed."),
    },
    required: [
      "vendor", "invoiceNumber", "issueDate", "dueDate", "currency",
      "lineItems", "subtotal", "tax", "total",
    ],
    additionalProperties: false,
  },
} as const;

export const EXTRACT_SYSTEM_PROMPT = `You extract structured data from invoices.

Record every value exactly as printed. Do not compute, correct, or reconcile
anything — if the document's own arithmetic is wrong, record what it says. A
separate check catches those errors, and silently fixing them hides the problem
the reader needs to see.

Every quote must be copied verbatim from the document. If a value is not
printed and you had to infer it, quote the closest supporting text rather than
inventing one.`;
```

The "do not correct the arithmetic" instruction is load-bearing: a model that helpfully fixes a bad total defeats the demo's entire point.

- [ ] **Step 6: Run the full suite and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, lint clean.

- [ ] **Step 7: Commit**

```bash
git add lib/invoice.ts tests/invoice.test.ts
git commit -m "Add invoice schema and arithmetic reconciliation"
```

---

### Task 4: `lib/verify.ts` — quote resolution

**Files:**
- Create: `lib/verify.ts`
- Test: `tests/verify.test.ts`

**Interfaces:**
- Consumes: `normalizeWhitespace` (Task 2); `Invoice`, `ReconcileIssue`, `reconcile` (Task 3)
- Produces:
  - `locateQuote(text: string, quote: string): { start: number; end: number } | null`
  - `type VerifiedField = { path, label, value, quote, span, issues }`
  - `type VerifiedInvoice = { fields: VerifiedField[]; issues: ReconcileIssue[]; currency: string }`
  - `verifyInvoice(invoice: Invoice, text: string): VerifiedInvoice`
  - `unflatten(fields: VerifiedField[], currency: string): Invoice`

Flat over nested, deliberately: a flat `fields` array is what the table renders, what inline editing mutates, and what the CSV writes. Nesting would force all three to walk the same tree.

- [ ] **Step 1: Write the failing test**

Create `tests/verify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { locateQuote } from "@/lib/verify";

const TEXT = "INVOICE A-1042 Vendor: Petrichor Systems Subtotal: $1,200.00 Total: $1,296.00";

describe("locateQuote", () => {
  it("locates an exact quote and returns its span", () => {
    expect(locateQuote(TEXT, "Petrichor Systems")).toEqual({ start: 23, end: 40 });
  });

  it("matches across differences in whitespace", () => {
    // The model quotes the rendered page; extraction linearises it. Spacing
    // will differ, and that alone must not fail a field.
    expect(locateQuote(TEXT, "Vendor:    Petrichor\n Systems")).toEqual({
      start: 15,
      end: 40,
    });
  });

  it("returns null when the quote is not in the document", () => {
    expect(locateQuote(TEXT, "Acme Corporation")).toBeNull();
  });

  it("returns null for an empty quote rather than matching at zero", () => {
    expect(locateQuote(TEXT, "")).toBeNull();
    expect(locateQuote(TEXT, "   ")).toBeNull();
  });

  it("takes the first occurrence when a quote repeats", () => {
    expect(locateQuote("$99 and $99", "$99")).toEqual({ start: 0, end: 3 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/verify.test.ts
```

Expected: FAIL — `locateQuote` is not exported from `@/lib/verify`.

- [ ] **Step 3: Implement quote location**

Create `lib/verify.ts`:

```ts
import type { Invoice, ReconcileIssue } from "./invoice";
import { reconcile } from "./invoice";
import { normalizeWhitespace } from "./pdf";

/**
 * Finds a quote in the document and returns its character span.
 *
 * `text` is expected to be already normalised (see `extractPdf`), so spans
 * index directly into what the client renders. The quote is normalised here
 * because it arrives straight from the model.
 *
 * A null return is the whole point of this function: it means the model
 * produced text that is not in the document, which is a hard failure rather
 * than a low confidence score.
 */
export function locateQuote(
  text: string,
  quote: string,
): { start: number; end: number } | null {
  const needle = normalizeWhitespace(quote);
  if (!needle) return null;

  const start = text.indexOf(needle);
  if (start === -1) return null;

  return { start, end: start + needle.length };
}
```

- [ ] **Step 4: Run and confirm green**

```bash
npm test -- tests/verify.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the flattening test**

Append to `tests/verify.test.ts`:

```ts
import { type Invoice, } from "@/lib/invoice";
import { verifyInvoice } from "@/lib/verify";

const q = <T>(value: T, quote: string) => ({ value, quote });

const DOC =
  "Petrichor Systems Invoice A-1042 Issued 2026-07-01 Due 2026-07-31 USD " +
  "Support retainer 2 500.00 1000.00 Onboarding 1 200.00 200.00 " +
  "Subtotal 1200.00 Tax 96.00 Total 1296.00";

function sample(overrides: Partial<Invoice> = {}): Invoice {
  return {
    vendor: q("Petrichor Systems", "Petrichor Systems"),
    invoiceNumber: q("A-1042", "Invoice A-1042"),
    issueDate: q("2026-07-01", "Issued 2026-07-01"),
    dueDate: q("2026-07-31", "Due 2026-07-31"),
    currency: q("USD", "USD"),
    lineItems: [
      { description: q("Support retainer", "Support retainer"), quantity: q(2, "2"),
        unitPrice: q(500, "500.00"), amount: q(1000, "1000.00") },
    ],
    subtotal: q(1200, "Subtotal 1200.00"),
    tax: q(96, "Tax 96.00"),
    total: q(1296, "Total 1296.00"),
    ...overrides,
  };
}

describe("verifyInvoice", () => {
  it("gives every field a span when all quotes are present", () => {
    const result = verifyInvoice(sample(), DOC);
    expect(result.fields.every((field) => field.span !== null)).toBe(true);
  });

  it("marks a field unverified when its quote is absent", () => {
    const result = verifyInvoice(
      sample({ vendor: q("Acme Corp", "Acme Corporation Ltd") }),
      DOC,
    );
    const vendor = result.fields.find((f) => f.path === "vendor")!;
    expect(vendor.span).toBeNull();
  });

  it("flattens line items to dotted paths", () => {
    const paths = verifyInvoice(sample(), DOC).fields.map((f) => f.path);
    expect(paths).toContain("lineItems.0.amount");
    expect(paths).toContain("total");
  });

  it("omits an absent optional field rather than emitting an empty row", () => {
    const paths = verifyInvoice(sample({ tax: null }), DOC).fields.map((f) => f.path);
    expect(paths).not.toContain("tax");
  });

  it("attaches reconciliation issues to every field they implicate", () => {
    const result = verifyInvoice(sample({ total: q(9999, "Total 1296.00") }), DOC);
    const total = result.fields.find((f) => f.path === "total")!;
    expect(total.issues).toContain("total_mismatch");
  });

  it("carries the reconciliation issues through for the summary banner", () => {
    const result = verifyInvoice(sample({ total: q(9999, "Total 1296.00") }), DOC);
    expect(result.issues.map((i) => i.code)).toContain("total_mismatch");
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npm test -- tests/verify.test.ts
```

Expected: FAIL — `verifyInvoice` is not exported.

- [ ] **Step 7: Implement flattening**

Append to `lib/verify.ts`:

```ts
export type VerifiedField = {
  /** Dotted path, matching `ReconcileIssue.paths`. */
  path: string;
  label: string;
  value: string | number;
  quote: string;
  /** Null means the quote was not found in the document. */
  span: { start: number; end: number } | null;
  /** Codes of every reconciliation issue implicating this field. */
  issues: string[];
};

export type VerifiedInvoice = {
  fields: VerifiedField[];
  issues: ReconcileIssue[];
  currency: string;
};

const LABELS: Record<string, string> = {
  vendor: "Vendor",
  invoiceNumber: "Invoice number",
  issueDate: "Issue date",
  dueDate: "Due date",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
};

const LINE_LABELS: Record<string, string> = {
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  amount: "Amount",
};

/**
 * Resolves every quote to a span and pairs each field with the reconciliation
 * issues that implicate it.
 *
 * The result is flat because all three consumers — the table, inline editing,
 * and CSV export — want a list. Nesting would make each of them walk the tree.
 */
export function verifyInvoice(invoice: Invoice, text: string): VerifiedInvoice {
  const issues = reconcile(invoice);
  const issuesFor = (path: string) =>
    issues.filter((issue) => issue.paths.includes(path)).map((issue) => issue.code);

  const fields: VerifiedField[] = [];

  const push = (
    path: string,
    label: string,
    field: { value: string | number; quote: string } | null,
  ) => {
    // An absent optional field is absent, not an empty row to review.
    if (!field) return;
    fields.push({
      path,
      label,
      value: field.value,
      quote: field.quote,
      span: locateQuote(text, field.quote),
      issues: issuesFor(path),
    });
  };

  for (const key of ["vendor", "invoiceNumber", "issueDate", "dueDate", "currency"] as const) {
    push(key, LABELS[key], invoice[key]);
  }

  invoice.lineItems.forEach((item, index) => {
    for (const key of ["description", "quantity", "unitPrice", "amount"] as const) {
      push(
        `lineItems.${index}.${key}`,
        `Line ${index + 1} — ${LINE_LABELS[key]}`,
        item[key],
      );
    }
  });

  push("subtotal", LABELS.subtotal, invoice.subtotal);
  push("tax", LABELS.tax, invoice.tax);
  push("total", LABELS.total, invoice.total);

  return { fields, issues, currency: invoice.currency.value };
}
```

- [ ] **Step 8: Write the failing test for `unflatten`**

The client holds the flat `VerifiedField[]` but needs to re-run reconciliation
after a correction. Rather than reimplementing the arithmetic client-side — two
implementations that must agree is a bug waiting to happen — it rebuilds an
`Invoice` and calls the same `reconcile`. `lib/invoice.ts` is pure TypeScript
with no server-only imports, so the client can import it directly.

Append to `tests/verify.test.ts`:

```ts
import { reconcile } from "@/lib/invoice";
import { unflatten } from "@/lib/verify";

describe("unflatten", () => {
  it("round-trips through verifyInvoice unchanged", () => {
    const original = sample();
    const { fields, currency } = verifyInvoice(original, DOC);

    expect(reconcile(unflatten(fields, currency))).toEqual(reconcile(original));
  });

  it("rebuilds line items in order", () => {
    const two = sample({
      lineItems: [
        { description: q("First", "First"), quantity: q(1, "1"),
          unitPrice: q(10, "10.00"), amount: q(10, "10.00") },
        { description: q("Second", "Second"), quantity: q(2, "2"),
          unitPrice: q(20, "20.00"), amount: q(40, "40.00") },
      ],
      subtotal: q(50, "Subtotal 50.00"),
      tax: null,
      total: q(50, "Total 50.00"),
    });
    const { fields, currency } = verifyInvoice(two, DOC);
    const rebuilt = unflatten(fields, currency);

    expect(rebuilt.lineItems).toHaveLength(2);
    expect(rebuilt.lineItems[1].description.value).toBe("Second");
  });

  it("preserves an absent tax as null rather than zero", () => {
    const { fields, currency } = verifyInvoice(sample({ tax: null }), DOC);

    expect(unflatten(fields, currency).tax).toBeNull();
  });

  it("reflects a corrected value, so reconciliation clears", () => {
    const wrong = sample({ total: q(9999, "Total 1296.00") });
    const { fields, currency } = verifyInvoice(wrong, DOC);
    expect(reconcile(unflatten(fields, currency))).not.toEqual([]);

    // The correction a reviewer would type into the flagged input.
    const corrected = fields.map((field) =>
      field.path === "total" ? { ...field, value: 1296 } : field,
    );

    expect(reconcile(unflatten(corrected, currency))).toEqual([]);
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

```bash
npm test -- tests/verify.test.ts
```

Expected: FAIL — `unflatten` is not exported.

- [ ] **Step 10: Implement `unflatten`**

Append to `lib/verify.ts`:

```ts
import type { Field, LineItem } from "./invoice";

/**
 * Rebuilds an `Invoice` from the flat field list.
 *
 * This exists so the client can re-run `reconcile` after a correction instead
 * of carrying its own copy of the arithmetic. One implementation, one place to
 * change, no invariant to document.
 */
export function unflatten(fields: VerifiedField[], currency: string): Invoice {
  const at = (path: string) => fields.find((field) => field.path === path);

  const asField = <T extends string | number>(path: string): Field<T> => {
    const found = at(path);
    // A missing required path means the field list was built by something
    // other than verifyInvoice; failing loudly beats a silent zero.
    if (!found) throw new Error(`unflatten: missing required field "${path}"`);
    return { value: found.value as T, quote: found.quote };
  };

  const optional = <T extends string | number>(path: string): Field<T> | null => {
    const found = at(path);
    return found ? { value: found.value as T, quote: found.quote } : null;
  };

  const indices = [
    ...new Set(
      fields
        .map((field) => /^lineItems\.(\d+)\./.exec(field.path)?.[1])
        .filter((index): index is string => index !== undefined),
    ),
  ].sort((a, b) => Number(a) - Number(b));

  const lineItems: LineItem[] = indices.map((index) => ({
    description: asField<string>(`lineItems.${index}.description`),
    quantity: asField<number>(`lineItems.${index}.quantity`),
    unitPrice: asField<number>(`lineItems.${index}.unitPrice`),
    amount: asField<number>(`lineItems.${index}.amount`),
  }));

  return {
    vendor: asField<string>("vendor"),
    invoiceNumber: asField<string>("invoiceNumber"),
    issueDate: asField<string>("issueDate"),
    dueDate: optional<string>("dueDate"),
    currency: { value: currency, quote: at("currency")?.quote ?? currency },
    lineItems,
    subtotal: asField<number>("subtotal"),
    tax: optional<number>("tax"),
    total: asField<number>("total"),
  };
}
```

Note the `Invoice` and `Field` imports must be added to the existing import from
`./invoice` at the top of the file.

- [ ] **Step 11: Run and confirm green**

```bash
npm test && npm run lint
```

Expected: PASS, 15 tests in this file, whole suite green, lint clean.

- [ ] **Step 12: Commit**

```bash
git add lib/verify.ts tests/verify.test.ts
git commit -m "Add quote verification, flattening, and unflatten for client reuse"
```

---

### Task 5: Protocol — widen the encoder, add extract events

**Files:**
- Modify: `lib/protocol.ts:32-56`
- Create: `lib/extract-protocol.ts`
- Test: `tests/extract-protocol.test.ts`

**Interfaces:**
- Consumes: `VerifiedInvoice` (Task 4)
- Produces:
  - `encodeEvent<T>(event: T): string` and `createEventParser<T>()` — widened
  - `type ExtractEvent`, `type CachedExtraction`

`encodeEvent` and `createEventParser` are currently typed to `ChatEvent`. The wire format and partial-frame buffering do not change, so demo 1's tests staying green is the proof this is safe.

- [ ] **Step 1: Write the failing test**

Create `tests/extract-protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEventParser, encodeEvent } from "@/lib/protocol";
import type { ExtractEvent } from "@/lib/extract-protocol";

describe("extract protocol", () => {
  it("round-trips a stage event", () => {
    const event: ExtractEvent = { type: "stage", stage: "extracting" };
    const parse = createEventParser<ExtractEvent>();
    expect(parse(encodeEvent(event))).toEqual([event]);
  });

  it("round-trips a notice event", () => {
    const event: ExtractEvent = {
      type: "notice",
      kind: "rate_limited",
      message: "Slow down.",
    };
    const parse = createEventParser<ExtractEvent>();
    expect(parse(encodeEvent(event))).toEqual([event]);
  });

  it("holds a partial frame until the rest arrives", () => {
    const parse = createEventParser<ExtractEvent>();
    const encoded = encodeEvent({ type: "stage", stage: "verifying" } as ExtractEvent);
    const split = Math.floor(encoded.length / 2);

    expect(parse(encoded.slice(0, split))).toEqual([]);
    expect(parse(encoded.slice(split))).toEqual([
      { type: "stage", stage: "verifying" },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/extract-protocol.test.ts
```

Expected: FAIL — `@/lib/extract-protocol` does not exist, and `createEventParser` takes no type parameter.

- [ ] **Step 3: Widen the encoder**

In `lib/protocol.ts`, replace `encodeEvent` and `createEventParser` with:

```ts
/**
 * Generic over the event type so `/api/chat` and `/api/extract` share one wire
 * format. Defaults to `ChatEvent` so existing call sites are unchanged.
 */
export function encodeEvent<T = ChatEvent>(event: T): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Parses an SSE body into events. Tolerates partial trailing frames. */
export function createEventParser<T = ChatEvent>() {
  let buffer = "";
  return function push(chunk: string): T[] {
    buffer += chunk;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    const events: T[] = [];
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as T);
      } catch {
        // A frame that doesn't parse is dropped rather than killing the
        // stream — the next one is usually fine.
      }
    }
    return events;
  };
}
```

- [ ] **Step 4: Add the extract event union**

Create `lib/extract-protocol.ts`:

```ts
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
```

- [ ] **Step 5: Run the whole suite**

```bash
npm test && npm run lint
```

Expected: the 3 new tests pass **and every pre-existing test still passes** — that is the check that widening the encoder broke nothing.

- [ ] **Step 6: Commit**

```bash
git add lib/protocol.ts lib/extract-protocol.ts tests/extract-protocol.test.ts
git commit -m "Widen SSE encoder to any event type, add extract events"
```

---

### Task 6: Bundled sample invoices

**Files:**
- Create: `assets/invoices/clean.html`, `assets/invoices/bad-total.html`, `assets/invoices/inferred-field.html`
- Create: `content/invoices/clean.pdf`, `content/invoices/bad-total.pdf`, `content/invoices/inferred-field.pdf`
- Create: `assets/render-invoices.ps1`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: three PDFs under `content/invoices/`, referenced by `app/extract/page.tsx` in Task 9

Nobody uploads a real invoice to a stranger's demo site. Without samples the demo is unusable to a casual visitor, and the video has nothing to shoot.

- [ ] **Step 1: Author the clean sample**

Create `assets/invoices/clean.html` — a normal invoice for Petrichor Systems, invoice `A-1042`, two line items (Support retainer 2 × 500.00 = 1000.00; Onboarding 1 × 200.00 = 200.00), subtotal 1200.00, tax 96.00, total 1296.00. Plain semantic HTML with a `<table>` for line items and inline CSS for print. Everything must reconcile exactly.

- [ ] **Step 2: Author the arithmetic-error sample**

Copy `clean.html` to `assets/invoices/bad-total.html`. Change the vendor to `Halden Freight`, the number to `HF-3318`, and make the stated total **1,428.00** while subtotal (1200.00) plus tax (96.00) is 1296.00.

This is the demo's best moment: the model extracts it faithfully, and reconciliation catches what no amount of extraction quality would.

- [ ] **Step 3: Author the unquotable-field sample**

Copy `clean.html` to `assets/invoices/inferred-field.html`. Vendor `Marrow & Sons`, number `MS-0091`. Remove the due date row entirely but leave payment terms reading "Net 30" — the due date is inferable from the issue date but never printed, so any quote for it should fail verification.

- [ ] **Step 4: Write the render script**

Create `assets/render-invoices.ps1`, following the headless-browser approach already used by `assets/render-thumbnails.ps1`:

```powershell
# Renders each invoice HTML to PDF. The HTML stays in the repo so the samples
# remain editable rather than becoming opaque binaries.
$chrome = (Get-Command chrome, msedge -ErrorAction SilentlyContinue |
           Select-Object -First 1).Source
if (-not $chrome) { throw "No Chrome or Edge found for headless rendering." }

New-Item -ItemType Directory -Force ../content/invoices | Out-Null

foreach ($name in @("clean", "bad-total", "inferred-field")) {
  $src = (Resolve-Path "invoices/$name.html").Path
  $out = Join-Path (Resolve-Path "../content/invoices").Path "$name.pdf"
  & $chrome --headless --disable-gpu --no-pdf-header-footer `
            --print-to-pdf="$out" "file:///$($src -replace '\\','/')"
  Write-Host "rendered $name.pdf"
}
```

- [ ] **Step 5: Render the PDFs**

```bash
cd assets && pwsh ./render-invoices.ps1 && cd ..
```

Confirm all three files exist and are non-trivial:

```bash
ls -la content/invoices/
```

Expected: three PDFs, each at least a few KB.

- [ ] **Step 6: Add a test that the samples parse and reconcile as intended**

Append to `tests/pdf.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("bundled samples", () => {
  for (const name of ["clean", "bad-total", "inferred-field"]) {
    it(`extracts text from ${name}.pdf`, async () => {
      const bytes = new Uint8Array(readFileSync(`content/invoices/${name}.pdf`));
      const { text, pages } = await extractPdf(bytes);

      expect(pages).toBe(1);
      expect(text.length).toBeGreaterThan(100);
    });
  }

  it("keeps the deliberately wrong total in bad-total.pdf", async () => {
    const bytes = new Uint8Array(readFileSync("content/invoices/bad-total.pdf"));
    const { text } = await extractPdf(bytes);

    // If this sample ever gets "fixed", the demo's best moment silently dies.
    expect(text).toContain("1,428.00");
  });
});
```

- [ ] **Step 7: Include the PDFs in the deployed bundle**

File tracing cannot see a dynamic read, exactly as with the markdown corpus. In `next.config.ts`, extend `outputFileTracingIncludes`:

```ts
outputFileTracingIncludes: {
  "/*": ["./content/**/*"],
},
```

Verify this already covers `content/invoices/**` — the existing glob does. No change is needed, but confirm it rather than assuming.

- [ ] **Step 8: Run tests and commit**

```bash
npm test && npm run lint
git add assets/invoices content/invoices assets/render-invoices.ps1
git commit -m "Add three sample invoices covering clean, bad arithmetic, and unquotable field"
```

---

### Task 7: `app/api/extract/route.ts`

**Files:**
- Create: `app/api/extract/route.ts`
- Modify: `lib/guard.ts` (append `recordExtraction`)

**Interfaces:**
- Consumes: `extractPdf`, `PdfError` (Task 2); `INVOICE_TOOL`, `EXTRACT_SYSTEM_PROMPT`, `Invoice` (Task 3); `verifyInvoice` (Task 4); `ExtractEvent`, `CachedExtraction` (Task 5)
- Produces: `POST /api/extract` accepting `multipart/form-data` with a `file` field, streaming `ExtractEvent`s

- [ ] **Step 1: Add bookkeeping to `lib/guard.ts`**

Append, directly after `recordTurn`:

```ts
/**
 * Post-response bookkeeping for an extraction. One function for the same
 * reason `recordTurn` is one: the route hands the whole thing to `after`, and
 * anything scheduled another way races the serverless freeze.
 */
export async function recordExtraction(
  store: Store,
  {
    key,
    payload,
    spend,
    cacheTtlSeconds,
  }: {
    key: string;
    payload: unknown;
    spend: number;
    cacheTtlSeconds: number;
  },
): Promise<void> {
  const results = await Promise.allSettled([
    recordSpend(store, spend),
    store.setJSON(key, payload, cacheTtlSeconds),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[extract] bookkeeping failed", result.reason);
    }
  }
}
```

- [ ] **Step 2: Write the route**

Create `app/api/extract/route.ts`:

```ts
import { createHash } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { getClient, hasApiKey, MODEL } from "@/lib/anthropic";
import {
  checkRateLimit,
  configFromEnv,
  readBudget,
  recordExtraction,
  visitorId,
} from "@/lib/guard";
import type { CachedExtraction, ExtractEvent } from "@/lib/extract-protocol";
import { EXTRACT_SYSTEM_PROMPT, INVOICE_TOOL, type Invoice } from "@/lib/invoice";
import { extractPdf, PdfError } from "@/lib/pdf";
import { encodeEvent } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { verifyInvoice } from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 10;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60 * 60;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

function streamOf(events: ExtractEvent[]): Response {
  return new Response(events.map((e) => encodeEvent(e)).join(""), {
    headers: SSE_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  if (!hasApiKey()) {
    return Response.json(
      { error: "The demo is missing its ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }

  let file: File | null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Malformed upload." }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "Attach a PDF invoice." }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "This demo reads PDFs. Scans and images aren't supported." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let text: string;
  let pages: number;
  try {
    ({ text, pages } = await extractPdf(bytes));
  } catch (error) {
    if (error instanceof PdfError) {
      // A scan is a stated limitation, not a crash: 422 rather than 400.
      const status = error.code === "no_text" ? 422 : 400;
      return Response.json({ error: error.message }, { status });
    }
    throw error;
  }

  if (pages > MAX_PAGES) {
    return Response.json(
      { error: `That PDF has ${pages} pages; the limit is ${MAX_PAGES}.` },
      { status: 413 },
    );
  }

  const store = getStore();
  const config = configFromEnv();
  const visitor = visitorId(request.headers);

  // Keyed on the bytes, so re-running a bundled sample during a demo is free
  // and instant. Only the verified result is stored — never the PDF.
  const key = `extract:${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`;

  const cached = await store.getJSON<CachedExtraction>(key);
  if (cached) {
    return streamOf([
      { type: "result", invoice: cached.invoice, text: cached.text, cached: true },
    ]);
  }

  const rate = await checkRateLimit(store, {
    identifier: visitor,
    bucket: "extract",
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
  });
  if (!rate.allowed) {
    return streamOf([
      {
        type: "notice",
        kind: "rate_limited",
        message: `You've extracted ${RATE_LIMIT} invoices this hour, which is the per-visitor limit — each one costs several times what a chat question does. The bundled samples still work instantly. Full access returns in about ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.`,
      },
    ]);
  }

  const budget = await readBudget(store, config.dailyTokenBudget);
  if (budget.exhausted) {
    return streamOf([
      {
        type: "notice",
        kind: "budget_exhausted",
        message:
          "The lab has spent its token budget for today, so new extractions are paused until midnight UTC. Invoices someone has already run still return instantly.",
      },
    ]);
  }

  return streamExtraction({ bytes, text, key, store, config });
}

function streamExtraction({
  bytes,
  text,
  key,
  store,
  config,
}: {
  bytes: Uint8Array;
  text: string;
  key: string;
  store: ReturnType<typeof getStore>;
  config: ReturnType<typeof configFromEnv>;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ExtractEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)));

      try {
        send({ type: "stage", stage: "extracting" });

        const message = await getClient().messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: EXTRACT_SYSTEM_PROMPT,
          tools: [INVOICE_TOOL],
          tool_choice: { type: "tool", name: INVOICE_TOOL.name },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: Buffer.from(bytes).toString("base64"),
                  },
                  // Citations stay OFF: enabling them alongside a strict
                  // schema is a hard 400, and PDF citations are page-level
                  // anyway. Grounding comes from quote verification instead.
                },
                { type: "text", text: "Extract this invoice." },
              ],
            },
          ],
        });

        const call = message.content.find((block) => block.type === "tool_use");
        if (!call || call.type !== "tool_use") {
          throw new Error("Model returned no tool call");
        }

        send({ type: "stage", stage: "verifying" });

        const invoice = verifyInvoice(call.input as Invoice, text);
        send({ type: "result", invoice, text, cached: false });

        const spend =
          message.usage.input_tokens +
          message.usage.output_tokens +
          (message.usage.cache_creation_input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0);

        after(() =>
          recordExtraction(store, {
            key,
            payload: { invoice, text } satisfies CachedExtraction,
            spend,
            cacheTtlSeconds: config.cacheTtlSeconds,
          }),
        );

        controller.close();
      } catch (error) {
        console.error("[extract] extraction failed", error);
        send({
          type: "notice",
          kind: "error",
          message: "Something broke on the way to the model. Try again in a moment.",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 3: Verify the route end to end locally**

```bash
npm run dev
```

```bash
curl -N -X POST http://localhost:3000/api/extract \
  -F "file=@content/invoices/clean.pdf"
```

Expected: `data:` frames — a `stage` event, then a `result` whose `invoice.fields` all carry non-null `span`, and whose `issues` is `[]`.

- [ ] **Step 4: Verify the arithmetic sample is caught**

```bash
curl -N -X POST http://localhost:3000/api/extract \
  -F "file=@content/invoices/bad-total.pdf"
```

Expected: a `result` whose `issues` contains `total_mismatch`, and whose `total` field carries that code. **If `issues` is empty, the model corrected the arithmetic** — strengthen `EXTRACT_SYSTEM_PROMPT` before continuing, because the demo's central moment depends on this.

- [ ] **Step 5: Verify the rejections**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/extract -F "file=@README.md"
curl -s -X POST http://localhost:3000/api/extract | head -c 200
```

Expected: `400` for the non-PDF; a 400 JSON error for the missing file.

- [ ] **Step 6: Run tests, lint, and commit**

```bash
npm test && npm run lint
git add app/api/extract/route.ts lib/guard.ts
git commit -m "Add /api/extract: verified extraction over SSE"
```

---

### Task 8: `components/InvoicePane.tsx`

**Files:**
- Create: `components/InvoicePane.tsx`

**Interfaces:**
- Consumes: `splitByCitations`, `type Span` from `lib/highlight.ts`; `VerifiedField` from `lib/verify.ts`
- Produces: `<InvoicePane text={...} fields={...} activePath={...} />`

`splitByCitations` already takes `{start, end, marker}` and handles out-of-order and overlapping spans. Verification produces exactly that shape, so this is reuse rather than a second highlighter.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { splitByCitations, type Span } from "@/lib/highlight";
import type { VerifiedField } from "@/lib/verify";

/**
 * The document text with each verified quote highlighted.
 *
 * Reuses demo 1's highlighter: verification produces the same `{start, end,
 * marker}` spans the citation path does, and that function already handles
 * overlapping and out-of-order ranges.
 */
export function InvoicePane({
  text,
  fields,
  activePath,
}: {
  text: string;
  fields: VerifiedField[];
  activePath: string | null;
}) {
  const located = fields.filter((field) => field.span !== null);
  const activeIndex = located.findIndex((field) => field.path === activePath);

  const spans: Span[] = located.map((field, index) => ({
    start: field.span!.start,
    end: field.span!.end,
    marker: index,
  }));

  const pieces = splitByCitations(text, spans);

  return (
    <div className="rounded-lg border border-black/10 bg-white/60 p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
        Document text
      </p>
      <p className="font-mono text-xs leading-relaxed text-ink">
        {pieces.map((piece, index) =>
          piece.marker === null ? (
            <span key={index}>{piece.text}</span>
          ) : (
            <mark
              key={index}
              className={
                piece.marker === activeIndex
                  ? "rounded bg-amber-300 px-0.5"
                  : "rounded bg-amber-100 px-0.5"
              }
            >
              {piece.text}
            </mark>
          ),
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Lint and commit**

```bash
npm run lint
git add components/InvoicePane.tsx
git commit -m "Add InvoicePane reusing demo 1's span highlighter"
```

---

### Task 9: `components/ExtractWorkbench.tsx` — table, review, export

**Files:**
- Create: `components/ExtractWorkbench.tsx`

**Interfaces:**
- Consumes: `createEventParser` (Task 5); `ExtractEvent` (Task 5); `VerifiedField`, `VerifiedInvoice` (Task 4); `InvoicePane` (Task 8)
- Produces: `<ExtractWorkbench samples={[{ name, label }]} />`

Corrections live in React state and never go back to the server. Editing a value re-runs reconciliation immediately, so fixing a bad subtotal visibly clears the downstream error — the single most convincing thing in the demo.

- [ ] **Step 1: Write the imports and the re-check helper**

Reconciliation re-runs on the client after a correction so the result is
instant, but the arithmetic is **not** reimplemented here. `lib/invoice.ts` is
pure TypeScript with no server-only imports, so the component rebuilds an
`Invoice` with `unflatten` and calls the same `reconcile` the server used. One
implementation, one place to change.

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { InvoicePane } from "@/components/InvoicePane";
import type { ExtractEvent } from "@/lib/extract-protocol";
import { reconcile } from "@/lib/invoice";
import { createEventParser } from "@/lib/protocol";
import { unflatten, type VerifiedField } from "@/lib/verify";

/**
 * Paths currently failing reconciliation, recomputed from the live (possibly
 * corrected) values via the same `reconcile` the server ran. Correcting a
 * flagged value therefore clears its flag with no round trip and no second
 * copy of the arithmetic.
 */
function flaggedPaths(fields: VerifiedField[], currency: string): Set<string> {
  try {
    const issues = reconcile(unflatten(fields, currency));
    return new Set(issues.flatMap((issue) => issue.paths));
  } catch {
    // `unflatten` throws if a required path is missing, which can only happen
    // if the field list came from somewhere other than `verifyInvoice`. No
    // reconciliation is better than a crash mid-review.
    return new Set();
  }
}
```

- [ ] **Step 2: Write the CSV builder**

```tsx
/** Quotes every cell and doubles embedded quotes — the minimum RFC 4180 needs. */
function toCsv(fields: VerifiedField[]): string {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [
    ["Field", "Value", "Source quote", "Status"].map(cell).join(","),
    ...fields.map((field) =>
      [
        field.label,
        field.value,
        field.quote,
        field.span === null ? "unverified" : "verified",
      ]
        .map(cell)
        .join(","),
    ),
  ];
  return rows.join("\r\n");
}

function downloadCsv(fields: VerifiedField[]) {
  const blob = new Blob([toCsv(fields)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "invoice.csv";
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Write the workbench body**

```tsx
type Props = { samples: { name: string; label: string }[] };

export function ExtractWorkbench({ samples }: Props) {
  const [fields, setFields] = useState<VerifiedField[] | null>(null);
  const [currency, setCurrency] = useState("");
  const [text, setText] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const flagged = useMemo(
    () => (fields ? flaggedPaths(fields, currency) : new Set<string>()),
    [fields, currency],
  );

  const run = useCallback(async (body: FormData) => {
    setNotice(null);
    setFields(null);
    setStage("reading");

    const response = await fetch("/api/extract", { method: "POST", body });

    if (!response.ok) {
      const { error } = (await response.json()) as { error?: string };
      setNotice(error ?? "That didn't work.");
      setStage(null);
      return;
    }

    const parse = createEventParser<ExtractEvent>();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parse(decoder.decode(value, { stream: true }))) {
        if (event.type === "stage") setStage(event.stage);
        if (event.type === "notice") { setNotice(event.message); setStage(null); }
        if (event.type === "result") {
          setFields(event.invoice.fields);
          setCurrency(event.invoice.currency);
          setText(event.text);
          setStage(null);
        }
      }
    }
  }, []);

  const runSample = useCallback(
    async (name: string) => {
      const file = await fetch(`/invoices/${name}.pdf`).then((r) => r.blob());
      const body = new FormData();
      body.append("file", new File([file], `${name}.pdf`, { type: "application/pdf" }));
      await run(body);
    },
    [run],
  );

  const edit = (path: string, value: string) =>
    setFields((current) =>
      current?.map((field) =>
        field.path === path
          ? { ...field, value: typeof field.value === "number" ? Number(value) : value }
          : field,
      ) ?? null,
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div>
        <div className="flex flex-wrap gap-2">
          {samples.map((sample) => (
            <button
              key={sample.name}
              onClick={() => runSample(sample.name)}
              className="rounded-full border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5"
            >
              {sample.label}
            </button>
          ))}
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-dashed border-black/25 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Upload a PDF
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const body = new FormData();
              body.append("file", file);
              void run(body);
            }}
          />
        </div>

        <p className="mt-2 text-xs text-muted">
          Nothing you upload is stored. The PDF is read for this request and discarded.
        </p>

        {stage && <p className="mt-4 text-sm text-muted">{stage}…</p>}
        {notice && (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            {notice}
          </p>
        )}

        {fields && (
          <>
            <p className="mt-4 text-sm">
              {flagged.size === 0
                ? "Every field is quoted from the document and the arithmetic reconciles."
                : `${flagged.size} field${flagged.size === 1 ? "" : "s"} need review.`}
            </p>

            <table className="mt-3 w-full text-sm">
              <tbody>
                {fields.map((field) => {
                  const unverified = field.span === null;
                  const wrong = flagged.has(field.path);
                  return (
                    <tr
                      key={field.path}
                      onMouseEnter={() => setActivePath(field.path)}
                      onMouseLeave={() => setActivePath(null)}
                      className="border-b border-black/5"
                    >
                      <td className="py-1.5 pr-3 text-muted">{field.label}</td>
                      <td className="py-1.5">
                        {unverified || wrong ? (
                          <input
                            value={String(field.value)}
                            onChange={(event) => edit(field.path, event.target.value)}
                            className="w-full rounded border border-amber-400 bg-amber-50 px-2 py-1"
                          />
                        ) : (
                          <span>{String(field.value)}</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-3 text-xs text-muted">
                        {unverified ? "not found in document" : wrong ? "doesn't reconcile" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <button
              onClick={() => downloadCsv(fields)}
              className="mt-4 rounded-full bg-ink px-4 py-2 text-sm text-white"
            >
              Export CSV
            </button>
          </>
        )}
      </div>

      {fields && <InvoicePane text={text} fields={fields} activePath={activePath} />}
    </div>
  );
}
```

- [ ] **Step 4: Lint and commit**

```bash
npm run lint
git add components/ExtractWorkbench.tsx
git commit -m "Add ExtractWorkbench with inline review and CSV export"
```

---

### Task 10: Page, hub card, and docs

**Files:**
- Create: `app/extract/page.tsx`
- Create: `public/invoices/clean.pdf`, `bad-total.pdf`, `inferred-field.pdf` (copies)
- Modify: `app/page.tsx:24-36`
- Modify: `app/api/upload/route.ts:34`
- Modify: `AGENTS.md`, `README.md`

**Interfaces:**
- Consumes: `ExtractWorkbench` (Task 9)
- Produces: `/extract`, reachable from the hub

- [ ] **Step 1: Copy samples where the browser can fetch them**

The client fetches `/invoices/<name>.pdf`, so they must also be static assets:

```bash
mkdir -p public/invoices
cp content/invoices/*.pdf public/invoices/
```

- [ ] **Step 2: Write the page**

Create `app/extract/page.tsx`, following `app/chat/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ExtractWorkbench } from "@/components/ExtractWorkbench";

export const metadata: Metadata = {
  title: "Invoice extraction you can audit — AI Demo Lab",
  description:
    "Pulls structured data out of a PDF invoice, proves every field against the document text, and checks the arithmetic independently.",
};

export const dynamic = "force-dynamic";

const SAMPLES = [
  { name: "clean", label: "A clean invoice" },
  { name: "bad-total", label: "One where the total is wrong" },
  { name: "inferred-field", label: "One with a missing due date" },
];

export default function ExtractPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-5">
      <ExtractWorkbench samples={SAMPLES} />
    </div>
  );
}
```

- [ ] **Step 3: Flip the hub card to live**

In `app/page.tsx`, change the `/extract` entry's `status` from `"building"` to `"live"`. This is what makes the card a `<Link>` rather than an inert `<article>`.

Update its `points` to match what shipped:

```ts
points: [
  "Every field carries the quote it came from, checked against the document",
  "Arithmetic is reconciled independently — a plausible wrong total gets caught",
  "Flagged fields are correctable inline, then exported as CSV",
],
```

- [ ] **Step 4: Fix the now-wrong copy in the upload route**

`app/api/upload/route.ts:34` currently reads *"PDFs aren't supported here — see the README for why."* PDFs now are supported, elsewhere. Change to:

```ts
{ error: "Upload a .md or .txt file here. For PDF invoices, try the extraction demo at /extract." },
```

- [ ] **Step 5: Document the new invariants in `AGENTS.md`**

Add to the Invariants section:

```markdown
**Citations must stay off on the extract path.** Enabling citations alongside
`output_config.format` is a hard 400 (`"Citations cannot be enabled when output
format is set"`), and citations alongside a *forced* strict tool are accepted but
produce no text blocks for citations to attach to — legal and silently useless.
PDF citations are page-level regardless. Grounding comes from quote verification
in `lib/verify.ts` instead.

**`lib/invoice.ts` must stay free of server-only imports.** `ExtractWorkbench`
imports `reconcile` directly so client and server share one implementation of
the arithmetic. Adding a `node:` import, a store call, or anything Anthropic to
that module breaks the client bundle and forces the duplication back.
```

- [ ] **Step 6: Update `README.md`**

Add a section for demo 2 describing what it does, the quote-verification approach, and why citations couldn't be used. Match the existing tone.

- [ ] **Step 7: Full verification**

```bash
npm test && npm run lint && npm run build
```

Expected: all green, build clean.

```bash
npm run dev
```

Visit `http://localhost:3000` — the `/extract` card is now clickable. Visit `/extract`, run all three samples, confirm: clean has no flags, bad-total flags the total, inferred-field flags the due date. Correct a flagged value and watch the flag clear. Export the CSV and open it.

- [ ] **Step 8: Commit and deploy**

```bash
git add -A
git commit -m "Ship /extract: page, hub card, and docs"
git push origin main
```

- [ ] **Step 9: Verify on production**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://ai-demo-lab-azure.vercel.app/extract
curl -N -X POST https://ai-demo-lab-azure.vercel.app/api/extract \
  -F "file=@content/invoices/bad-total.pdf" | head -c 600
```

Expected: `200` for the page; a `result` event whose `issues` contains `total_mismatch`.

Check the content, not just the status code — a 200 can be a Vercel SSO login page. Confirm the body is real extraction output.

---

## Self-Review

**Spec coverage:** PDF-only intake (T7) · fixed schema (T3) · quote verification (T4) · arithmetic reconciliation (T3, T9) · inline review queue (T9) · CSV export (T9) · three bundled samples (T6) · no persistence (T7 — cache holds only the verified result) · SSE staging (T5, T7) · guards and limits (T7) · error table (T7) · testing (T2–T5) · PDF library decision (T1).

**Placeholders:** none. Every code step carries complete code; every command carries expected output.

**Type consistency:** `Field<T>`, `Invoice`, `ReconcileIssue.paths` (T3) → consumed by `verifyInvoice` (T4) → `VerifiedField`/`VerifiedInvoice` flow into `ExtractEvent` (T5), the route (T7), `InvoicePane` (T8), and `ExtractWorkbench` (T9) under those exact names. `Span` in T8 matches `lib/highlight.ts`. `recordExtraction` (T7 Step 1) is used in T7 Step 2 with matching parameters.

**Known risk carried deliberately:** T7 Step 4 depends on the model recording a wrong total rather than silently fixing it. It is called out as a gate with a defined remedy because the demo's central moment depends on it, and no amount of downstream code can compensate if the model "helps".
