export type Span = { start: number; end: number; marker: number };

/** A run of source text, tagged with the citation covering it (if any). */
export type Piece = { text: string; marker: number | null };

/**
 * Splits source text into highlighted and plain runs.
 *
 * The offsets come from the API and are trusted to be correct, but not to be
 * well-behaved: they can arrive out of order, can overlap when two citations
 * quote intersecting sentences, and could in principle run past the end of a
 * document the client resolved slightly differently. All three are handled
 * here rather than in the component, because the failure mode in the UI —
 * silently mangled source text — is hard to spot by eye.
 */
export function splitByCitations(text: string, spans: Span[]): Piece[] {
  const valid = spans
    .map((span) => ({
      marker: span.marker,
      start: Math.max(0, Math.min(span.start, text.length)),
      end: Math.max(0, Math.min(span.end, text.length)),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const pieces: Piece[] = [];
  let cursor = 0;

  for (const span of valid) {
    // An overlapping later span is dropped rather than nested: the first
    // citation to claim a range keeps it, so text is never duplicated.
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      pieces.push({ text: text.slice(cursor, span.start), marker: null });
    }
    pieces.push({ text: text.slice(span.start, span.end), marker: span.marker });
    cursor = span.end;
  }

  if (cursor < text.length) {
    pieces.push({ text: text.slice(cursor), marker: null });
  }

  return pieces.filter((piece) => piece.text.length > 0);
}
