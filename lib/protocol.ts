import type { Answer } from "./citations";

/** A document that was sent to the model, in the order it was sent. */
export type SourceRef = {
  /** Matches `documentIndex` on a citation. */
  index: number;
  title: string;
  /** Present for seed-corpus sources; the client already has their text. */
  docId?: string;
  /** Present for sources the client can't resolve on its own (uploads). */
  text?: string;
};

export type ChatEvent =
  | { type: "meta"; mode: "live" | "cached"; sources: SourceRef[] }
  | { type: "answer"; answer: Answer }
  | {
      type: "done";
      noAnswer: boolean;
      cached: boolean;
      usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
    }
  | { type: "notice"; kind: "rate_limited" | "budget_exhausted" | "error"; message: string };

/** Payload stored in the response cache. */
export type CachedAnswer = {
  answer: Answer;
  sources: SourceRef[];
  noAnswer: boolean;
};

/**
 * Generic over the event type so `/api/chat` and `/api/extract` share one wire
 * format. Defaults to `ChatEvent`, so every existing call site is unchanged.
 */
export function encodeEvent<T = ChatEvent>(event: T): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Parses an SSE body into events. Tolerates partial trailing frames. */
export function createEventParser<T = ChatEvent>() {
  let buffer = "";
  return function push(chunk: string): T[] {
    buffer += chunk;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    const events: T[] = [];
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as T);
      } catch {
        // A frame that doesn't parse is dropped rather than killing the
        // stream — the next one is usually fine.
      }
    }
    return events;
  };
}
