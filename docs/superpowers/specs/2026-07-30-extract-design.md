# Demo 2 — `/extract`: invoice extraction you can audit

Design doc. Status: awaiting review.

## What this demo claims

Demo 1 argues that an answer is only as good as the source you can trace it to.
Demo 2 makes the same argument about extracted data: **a field is only as good as
the text you can point at.**

Every extracted value carries the verbatim quote it came from. The server checks
that quote actually appears in the document, and independently checks that the
numbers reconcile. Fields that fail either check are flagged for review. Nothing
in that pipeline depends on the model's own opinion of how confident it is.

The failure mode this targets is specific and familiar: an extractor returns a
clean, well-formed, plausible total that is simply wrong, and nothing downstream
notices until someone pays it.

## Scope

**In:** PDF invoices, a fixed schema, quote verification, arithmetic
reconciliation, an inline review queue, CSV export, three bundled samples.

**Out:** scanned images and OCR, visitor-defined schemas, persistence of uploaded
documents or results, multi-invoice batching, a processed-invoice log.

## Finding that shaped the design

Character-span citations from the API cannot be combined with schema-enforced
output. This was verified against the live API, not inferred:

```
citations + output_config.format  → 400
  "Citations cannot be enabled when output format is set.
   Please disable citations on uploaded document blocks."

citations + strict tool use       → 200, but content is a lone tool_use block.
                                    Citations attach to text blocks; with the
                                    tool forced there are none. Legal, silent,
                                    and useless.

citations alone (control)         → char_location spans, as demo 1 uses.
```

Two further constraints from the docs:

- PDF citations are **page-level** (`"For PDFs: Citations include the page number
  range"`). Character offsets exist only for plain-text documents. On a one-page
  invoice every citation would resolve to "page 1".
- `"Citing images from PDFs is not currently supported."`

So the API's citation mechanism cannot ground per-field extraction on a PDF, by
construction. We compute the spans ourselves instead — which is stronger here,
because a quote that fails a substring search is a hard falsification rather than
a low score.

## Architecture

```
PDF (browser)
  │  multipart POST /api/extract
  ▼
route ──► pdf.ts        extract text server-side (never persisted)
      ──► guard()       cache → rate limit → token budget, bucket "extract"
      ──► anthropic     one call: PDF document block + strict tool (schema)
      ──► verify.ts     locate each quote in the text → spans, or flag
      ──► invoice.ts    reconcile line items → subtotal → tax → total
      ──► SSE stream    stage events, then the verified result
  ▼
ExtractWorkbench (client) — table, flags, inline correction, CSV export
```

One model call per document. The PDF goes to Claude as a `document` block with
citations **off**; text extraction happens locally and exists only to verify
quotes and compute offsets.

### Modules

| Module | Responsibility |
|---|---|
| `lib/pdf.ts` | PDF → text, plus whitespace normalisation used by both sides of the match |
| `lib/invoice.ts` | The schema, the tool definition, arithmetic reconciliation |
| `lib/verify.ts` | Quote → `{start, end}` span, or a flag when it isn't found |
| `lib/extract-protocol.ts` | SSE event union for this route |
| `app/api/extract/route.ts` | Intake, guards, model call, streaming |
| `app/extract/page.tsx` | Server component; lists the bundled samples |
| `components/ExtractWorkbench.tsx` | Table, flags, corrections, export |
| `components/InvoicePane.tsx` | Extracted text with quote spans highlighted |
| `content/invoices/*.pdf` | Three bundled samples |

Reused unchanged: `lib/guard.ts` (`guard()` already takes a `bucket`),
`lib/store.ts`, `lib/anthropic.ts`, and `lib/highlight.ts` — `splitByCitations`
takes `{start, end, marker}` spans, which is exactly the shape verification
produces, so highlighting is shared with demo 1 rather than rewritten.

`lib/uploads.ts` is **not** widened. It is text-only, Redis-backed, and serves
demo 1; PDFs are binary and deliberately never stored. A sibling path keeps
demo 1's storage semantics untouched.

## Schema

Every field is `{ value, quote }` rather than a bare scalar. The quote is what
makes the value checkable.

```ts
type Field<T> = { value: T; quote: string };

type Invoice = {
  vendor: Field<string>;
  invoiceNumber: Field<string>;
  issueDate: Field<string>;      // ISO 8601
  dueDate: Field<string> | null;
  currency: Field<string>;       // ISO 4217
  lineItems: { description: Field<string>;
               quantity: Field<number>;
               unitPrice: Field<number>;
               amount: Field<number> }[];
  subtotal: Field<number>;
  tax: Field<number> | null;
  total: Field<number>;
};
```

Carried as a **strict tool** (`strict: true`, forced via `tool_choice`) rather
than `output_config.format`. Both enforce the schema; the tool form leaves room
to add a cited-prose pass later without restructuring the call.

Schema constraints to respect (from the structured-outputs docs): no recursive
schemas, `additionalProperties` must be `false`, and numeric bounds like
`minimum`/`maximum` are unsupported — so range checks belong in our validation
layer, not the schema.

## Verification

Two independent checks. A field passes only if both are silent about it.

**1. Quote resolution.** Normalise whitespace on the extracted text and on the
quote, then locate the quote. A hit yields a character span for highlighting; a
miss flags the field as `unverified`.

Normalising matters because PDF text extraction linearises tables and columns —
runs of spaces and line breaks will not survive intact. Normalising whitespace
absorbs that without weakening the check: the words and their order still have to
be present.

