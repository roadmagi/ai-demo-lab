"use client";

import { useEffect, useMemo, useRef } from "react";
import { splitByCitations, type Span } from "@/lib/highlight";
import type { VerifiedField } from "@/lib/verify";

/**
 * The document text with each verified quote highlighted.
 *
 * Reuses demo 1's highlighter and its `.cite-span` styling: verification
 * produces the same `{start, end, marker}` spans the citation path does, and
 * `splitByCitations` already handles overlapping and out-of-order ranges.
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Only located fields can be highlighted; the marker is an index into this
  // filtered list, so it has to be derived from the same array both times.
  const located = useMemo(
    () => fields.filter((field) => field.span !== null),
    [fields],
  );

  const activeMarker = located.findIndex((field) => field.path === activePath);

  const pieces = useMemo(() => {
    const spans: Span[] = located.map((field, index) => ({
      start: field.span!.start,
      end: field.span!.end,
      marker: index,
    }));
    return splitByCitations(text, spans);
  }, [located, text]);

  // Long documents push most highlights out of view, so hovering a field
  // brings its quote to the reader rather than asking them to hunt for it.
  useEffect(() => {
    if (activeMarker < 0) return;
    scrollRef.current
      ?.querySelector(`[data-marker="${activeMarker}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeMarker]);

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-line bg-card">
      <header className="border-b border-line px-5 py-3">
        <p className="text-sm font-medium text-ink">Document text</p>
        <p className="mt-0.5 text-xs text-muted">
          Extracted from the PDF. Highlights are the exact text each field was
          read from.
        </p>
      </header>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-5 py-4">
        <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
          {pieces.map((piece, index) =>
            piece.marker === null ? (
              <span key={index} className="text-muted">
                {piece.text}
              </span>
            ) : (
              <mark
                key={index}
                data-marker={piece.marker}
                data-active={piece.marker === activeMarker}
                className="cite-span text-ink"
              >
                {piece.text}
              </mark>
            ),
          )}
        </pre>
      </div>
    </aside>
  );
}
