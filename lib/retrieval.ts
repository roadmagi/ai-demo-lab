import type { Chunk } from "./corpus";

export type ScoredChunk = { chunk: Chunk; score: number };

const K1 = 1.5;
const B = 0.75;

/**
 * A short stop list. Kept small on purpose — aggressive stopword removal hurts
 * support queries, where words like "not", "can", and "how" carry real intent.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "in",
  "into", "is", "it", "of", "on", "or", "that", "the", "to", "was", "were",
  "will", "with",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term))
    .map(stem);
}

/**
 * Crude suffix stripping, enough to make "exports"/"exporting"/"export" and
 * "integrations"/"integration" collide. Not a real stemmer, and it doesn't
 * need to be — precision here matters less than the recall it buys.
 */
function stem(term: string): string {
  for (const suffix of ["ing", "ies", "es", "s"]) {
    if (term.length > suffix.length + 2 && term.endsWith(suffix)) {
      return suffix === "ies" ? `${term.slice(0, -3)}y` : term.slice(0, -suffix.length);
    }
  }
  return term;
}

/** Ranks every chunk against the query, best first. Ties keep corpus order. */
export function rankChunks(chunks: Chunk[], query: string): ScoredChunk[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || chunks.length === 0) {
    return chunks.map((chunk) => ({ chunk, score: 0 }));
  }

  const docTerms = chunks.map((chunk) =>
    // The heading is part of the searchable text: "## Slack updates have
    // stopped arriving" is often the strongest signal in the whole chunk.
    tokenize(`${chunk.heading} ${chunk.docTitle} ${chunk.text}`),
  );
  const lengths = docTerms.map((terms) => terms.length);
  const avgLength =
    lengths.reduce((sum, length) => sum + length, 0) / (lengths.length || 1);

  const docFreq = new Map<string, number>();
  for (const terms of docTerms) {
    for (const term of new Set(terms)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const total = chunks.length;
  const idf = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    const df = docFreq.get(term) ?? 0;
    // +1 inside the log keeps this non-negative even for terms present in
    // every chunk, so a common term can never drag a score below zero.
    idf.set(term, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
  }

  const scored = chunks.map((chunk, index) => {
    const terms = docTerms[index];
    const freq = new Map<string, number>();
    for (const term of terms) freq.set(term, (freq.get(term) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const tf = freq.get(term);
      if (!tf) continue;
      const norm = 1 - B + (B * lengths[index]) / (avgLength || 1);
      score += (idf.get(term) ?? 0) * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
    return { chunk, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ chunk, score }) => ({ chunk, score }));
}

export type SelectOptions = {
  /** Hard ceiling on the estimated tokens of the returned chunks. */
  tokenBudget: number;
  maxChunks?: number;
  /** Chunks at or below this score are treated as irrelevant. */
  minScore?: number;
};

/**
 * Picks the chunks to send to the model: highest scoring first, stopping at
 * the token budget. Chunks that don't fit are skipped rather than ending the
 * loop, so one oversized chunk can't starve the smaller ones behind it.
 *
 * With an empty or all-miss query this returns the leading chunks up to the
 * budget instead of nothing — the model then gets real context and can say it
 * doesn't know, which beats answering from an empty document set.
 */
export function selectChunks(
  chunks: Chunk[],
  query: string,
  { tokenBudget, maxChunks = 12, minScore = 0 }: SelectOptions,
): Chunk[] {
  const ranked = rankChunks(chunks, query);
  const relevant = ranked.filter(({ score }) => score > minScore);
  const pool = relevant.length > 0 ? relevant : ranked;

  const picked: Chunk[] = [];
  let used = 0;

  for (const { chunk } of pool) {
    if (picked.length >= maxChunks) break;
    if (used + chunk.approxTokens > tokenBudget) continue;
    picked.push(chunk);
    used += chunk.approxTokens;
  }

  // Restore corpus order so the model reads sections in their authored
  // sequence rather than in score order.
  const position = new Map(chunks.map((chunk, index) => [chunk.id, index]));
  return picked.sort(
    (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  );
}