**2. Arithmetic reconciliation.** Independent of the model and of the quotes:

- each line item's `quantity × unitPrice` equals its `amount`
- the line items sum to `subtotal`
- `subtotal + tax` equals `total`

Compared in integer minor units with a ±1 tolerance for rounding. A mismatch
flags every field in the failing relationship, since the error could be in any of
them.

A field is trustworthy when it is quotable and its arithmetic reconciles.
Everything else routes to review. When the two checks disagree — a quotable value
that breaks reconciliation — the field is still flagged: that combination usually
means the document itself is wrong, which is exactly what a reviewer needs to see.

## Streaming and protocol

Extraction takes long enough that a bare spinner is poor UX and demos badly, so
the route streams stage events over SSE using the existing encoder:

```ts
type ExtractEvent =
  | { type: "stage"; stage: "reading" | "extracting" | "verifying" }
  | { type: "result"; invoice: VerifiedInvoice; text: string }
  | { type: "notice"; kind: "rate_limited" | "budget_exhausted" | "error";
      message: string };
```

`encodeEvent` and `createEventParser` in `lib/protocol.ts` are currently typed to
`ChatEvent` rather than generic, so reuse requires widening both to a type
parameter defaulting to `ChatEvent`. The wire format (`data: <json>\n\n`) and the
partial-frame buffering are unchanged, so this is a signature change with no
behavioural effect on demo 1 — and demo 1's tests should stay green through it,
which is how we'll know.

Consistent with demo 1, rate limiting and budget exhaustion arrive as a **200
with a `notice` event**, not a 4xx — the UI explains them in place.

## Review and export

Flagged fields render as editable inputs; clean fields render as text with their
quote highlighted on hover. Editing a value re-runs reconciliation immediately,
so correcting a bad subtotal visibly clears the downstream error. Corrections
live in React state and are never sent back to the server.

Export builds a CSV from current state — corrections included — client-side via a
blob download. No server round trip, nothing stored.

## Limits, cost, and abuse

Per the PDF docs: 32 MB maximum request size, 600 pages (100 under a 1M-token
context), no encrypted PDFs. Cost is 1,500–3,000 text tokens per page **plus**
image tokens, because each page is also rendered as an image.

A typical one-page invoice therefore costs roughly 5k input tokens — about 60
extractions against the 300k daily budget. Accordingly:

- reject above **10 pages** and **5 MB**, well inside the API limits and far
  above any real invoice
- separate rate-limit bucket (`"extract"`), **5 per visitor per hour**, lower
  than chat's 12 because each call costs several times more
- the shared daily token budget applies unchanged
- response cache keyed on a hash of the PDF bytes, so re-running a bundled sample
  during a demo is free and instant

## Error handling

| Condition | Response |
|---|---|
| Not a PDF / no file | 400 |
| Encrypted, corrupt, or unparseable PDF | 400, naming the cause |
| Over 5 MB or 10 pages | 413, with the actual size or count |
| PDF parses but yields no text | 422 — almost certainly a scan, which is out of scope; say so |
| Rate limited / budget exhausted | 200 + `notice` |
| Model call fails | 200 + `notice`, logged server-side |
| Tool returns a schema-invalid payload | Cannot happen under `strict`; if it does, treat as a model failure |

The no-text case matters: it's the most likely thing a real visitor hits, since
plenty of invoices in the wild are scans. It should read as a clear limitation,
not a crash.

## Testing

TDD throughout, per the repo's convention. Pure logic is the bulk of it and needs
no API access:

- `tests/verify.test.ts` — quote found; quote absent; quote differing only in
  whitespace or line breaks; empty quote; quote appearing more than once
- `tests/invoice.test.ts` — clean reconciliation; line items not summing to
  subtotal; tax mismatch; rounding within ±1 minor unit; absent tax; empty line
  items
- `tests/pdf.test.ts` — text extraction against the bundled samples; page count;
  the no-text case
- `tests/extract-protocol.test.ts` — round-trip encode/parse of each event

The model call itself is not unit-tested; verification is what the tests target,
and it is deterministic by design.

## Bundled samples

Three PDFs, chosen so the demo tells a story without an upload:

1. **Clean** — everything quotable, arithmetic reconciles. Establishes the happy path.
2. **Arithmetic error** — line items don't sum to the stated total. The model
   extracts it faithfully; reconciliation catches it. This is the demo's best moment.
3. **Unquotable field** — a value the model has to infer rather than read, which
   fails quote resolution and lands in review.

Authored as HTML and printed to PDF headlessly — the same approach
`assets/render-thumbnails.ps1` already uses to render HTML to PNG, so the tooling
is established even though the output format differs. Keeping the HTML sources in
the repo means the samples stay editable rather than becoming opaque binaries.

## Open question for implementation

**Which PDF library.** Requirements: pure JS (no native bindings, which Vercel's
serverless runtime won't have), works under Next 16's bundler, exposes page count
and text. Candidates are `unpdf` (1.8.0, explicitly targets serverless runtimes),
`pdfjs-dist` (6.2.108), and `pdf-parse` (2.4.5).

`unpdf` is the leading candidate on its runtime-compatibility claim, but that
claim is **unverified against this stack**. Step one of implementation is a
throwaway spike that parses a sample in a deployed Next 16 route — not locally,
where native and bundler differences hide. If it fails there, fall back before
any real code depends on it.

This is deliberately the first task. Discovering it at the end would invalidate
the route, the verification layer, and the tests together.
