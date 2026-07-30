import { describe, expect, it } from "vitest";
import type { ExtractEvent } from "@/lib/extract-protocol";
import { createEventParser, encodeEvent } from "@/lib/protocol";

describe("extract protocol", () => {
  it("round-trips a stage event", () => {
    const event: ExtractEvent = { type: "stage", stage: "extracting" };
    const parse = createEventParser<ExtractEvent>();
    expect(parse(encodeEvent(event))).toEqual([event]);
  });

  it("round-trips a notice event", () => {
    const event: ExtractEvent = {
      type: "notice",
      kind: "rate_limited",
      message: "Slow down.",
    };
    const parse = createEventParser<ExtractEvent>();
    expect(parse(encodeEvent(event))).toEqual([event]);
  });

  it("holds a partial frame until the rest arrives", () => {
    const parse = createEventParser<ExtractEvent>();
    const encoded = encodeEvent<ExtractEvent>({
      type: "stage",
      stage: "verifying",
    });
    const split = Math.floor(encoded.length / 2);

    expect(parse(encoded.slice(0, split))).toEqual([]);
    expect(parse(encoded.slice(split))).toEqual([
      { type: "stage", stage: "verifying" },
    ]);
  });
});
