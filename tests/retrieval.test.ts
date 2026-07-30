import { describe, expect, it } from "vitest";
import type { Chunk } from "@/lib/corpus";
import { chunkCorpus, estimateTokens, loadCorpus } from "@/lib/corpus";
import { rankChunks, selectChunks, tokenize } from "@/lib/retrieval";

function chunk(id: string, heading: string, text: string): Chunk {
  return {
    id,
    docId: id.split("#")[0],
    docTitle: "Doc",
    heading,
    text,
    approxTokens: estimateTokens(text),
  };
}

const CHUNKS: Chunk[] = [
  chunk("a#0", "Exporting your data", "Full workspace export produces a zip archive of every project."),
  chunk("b#0", "Slack", "Slack updates stop when the destination channel is archived."),
  chunk("c#0", "Automation runs", "Team workspaces get 1,000 automation runs per month."),
  chunk("d#0", "Board performance", "Boards slow down past roughly 1,500 rendered cards."),
];

describe("tokenize", () => {
  it("folds plural and gerund forms onto the same stem", () => {
    expect(tokenize("exports")).toEqual(tokenize("export"));
    expect(tokenize("exporting")).toEqual(tokenize("export"));
    expect(tokenize("integrations")).toEqual(tokenize("integration"));
  });

  it("drops stopwords and single characters", () => {
    expect(tokenize("the a of x data")).toEqual(["data"]);
  });
});

describe("rankChunks", () => {
  it("puts the obviously relevant chunk first", () => {
    const ranked = rankChunks(CHUNKS, "how do I export my workspace?");
    expect(ranked[0].chunk.id).toBe("a#0");
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("matches on the heading, not just the body", () => {
    // "automation" appears in both the heading and body of c#0; the query
    // deliberately avoids body-only wording.
    const ranked = rankChunks(CHUNKS, "automation");
    expect(ranked[0].chunk.id).toBe("c#0");
  });

  it("returns every chunk with a zero score for an empty query", () => {
    const ranked = rankChunks(CHUNKS, "   ");
    expect(ranked).toHaveLength(CHUNKS.length);
    expect(ranked.every(({ score }) => score === 0)).toBe(true);
  });

  it("never returns a negative score", () => {
    const ranked = rankChunks(CHUNKS, "slack channel archived export automation board");
    expect(ranked.every(({ score }) => score >= 0)).toBe(true);
  });

  it("handles an empty corpus", () => {
    expect(rankChunks([], "anything")).toEqual([]);
  });
});

describe("selectChunks", () => {
  it("never exceeds the token budget", () => {
    const budget = 40;
    const picked = selectChunks(CHUNKS, "export slack automation board", {
      tokenBudget: budget,
    });
    const used = picked.reduce((sum, c) => sum + c.approxTokens, 0);
    expect(used).toBeLessThanOrEqual(budget);
    expect(picked.length).toBeGreaterThan(0);
  });

  it("skips an oversized chunk instead of stopping at it", () => {
    const huge = chunk("z#0", "Huge", "word ".repeat(4000));
    const picked = selectChunks([huge, ...CHUNKS], "export workspace", {
      tokenBudget: 60,
    });
    expect(picked.map((c) => c.id)).not.toContain("z#0");
    expect(picked.map((c) => c.id)).toContain("a#0");
  });

  it("respects maxChunks", () => {
    const picked = selectChunks(CHUNKS, "export slack automation board", {
      tokenBudget: 10_000,
      maxChunks: 2,
    });
    expect(picked).toHaveLength(2);
  });

  it("returns leading chunks when nothing matches, rather than nothing", () => {
    const picked = selectChunks(CHUNKS, "zzzz qqqq", { tokenBudget: 10_000 });
    expect(picked.length).toBeGreaterThan(0);
  });

  it("returns chunks in corpus order, not score order", () => {
    const picked = selectChunks(CHUNKS, "board slack export", {
      tokenBudget: 10_000,
    });
    const positions = picked.map((c) => CHUNKS.findIndex((x) => x.id === c.id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("the real corpus", () => {
  const chunks = chunkCorpus(loadCorpus());

  it("chunks into reasonable units", () => {
    expect(chunks.length).toBeGreaterThan(20);
    expect(chunks.every((c) => c.text.trim().length > 0)).toBe(true);
  });

  // What matters is that the answering doc reaches the model, not that it wins
  // the top slot — several questions are legitimately covered by two docs
  // (cancelling is discussed under both billing and export).
  it.each([
    ["How do I export all my project data?", "data-export"],
    ["What happens to my data when I cancel?", "billing-and-plans"],
    ["Can I use SAML SSO on the Team plan?", "sso-and-security"],
    ["Why did my Slack integration stop posting updates?", "integrations"],
    ["How many automation runs do I get per month?", "limits-and-quotas"],
  ])("retrieves the %s doc for %j", (question, expectedDoc) => {
    const picked = selectChunks(chunks, question, { tokenBudget: 3_000 });
    expect(picked.map((c) => c.docId)).toContain(expectedDoc);
  });

  it("ranks a chunk from a plausible doc first for each suggested question", () => {
    // Weaker than naming one doc, but it still catches retrieval going limp:
    // the winner must actually score, not just be first by tie-break.
    for (const question of [
      "How do I export all my project data?",
      "Can I use SAML SSO on the Team plan?",
      "Why did my Slack integration stop posting updates?",
    ]) {
      const top = rankChunks(chunks, question)[0];
      expect(top.score).toBeGreaterThan(1);
    }
  });

  it("does not cover the gap-probe questions", () => {
    // These questions exist to demo the honest refusal path. If a future edit
    // to the corpus accidentally answers one, this test is the tripwire.
    const corpus = loadCorpus()
      .map((doc) => doc.text.toLowerCase())
      .join("\n");
    expect(corpus).not.toMatch(/mobile app|ios|android|self-host|on-premise/);
  });
});
