"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { InvoicePane } from "@/components/InvoicePane";
import type { ExtractEvent } from "@/lib/extract-protocol";
import { reconcile, type ReconcileIssue } from "@/lib/invoice";
import { createEventParser } from "@/lib/protocol";
import { unflatten, type VerifiedField } from "@/lib/verify";

export type Sample = { name: string; label: string };

const STAGE_COPY: Record<string, string> = {
  reading: "Reading the PDF",
  extracting: "Extracting fields",
  verifying: "Checking every quote against the document",
};

/**
 * Re-runs reconciliation over the live (possibly corrected) values.
 *
 * The arithmetic is not reimplemented here: `unflatten` rebuilds an `Invoice`
 * and the same `reconcile` the server ran decides. `lib/invoice.ts` is pure
 * TypeScript with no server-only imports, which is what makes that possible —
 * and what keeps a correction from clearing a flag the server would still
 * raise.
 */
function recheck(fields: VerifiedField[], currency: string): ReconcileIssue[] {
  try {
    return reconcile(unflatten(fields, currency));
  } catch {
    // `unflatten` throws only if a required path is missing, which can't
    // happen for a field list that came from `verifyInvoice`. Showing no
    // arithmetic errors beats crashing mid-review.
    return [];
  }
}

export function ExtractWorkbench({ samples }: { samples: Sample[] }) {
  const [fields, setFields] = useState<VerifiedField[] | null>(null);
  const [currency, setCurrency] = useState("");
  const [text, setText] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(
    () => (fields ? recheck(fields, currency) : []),
    [fields, currency],
  );
  const flagged = useMemo(
    () => new Set(issues.flatMap((issue) => issue.paths)),
    [issues],
  );
  const unverified = useMemo(
    () => (fields ?? []).filter((field) => field.span === null).length,
    [fields],
  );

  const run = useCallback(async (body: FormData) => {
    setNotice(null);
    setFields(null);
    setActivePath(null);
    // Drafts belong to the previous document; carrying them over would show
    // one invoice's corrections on another's fields.
    setDrafts({});
    setStage("reading");

    let response: Response;
    try {
      response = await fetch("/api/extract", { method: "POST", body });
    } catch {
      setNotice("Couldn't reach the server. Check your connection and retry.");
      setStage(null);
      return;
    }

    if (!response.ok || !response.body) {
      const { error } = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setNotice(error ?? "That didn't work.");
      setStage(null);
      return;
    }

    const parse = createEventParser<ExtractEvent>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parse(decoder.decode(value, { stream: true }))) {
        if (event.type === "stage") setStage(event.stage);
        if (event.type === "notice") {
          setNotice(event.message);
          setStage(null);
        }
        if (event.type === "result") {
          setFields(event.invoice.fields);
          setCurrency(event.invoice.currency);
          setText(event.text);
          setCached(event.cached);
          setStage(null);
        }
      }
    }
  }, []);

  const runSample = useCallback(
    async (name: string) => {
      const blob = await fetch(`/invoices/${name}.pdf`).then((r) => r.blob());
      const body = new FormData();
      body.append(
        "file",
        new File([blob], `${name}.pdf`, { type: "application/pdf" }),
      );
      await run(body);
    },
    [run],
  );

  /**
   * What the reviewer has typed, kept as raw text per field.
   *
   * The parsed number can't drive the input on its own: clearing the box to
   * retype would parse to 0, render "0", and make the field impossible to
   * empty. So the draft is what's displayed, and the parsed value is what
   * reconciliation sees.
   */
  const edit = (path: string, raw: string) => {
    setDrafts((current) => ({ ...current, [path]: raw }));
    setFields(
      (current) =>
        current?.map((field) => {
          if (field.path !== path) return field;
          if (typeof field.value !== "number") return { ...field, value: raw };
          const parsed = Number(raw.replace(/,/g, "").trim());
          // Mid-edit garbage ("", "-", "1.") leaves the last good number in
          // place rather than forcing a 0 the reviewer never typed.
          return Number.isFinite(parsed) && raw.trim() !== ""
            ? { ...field, value: parsed }
            : field;
        }) ?? null,
    );
  };

  const busy = stage !== null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="min-w-0">
        <div className="flex flex-wrap gap-2">
          {samples.map((sample) => (
            <button
              key={sample.name}
              type="button"
              disabled={busy}
              onClick={() => void runSample(sample.name)}
              className="rounded-full border border-line bg-card px-3.5 py-1.5 text-sm text-ink transition hover:border-brand hover:text-brand-ink disabled:opacity-50"
            >
              {sample.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm text-muted transition hover:border-brand hover:text-brand-ink disabled:opacity-50"
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
              event.target.value = "";
            }}
          />
        </div>

        <p className="mt-2.5 text-xs text-muted">
          Nothing you upload is stored. The PDF is read for this request and
          discarded.
        </p>

        {stage && (
          <p className="mt-5 text-sm text-muted">
            {STAGE_COPY[stage] ?? stage}…
          </p>
        )}

        {notice && (
          <p className="mt-5 rounded-lg border border-line bg-warn-wash px-4 py-3 text-sm text-warn">
            {notice}
          </p>
        )}

        {fields && (
          <>
            <Summary
              issues={issues}
              unverified={unverified}
              cached={cached}
            />

            <table className="mt-4 w-full text-sm">
              <tbody>
                {fields.map((field) => {
                  const missing = field.span === null;
                  const wrong = flagged.has(field.path);
                  const needsReview = missing || wrong;

                  return (
                    <tr
                      key={field.path}
                      onMouseEnter={() => setActivePath(field.path)}
                      onMouseLeave={() => setActivePath(null)}
                      className="border-b border-line last:border-0"
                    >
                      <td className="w-40 py-2 pr-3 align-top text-muted">
                        {field.label}
                      </td>
                      <td className="py-2 align-top">
                        {needsReview ? (
                          <input
                            value={drafts[field.path] ?? String(field.value)}
                            onChange={(event) =>
                              edit(field.path, event.target.value)
                            }
                            aria-label={`${field.label}, needs review`}
                            className="w-full rounded border border-warn/40 bg-warn-wash px-2 py-1 text-ink outline-none focus:border-warn"
                          />
                        ) : (
                          <span className="text-ink">{String(field.value)}</span>
                        )}
                        {needsReview && (
                          <span className="mt-1 block text-xs text-warn">
                            {missing
                              ? "Not printed in the document — the model derived this."
                              : "Doesn't reconcile with the other figures."}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <button
              type="button"
              onClick={() => downloadCsv(fields, flagged)}
              className="mt-5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Export CSV
            </button>
          </>
        )}
      </section>

      {fields && (
        <InvoicePane text={text} fields={fields} activePath={activePath} />
      )}
    </div>
  );
}

function Summary({
  issues,
  unverified,
  cached,
}: {
  issues: ReconcileIssue[];
  unverified: number;
  cached: boolean;
}) {
  const clean = issues.length === 0 && unverified === 0;

  return (
    <div
      className={`mt-5 rounded-lg border px-4 py-3 text-sm ${
        clean
          ? "border-line bg-ok-wash text-ok"
          : "border-line bg-warn-wash text-warn"
      }`}
    >
      <p className="font-medium">
        {clean
          ? "Every field is quoted from the document and the arithmetic reconciles."
          : `${issues.length + unverified} thing${issues.length + unverified === 1 ? "" : "s"} to review.`}
      </p>

      {issues.map((issue) => (
        <p key={issue.code} className="mt-1.5">
          {issue.message}
        </p>
      ))}

      {unverified > 0 && (
        <p className="mt-1.5">
          {unverified} field{unverified === 1 ? "" : "s"} could not be traced to
          text in the document.
        </p>
      )}

      {cached && (
        <p className="mt-1.5 opacity-70">
          Served from cache — this document has been extracted before.
        </p>
      )}
    </div>
  );
}

/** Quotes every cell and doubles embedded quotes — the minimum RFC 4180 needs. */
function toCsv(fields: VerifiedField[], flagged: Set<string>): string {
  const cell = (value: string | number) =>
    `"${String(value).replace(/"/g, '""')}"`;

  const status = (field: VerifiedField) => {
    if (field.span === null) return "not in document";
    if (flagged.has(field.path)) return "does not reconcile";
    return "verified";
  };

  return [
    ["Field", "Value", "Source quote", "Status"].map(cell).join(","),
    ...fields.map((field) =>
      [field.label, field.value, field.quote, status(field)]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}

function downloadCsv(fields: VerifiedField[], flagged: Set<string>) {
  const blob = new Blob([toCsv(fields, flagged)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "invoice.csv";
  link.click();
  URL.revokeObjectURL(url);
}
