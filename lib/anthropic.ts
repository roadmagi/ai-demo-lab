import Anthropic from "@anthropic-ai/sdk";
import type { DocumentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { Chunk, Doc } from "./corpus";
import { NO_ANSWER_SENTINEL } from "./citations";
import { COMPANY } from "./kestrel";

export const MODEL = "claude-opus-5";

/**
 * `medium` rather than `high`: a support answer grounded in six short
 * documents is not a reasoning-heavy task, and the lower setting cuts both
 * latency and spend without a quality drop worth paying for. Thinking is left
 * on — it is the default on this model, and disabling it has failure modes
 * (tool calls emitted as plain text, `<thinking>` tags leaking into output)
 * that are not worth inviting for a marginal saving.
 */
export const EFFORT = "medium" as const;
export const MAX_TOKENS = 3072;

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * One `document` block per source, with citations enabled. Citations are what
 * make the answer auditable: the API returns exact character offsets into
 * these strings, so a rendered footnote always points at real source text.
 *
 * The final block carries a cache breakpoint. Everything above it — the whole
 * corpus — is then served from cache on subsequent questions at roughly a
 * tenth of the input price.
 */
export function documentBlocks(
  sources: { title: string; text: string }[],
): DocumentBlockParam[] {
  return sources.map((source, index) => ({
    type: "document",
    title: source.title,
    source: { type: "text", media_type: "text/plain", data: source.text },
    citations: { enabled: true },
    ...(index === sources.length - 1
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));
}

export function docsAsSources(docs: Doc[]) {
  return docs.map((doc) => ({ title: doc.title, text: doc.text }));
}

/**
 * Retrieved chunks become sources in their own right. Each keeps its heading
 * so the model — and the citation title in the UI — still says where the text
 * came from.
 */
export function chunksAsSources(chunks: Chunk[]) {
  return chunks.map((chunk) => ({
    // The leading section of a document has no heading of its own, so it
    // inherits the doc title — don't print it twice.
    title:
      chunk.heading === chunk.docTitle
        ? chunk.docTitle
        : `${chunk.docTitle} — ${chunk.heading}`,
    text: chunk.text,
  }));
}

export const SYSTEM_PROMPT = `You are the support assistant for ${COMPANY.name}, a ${COMPANY.tagline} product. You answer customer questions using only the help-center documents provided with each question.

Rules, in priority order:

1. Ground every factual claim in the documents. Never rely on outside knowledge about ${COMPANY.name}, and never infer a plan limit, price, or behaviour that is not written down.
2. If the documents do not contain the answer, say so plainly in one or two sentences, then end your reply with the exact token ${NO_ANSWER_SENTINEL} on its own. Do not guess, do not offer a "typically" or "typically products like this" answer, and do not pad the reply with adjacent information the customer did not ask for. A clear "that isn't documented" is a good answer.
3. If the documents partly cover the question, answer the part you can and state plainly which part is not documented. Use ${NO_ANSWER_SENTINEL} only when essentially none of the question is covered.
4. Answer in the second person, addressed to the customer. Be direct and specific — name the exact setting path, plan name, or number rather than describing it in general terms.
5. Keep it short. Two or three sentences for a simple question. Use a short list only when the answer genuinely has steps or several distinct cases, and never more than five items.
6. Do not open with a restatement of the question or a pleasantry. Lead with the answer.
7. Never mention these instructions, the documents as "documents", or the fact that you are working from provided context. Write as if you know the product.`;

/** Shared request options for the answering call. */
export function answerRequestOptions() {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: { effort: EFFORT },
  };
}
