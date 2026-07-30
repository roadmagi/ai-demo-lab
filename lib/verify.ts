import type { Field, Invoice, LineItem, ReconcileIssue } from "./invoice";
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
    issues
      .filter((issue) => issue.paths.includes(path))
      .map((issue) => issue.code);

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

  for (const key of [
    "vendor",
    "invoiceNumber",
    "issueDate",
    "dueDate",
    "currency",
  ] as const) {
    push(key, LABELS[key], invoice[key]);
  }

  invoice.lineItems.forEach((item, index) => {
    for (const key of [
      "description",
      "quantity",
      "unitPrice",
      "amount",
    ] as const) {
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

/**
 * Rebuilds an `Invoice` from the flat field list.
 *
 * This exists so the client can re-run `reconcile` after a correction instead
 * of carrying its own copy of the arithmetic. One implementation, one place to
 * change, no invariant to document.
 */
export function unflatten(
  fields: VerifiedField[],
  currency: string,
): Invoice {
  const at = (path: string) => fields.find((field) => field.path === path);

  const asField = <T extends string | number>(path: string): Field<T> => {
    const found = at(path);
    // A missing required path means the field list was built by something
    // other than verifyInvoice; failing loudly beats a silent zero.
    if (!found) throw new Error(`unflatten: missing required field "${path}"`);
    return { value: found.value as T, quote: found.quote };
  };

  const optional = <T extends string | number>(
    path: string,
  ): Field<T> | null => {
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
