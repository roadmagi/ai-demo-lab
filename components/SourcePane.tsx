"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Citation } from "@/lib/citations";
import { splitByCitations } from "@/lib/highlight";

export type ResolvedSource = { index: number; title: string; text: string };

type Props = {
  sources: ResolvedSource[];
  citations: Citation[];
  activeMarker: number | null;
  onSelectMarker: (marker: number | null) => void;
};

export function SourcePane({
  sources,
  citations,
  activeMarker,
  onSelectMarker,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => citations.find((citation) => citation.marker === activeMarker) ?? null,
    [citations, activeMarker],
  );

  // Which document to show: the active citation's, else the first cited one.
  const shownIndex = active?.documentIndex ?? citations[0]?.documentIndex ?? null;
  const doc =
    shownIndex === null
      ? null
      : sources.find((source) => source.index === shownIndex) ?? null;

  const spans = useMemo(
    () =>
      shownIndex === null
        ? []
        : citations
            .filter((citation) => citation.documentIndex === shownIndex)
            .map((citation) => ({
              start: citation.startCharIndex,
              end: citation.endCharIndex,
              marker: citation.marker,
            })),
    [citations, shownIndex],
  );

  const pieces = useMemo(
    () => (doc ? splitByCitations(doc.text, spans) : []),
    [doc, spans],
  );

  useEffect(() => {
    if (activeMarker === null) return;
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(
      `[data-marker="${activeMarker}"]`,
    );
    if (!container || !target) return;

    // scrollIntoView would scroll the whole page as well as this pane, which
    // jumps the conversation out of view. Positioning the pane's own scroll
    // keeps the answer and its source on screen together.
    const top =
      target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeMarker, shownIndex]);

  const citedDocIndexes = useMemo(
    () => [...new Set(citations.map((citation) => citation.documentIndex))],
    [citations],
  );

  if (!doc) {
    return (
      <aside className="flex h-full flex-col rounded-xl border border-line bg-card">
        <header className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Sources</h2>
        </header>
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="max-w-xs text-center text-sm leading-relaxed text-muted text-pretty">
            Ask a question and the help-center text behind the answer appears
            here, with the exact sentences the answer drew on highlighted.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col rounded-xl border border-line bg-card">
      <header className="border-b border-line px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="truncate text-sm font-semibold">{doc.title}</h2>
          {activeMarker !== null && (
            <button
              type="button"
              onClick={() => onSelectMarker(null)}
              className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        {citedDocIndexes.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {citedDocIndexes.map((index) => {
              const source = sources.find((item) => item.index === index);
              if (!source) return null;
              const firstMarker = citations.find(
                (citation) => citation.documentIndex === index,
              )?.marker;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => onSelectMarker(firstMarker ?? null)}
                  className={`rounded-full border px-2 py-0.5 text-xs transition ${
                    index === shownIndex
                      ? "border-brand bg-brand-wash text-brand-ink"
                      : "border-line text-muted hover:border-brand hover:text-ink"
                  }`}
                >
                  {source.title}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-5 py-4">
        <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap break-words text-ink">
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
