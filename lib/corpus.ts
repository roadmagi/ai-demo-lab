import fs from "node:fs";
import path from "node:path";

export type Doc = {
  /** Slug derived from the filename, e.g. `billing-and-plans`. */
  id: string;
  /** Human title, taken from the first `# ` heading. */
  title: string;
  /** Full document text. Citation offsets are relative to this string. */
  text: string;
};

export type Chunk = {
  /** `${docId}#${index}` */
  id: string;
  docId: string;
  docTitle: string;
  /** Nearest `## ` heading above this chunk, or the doc title. */
  heading: string;
  text: string;
  approxTokens: number;
};

const CORPUS_DIR = path.join(process.cwd(), "content", "kestrel");

/**
 * Rough token estimate. Deliberately not a real tokenizer: this only ever
 * needs to answer "will this fit in the budget", and being ~10% pessimistic
 * is the safe direction to be wrong in. Use the API's own usage numbers for
 * anything that touches billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

function titleFrom(text: string, fallback: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

let cached: Doc[] | null = null;

/** Loads the seed corpus from disk. Cached for the life of the process. */
export function loadCorpus(): Doc[] {
  if (cached) return cached;

  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();

  cached = files.map((name) => {
    const id = name.replace(/\.md$/, "");
    // Normalise line endings so citation character offsets returned by the
    // API line up with what the browser renders. On Windows a CRLF file would
    // otherwise shift every offset after the first newline.
    const text = fs
      .readFileSync(path.join(CORPUS_DIR, name), "utf8")
      .replace(/\r\n/g, "\n");
    return { id, title: titleFrom(text, id), text };
  });

  return cached;
}

/**
 * Splits a document on `## ` headings, then splits any oversized section on
 * blank lines. Headings are kept with their body so a retrieved chunk still
 * reads as a unit.
 */
export function chunkDoc(doc: Doc, maxTokens = 400): Chunk[] {
  const sections = splitOnHeadings(doc.text);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    for (const body of splitToSize(section.body, maxTokens)) {
      const trimmed = body.trim();
      if (!trimmed) continue;
      chunks.push({
        id: `${doc.id}#${chunks.length}`,
        docId: doc.id,
        docTitle: doc.title,
        heading: section.heading || doc.title,
        text: trimmed,
        approxTokens: estimateTokens(trimmed),
      });
    }
  }

  return chunks;
}

export function chunkCorpus(docs: Doc[], maxTokens = 400): Chunk[] {
  return docs.flatMap((doc) => chunkDoc(doc, maxTokens));
}

function splitOnHeadings(text: string): { heading: string; body: string }[] {
  const lines = text.split("\n");
  const sections: { heading: string; body: string }[] = [];
  let heading = "";
  let body: string[] = [];

  const flush = () => {
    if (body.length) sections.push({ heading, body: body.join("\n") });
    body = [];
  };

  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      flush();
      heading = match[2].trim();
      body.push(line);
    } else {
      body.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Packs paragraphs up to `maxTokens`. A single paragraph over the limit is
 * emitted whole rather than cut mid-sentence — an oversized but coherent chunk
 * beats a tidy but truncated one.
 */
function splitToSize(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const tokens = estimateTokens(paragraph);
    if (current.length && currentTokens + tokens > maxTokens) {
      out.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(paragraph);
    currentTokens += tokens;
  }
  if (current.length) out.push(current.join("\n\n"));

  return out;
}
