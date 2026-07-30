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

  const expectedTotal =
    minor(invoice.subtotal.value) + minor(invoice.tax?.value ?? 0);
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
 * Carried as a strict tool rather than `output_config.format`.
 *
 * Both enforce the schema, but citations are a hard 400 alongside
 * `output_config.format` ("Citations cannot be enabled when output format is
 * set"), and the tool form leaves room to add a cited prose pass later without
 * restructuring the call.
 *
 * Schema constraints from the structured-outputs docs: no recursive schemas,
 * `additionalProperties` must be false, and numeric bounds are unsupported —
 * so range checks live in `reconcile`, not here.
 */
export const INVOICE_TOOL = {
  name: "record_invoice",
  description:
    "Record every field extracted from the invoice, with the verbatim source text for each.",
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
      "vendor",
      "invoiceNumber",
      "issueDate",
      "dueDate",
      "currency",
      "lineItems",
      "subtotal",
      "tax",
      "total",
    ],
    additionalProperties: false,
  },
} as const;

/**
 * The "do not correct the arithmetic" instruction is load-bearing, not
 * politeness: a model that helpfully fixes a bad total destroys the only thing
 * this demo exists to show.
 */
export const EXTRACT_SYSTEM_PROMPT = `You extract structured data from invoices.

Record every value exactly as printed. Do not compute, correct, or reconcile
anything — if the document's own arithmetic is wrong, record what it says. A
separate check catches those errors, and silently fixing them hides the problem
the reader needs to see.

Every quote must be copied verbatim from the document. If a value is not
printed and you had to infer it, quote the closest supporting text rather than
inventing one.`;
