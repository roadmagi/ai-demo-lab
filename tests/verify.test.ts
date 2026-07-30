import { describe, expect, it } from "vitest";
import { type Invoice, reconcile } from "@/lib/invoice";
import { locateQuote, unflatten, verifyInvoice } from "@/lib/verify";

const TEXT =
  "INVOICE A-1042 Vendor: Petrichor Systems Subtotal: $1,200.00 Total: $1,296.00";

describe("locateQuote", () => {
  it("locates an exact quote and returns its span", () => {
    expect(locateQuote(TEXT, "Petrichor Systems")).toEqual({
      start: 23,
      end: 40,
    });
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

const q = <T,>(value: T, quote: string) => ({ value, quote });

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
    // Both lines are present so the fixture actually reconciles: 1000 + 200
    // equals the 1200 subtotal. A fixture that never balanced would make
    // "correcting a field clears its flag" impossible to test.
    lineItems: [
      {
        description: q("Support retainer", "Support retainer"),
        quantity: q(2, "2"),
        unitPrice: q(500, "500.00"),
        amount: q(1000, "1000.00"),
      },
      {
        description: q("Onboarding", "Onboarding"),
        quantity: q(1, "Onboarding 1"),
        unitPrice: q(200, "200.00"),
        amount: q(200, "200.00 Subtotal"),
      },
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
    const paths = verifyInvoice(sample({ tax: null }), DOC).fields.map(
      (f) => f.path,
    );
    expect(paths).not.toContain("tax");
  });

  it("attaches reconciliation issues to every field they implicate", () => {
    const result = verifyInvoice(
      sample({ total: q(9999, "Total 1296.00") }),
      DOC,
    );
    const total = result.fields.find((f) => f.path === "total")!;
    expect(total.issues).toContain("total_mismatch");
  });

  it("carries the reconciliation issues through for the summary banner", () => {
    const result = verifyInvoice(
      sample({ total: q(9999, "Total 1296.00") }),
      DOC,
    );
    expect(result.issues.map((i) => i.code)).toContain("total_mismatch");
  });
});

describe("unflatten", () => {
  it("round-trips through verifyInvoice unchanged", () => {
    const original = sample();
    const { fields, currency } = verifyInvoice(original, DOC);

    expect(reconcile(unflatten(fields, currency))).toEqual(reconcile(original));
  });

  it("rebuilds line items in order", () => {
    const two = sample({
      lineItems: [
        {
          description: q("First", "First"),
          quantity: q(1, "1"),
          unitPrice: q(10, "10.00"),
          amount: q(10, "10.00"),
        },
        {
          description: q("Second", "Second"),
          quantity: q(2, "2"),
          unitPrice: q(20, "20.00"),
          amount: q(40, "40.00"),
        },
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
