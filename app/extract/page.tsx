import type { Metadata } from "next";
import { ExtractWorkbench, type Sample } from "@/components/ExtractWorkbench";

export const metadata: Metadata = {
  title: "Invoice extraction you can audit — AI Demo Lab",
  description:
    "Pulls structured data out of a PDF invoice, proves every field against the document text, and checks the arithmetic independently.",
};

export const dynamic = "force-dynamic";

const SAMPLES: Sample[] = [
  { name: "clean", label: "A clean invoice" },
  { name: "bad-total", label: "One where the total is wrong" },
  { name: "inferred-field", label: "One with a missing due date" },
];

export default function ExtractPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Invoice extraction you can audit
        </h1>
        <p className="mt-2 text-muted text-pretty">
          Every field carries the text it was read from, checked against the
          document. The arithmetic is reconciled separately, so a clean,
          plausible, wrong total still gets caught. Anything that fails either
          check is yours to correct before export.
        </p>
      </header>

      <div className="mt-7">
        <ExtractWorkbench samples={SAMPLES} />
      </div>
    </div>
  );
}
