import { describe, expect, it } from "vitest";
import { type Invoice, reconcile } from "@/lib/invoice";

const f = <T,>(value: T) => ({ value, quote: String(value) });

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    vendor: f("Petrichor Systems"),
    invoiceNumber: f("A-1042"),
    issueDate: f("2026-07-01"),
    dueDate: f("2026-07-31"),
    currency: f("USD"),
    lineItems: [
      {
        description: f("Support retainer"),
        quantity: f(2),
        unitPrice: f(500),
        amount: f(1000),
      },
      {
        description: f("Onboarding"),
        quantity: f(1),
        unitPrice: f(200),
        amount: f(200),
      },
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
        {
          description: f("Support retainer"),
          quantity: f(2),
          unitPrice: f(500),
          amount: f(900),
        },
        {
          description: f("Onboarding"),
          quantity: f(1),
          unitPrice: f(200),
          amount: f(200),
        },
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
    const issues = reconcile(
      invoice({ subtotal: f(1500), tax: f(120), total: f(1620) }),
    );
    expect(issues.map((i) => i.code)).toContain("subtotal_mismatch");
  });

  it("flags every field in the failing relationship, since any could be wrong", () => {
    const issues = reconcile(
      invoice({ subtotal: f(1500), tax: f(120), total: f(1620) }),
    );
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
    // Half a cent of drift is a rounding artefact, not an extraction error.
    expect(reconcile(invoice({ total: f(1296.01) }))).toEqual([]);
  });

  it("does not tolerate drift beyond one minor unit", () => {
    expect(
      reconcile(invoice({ total: f(1296.05) })).map((i) => i.code),
    ).toContain("total_mismatch");
  });

  it("treats an absent tax as zero rather than an error", () => {
    expect(reconcile(invoice({ tax: null, total: f(1200) }))).toEqual([]);
  });

  it("reports no subtotal issue when there are no line items to sum", () => {
    const issues = reconcile(invoice({ lineItems: [] }));
    expect(issues.map((i) => i.code)).not.toContain("subtotal_mismatch");
  });
});
