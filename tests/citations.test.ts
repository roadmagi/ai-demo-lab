import { describe, expect, it } from "vitest";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import {
  AnswerAccumulator,
  answerText,
  cleanAnswer,
  hasNoAnswerSentinel,
  NO_ANSWER_SENTINEL,
} from "@/lib/citations";

const SOURCE =
  "Read-only workspaces are kept for 90 days. After that the data is deleted.";

function blockStart(index: number): RawMessageStreamEvent {
  return {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "", citations: null },
  } as RawMessageStreamEvent;
}

function textDelta(index: number, text: string): RawMessageStreamEvent {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  } as RawMessageStreamEvent;
}

function citationDelta(
  index: number,
  start: number,
  end: number,
  documentIndex = 0,
): RawMessageStreamEvent {
  return {
    type: "content_block_delta",
    index,
    delta: {
      type: "citations_delta",
      citation: {
        type: "char_location",
        cited_text: SOURCE.slice(start, end),
        document_index: documentIndex,
        document_title: "Billing and plans",
        start_char_index: start,
        end_char_index: end,
        file_id: null,
      },
    },
  } as RawMessageStreamEvent;
}

function blockStop(index: number): RawMessageStreamEvent {
  return { type: "content_block_stop", index } as RawMessageStreamEvent;
}

describe("AnswerAccumulator", () => {
  it("builds segments and attaches citation markers", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "Your workspace stays readable "));
    acc.handle(blockStop(0));
    acc.handle(blockStart(1));
    acc.handle(textDelta(1, "for 90 days."));
    acc.handle(citationDelta(1, 0, 46));
    acc.handle(blockStop(1));

    const answer = acc.result();
    expect(answer.segments).toHaveLength(2);
    expect(answer.segments[0].markers).toEqual([]);
    expect(answer.segments[1].markers).toEqual([1]);
    expect(answerText(answer)).toBe(
      "Your workspace stays readable for 90 days.",
    );
  });

  it("maps citation offsets back to the exact source substring", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "Kept for 90 days."));
    acc.handle(citationDelta(0, 0, 46));
    acc.handle(blockStop(0));

    const [citation] = acc.result().citations;
    expect(
      SOURCE.slice(citation.startCharIndex, citation.endCharIndex),
    ).toBe(citation.citedText);
  });

  it("dedupes a citation repeated across segments but keeps both markers", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "First. "));
    acc.handle(citationDelta(0, 0, 46));
    acc.handle(blockStop(0));
    acc.handle(blockStart(1));
    acc.handle(textDelta(1, "Second."));
    acc.handle(citationDelta(1, 0, 46));
    acc.handle(blockStop(1));

    const answer = acc.result();
    expect(answer.citations).toHaveLength(1);
    expect(answer.segments[0].markers).toEqual([1]);
    expect(answer.segments[1].markers).toEqual([1]);
  });

  it("numbers distinct citations in first-appearance order", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "Two sources."));
    acc.handle(citationDelta(0, 0, 20));
    acc.handle(citationDelta(0, 30, 50, 1));
    acc.handle(blockStop(0));

    const answer = acc.result();
    expect(answer.citations.map((c) => c.marker)).toEqual([1, 2]);
    expect(answer.citations.map((c) => c.documentIndex)).toEqual([0, 1]);
    expect(answer.segments[0].markers).toEqual([1, 2]);
  });

  it("ignores non-text blocks and citation shapes it can't anchor", () => {
    const acc = new AnswerAccumulator();
    acc.handle({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    } as RawMessageStreamEvent);
    acc.handle(textDelta(0, "should be ignored"));
    acc.handle({
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "citations_delta",
        citation: {
          type: "page_location",
          cited_text: "x",
          document_index: 0,
          document_title: null,
          start_page_number: 1,
          end_page_number: 2,
          file_id: null,
        },
      },
    } as RawMessageStreamEvent);

    expect(acc.result().segments).toHaveLength(0);
    expect(acc.result().citations).toHaveLength(0);
  });

  it("drops empty segments from the result", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(blockStop(0));
    expect(acc.result().segments).toHaveLength(0);
  });

  it("keeps the space that joins two segments", () => {
    // Regression: the API splits the answer into a new text block whenever the
    // supporting citations change, and the space before the next block sits at
    // the end of the previous one. Trimming segments welds sentences together
    // ("...period ends,the workspace...").
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "When your billing period ends, "));
    acc.handle(citationDelta(0, 0, 20));
    acc.handle(blockStop(0));
    acc.handle(blockStart(1));
    acc.handle(textDelta(1, "the workspace becomes read-only."));
    acc.handle(citationDelta(1, 20, 40));
    acc.handle(blockStop(1));

    const cleaned = cleanAnswer(acc.result());
    const joined = cleaned.segments.map((segment) => segment.text).join("");
    expect(joined).toBe(
      "When your billing period ends, the workspace becomes read-only.",
    );
    expect(joined).not.toContain("ends,the");
  });

  it("is safe to read mid-stream", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "partial"));
    expect(answerText(acc.result())).toBe("partial");
  });
});

describe("no-answer sentinel", () => {
  it("detects the sentinel and strips it from rendered text", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(
      textDelta(0, `I can't find that in the help center. ${NO_ANSWER_SENTINEL}`),
    );
    acc.handle(blockStop(0));

    const answer = acc.result();
    expect(hasNoAnswerSentinel(answer)).toBe(true);
    expect(answerText(answer)).toBe("I can't find that in the help center.");
    expect(answerText(answer)).not.toContain(NO_ANSWER_SENTINEL);
  });

  it("cleanAnswer removes segments that were only the sentinel", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "Not covered."));
    acc.handle(blockStop(0));
    acc.handle(blockStart(1));
    acc.handle(textDelta(1, NO_ANSWER_SENTINEL));
    acc.handle(blockStop(1));

    const cleaned = cleanAnswer(acc.result());
    expect(cleaned.segments).toHaveLength(1);
    expect(cleaned.segments[0].text).toBe("Not covered.");
  });

  it("leaves no trailing blank line where the sentinel was", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(
      textDelta(0, `That isn't documented.\n\n${NO_ANSWER_SENTINEL}`),
    );
    acc.handle(blockStop(0));

    const cleaned = cleanAnswer(acc.result());
    expect(cleaned.segments[0].text).toBe("That isn't documented.");
  });

  it("reports false when the sentinel is absent", () => {
    const acc = new AnswerAccumulator();
    acc.handle(blockStart(0));
    acc.handle(textDelta(0, "Here is the answer."));
    acc.handle(blockStop(0));
    expect(hasNoAnswerSentinel(acc.result())).toBe(false);
  });
});
