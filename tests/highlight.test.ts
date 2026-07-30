import { describe, expect, it } from "vitest";
import { splitByCitations } from "@/lib/highlight";

const TEXT = "Read-only workspaces are kept for 90 days. Then they are deleted.";

function rejoin(pieces: { text: string }[]) {
  return pieces.map((piece) => piece.text).join("");
}

describe("splitByCitations", () => {
  it("returns the whole text unmarked when there are no spans", () => {
    expect(splitByCitations(TEXT, [])).toEqual([{ text: TEXT, marker: null }]);
  });

  it("marks the cited range and leaves the rest plain", () => {
    const pieces = splitByCitations(TEXT, [{ start: 0, end: 41, marker: 1 }]);
    expect(pieces).toEqual([
      { text: "Read-only workspaces are kept for 90 days", marker: 1 },
      { text: ". Then they are deleted.", marker: null },
    ]);
  });

  it("never loses or duplicates a character", () => {
    const cases = [
      [{ start: 0, end: 10, marker: 1 }],
      [
        { start: 5, end: 12, marker: 1 },
        { start: 42, end: 60, marker: 2 },
      ],
      [{ start: 0, end: TEXT.length, marker: 1 }],
    ];
    for (const spans of cases) {
      expect(rejoin(splitByCitations(TEXT, spans))).toBe(TEXT);
    }
  });

  it("orders pieces by position even when spans arrive out of order", () => {
    const pieces = splitByCitations(TEXT, [
      { start: 42, end: 65, marker: 2 },
      { start: 0, end: 9, marker: 1 },
    ]);
    expect(pieces.map((p) => p.marker)).toEqual([1, null, 2]);
    expect(rejoin(pieces)).toBe(TEXT);
  });

  it("drops an overlapping span rather than duplicating text", () => {
    const pieces = splitByCitations(TEXT, [
      { start: 0, end: 20, marker: 1 },
      { start: 10, end: 30, marker: 2 },
    ]);
    expect(rejoin(pieces)).toBe(TEXT);
    expect(pieces.map((p) => p.marker)).toEqual([1, null]);
  });

  it("clamps offsets that run past the end of the text", () => {
    const pieces = splitByCitations(TEXT, [
      { start: 50, end: 9_999, marker: 1 },
    ]);
    expect(rejoin(pieces)).toBe(TEXT);
    expect(pieces.at(-1)).toEqual({ text: TEXT.slice(50), marker: 1 });
  });

  it("ignores empty and inverted spans", () => {
    const pieces = splitByCitations(TEXT, [
      { start: 10, end: 10, marker: 1 },
      { start: 30, end: 20, marker: 2 },
      { start: -5, end: -1, marker: 3 },
    ]);
    expect(pieces).toEqual([{ text: TEXT, marker: null }]);
  });

  it("handles an empty document", () => {
    expect(splitByCitations("", [{ start: 0, end: 5, marker: 1 }])).toEqual([]);
  });
});
