import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";

/**
 * A citation as the UI needs it: which source document, and the exact
 * character range inside it. These offsets come straight from the API — they
 * are not inferred from the answer text — which is why a citation here can
 * never point at something the source doesn't say.
 */
export type Citation = {
  /** 1-based, in the order citations first appear in the answer. */
  marker: number;
  documentIndex: number;
  documentTitle: string;
  citedText: string;
  startCharIndex: number;
  endCharIndex: number;
};

/** A run of answer text, plus the citations attached to that run. */
export type AnswerSegment = {
  text: string;
  /** Markers of the citations supporting this segment. */
  markers: number[];
};

export type Answer = {
  segments: AnswerSegment[];
  citations: Citation[];
};

/** Sentinel the system prompt asks for when the sources don't cover the question. */
export const NO_ANSWER_SENTINEL = "[[NO_ANSWER]]";

/**
 * Folds the Anthropic stream into an answer.
 *
 * With citations enabled the response arrives as several `text` blocks rather
 * than one: the model opens a new block whenever the set of supporting
 * citations changes. Each block therefore maps cleanly onto one segment, which
 * is what lets the UI attach footnote markers to the right sentences.
 */
export class AnswerAccumulator {
  private segments: AnswerSegment[] = [];
  private citations: Citation[] = [];
  /** Dedupes citations that repeat across segments, keyed by doc + span. */
  private markerByKey = new Map<string, number>();
  private openIndex: number | null = null;

  handle(event: RawMessageStreamEvent): void {
    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type !== "text") return;
        this.openIndex = this.segments.length;
        this.segments.push({ text: "", markers: [] });
        return;
      }
      case "content_block_delta": {
        if (this.openIndex === null) return;
        const segment = this.segments[this.openIndex];
        if (event.delta.type === "text_delta") {
          segment.text += event.delta.text;
        } else if (event.delta.type === "citations_delta") {
          const marker = this.addCitation(event.delta.citation);
          if (marker !== null && !segment.markers.includes(marker)) {
            segment.markers.push(marker);
          }
        }
        return;
      }
      case "content_block_stop": {
        this.openIndex = null;
        return;
      }
      default:
        return;
    }
  }

  private addCitation(
    citation: import("@anthropic-ai/sdk/resources/messages").CitationsDelta["citation"],
  ): number | null {
    // Text documents always yield char_location. Other shapes (page, content
    // block, web search) belong to inputs this demo doesn't send; ignoring
    // them keeps a surprise from rendering as a broken footnote.
    if (citation.type !== "char_location") return null;

    const key = `${citation.document_index}:${citation.start_char_index}:${citation.end_char_index}`;
    const existing = this.markerByKey.get(key);
    if (existing !== undefined) return existing;

    const marker = this.citations.length + 1;
    this.markerByKey.set(key, marker);
    this.citations.push({
      marker,
      documentIndex: citation.document_index,
      documentTitle: citation.document_title ?? "Source",
      citedText: citation.cited_text,
      startCharIndex: citation.start_char_index,
      endCharIndex: citation.end_char_index,
    });
    return marker;
  }

  /** The answer so far. Safe to call mid-stream. */
  result(): Answer {
    return {
      segments: this.segments.filter((segment) => segment.text.length > 0),
      citations: this.citations,
    };
  }
}

/** Plain text of an answer, with the sentinel removed. */
export function answerText(answer: Answer): string {
  return stripSentinel(
    answer.segments.map((segment) => segment.text).join(""),
  ).trimEnd();
}

export function hasNoAnswerSentinel(answer: Answer): boolean {
  return answer.segments.some((segment) =>
    segment.text.includes(NO_ANSWER_SENTINEL),
  );
}

/**
 * Removes the sentinel token and nothing else.
 *
 * Deliberately does not trim: an answer arrives as several text blocks that
 * are concatenated for display, and the space before the next block lives at
 * the end of the previous one. Trimming here silently welds sentences
 * together ("...period ends,the workspace...").
 */
export function stripSentinel(text: string): string {
  return text.split(NO_ANSWER_SENTINEL).join("");
}

/**
 * Removes the sentinel from every segment and drops any segment left empty,
 * so the UI never renders it and never renders a blank paragraph in its place.
 */
export function cleanAnswer(answer: Answer): Answer {
  const segments = answer.segments
    .map((segment) => ({ ...segment, text: stripSentinel(segment.text) }))
    .filter((segment) => segment.text.trim().length > 0);

  // Trim the tail of the last segment only. The sentinel usually sits on its
  // own line, so removing it leaves trailing newlines that render as a blank
  // gap. Earlier segments keep their trailing space — that space is what
  // separates them from the segment that follows.
  const last = segments.at(-1);
  if (last) last.text = last.text.trimEnd();

  return { citations: answer.citations, segments };
}
