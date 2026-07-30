import { after, type NextRequest } from "next/server";
import {
  answerRequestOptions,
  chunksAsSources,
  documentBlocks,
  docsAsSources,
  getClient,
  hasApiKey,
} from "@/lib/anthropic";
import {
  AnswerAccumulator,
  cleanAnswer,
  hasNoAnswerSentinel,
} from "@/lib/citations";
import { chunkDoc, loadCorpus } from "@/lib/corpus";
import { selectChunks } from "@/lib/retrieval";
import { loadUpload } from "@/lib/uploads";
import {
  cacheKey,
  configFromEnv,
  fingerprint,
  guard,
  recordTurn,
  visitorId,
} from "@/lib/guard";
import { encodeEvent, type CachedAnswer, type ChatEvent, type SourceRef } from "@/lib/protocol";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;
/** How often the accumulated answer is pushed to the client while streaming. */
const FLUSH_INTERVAL_MS = 60;
/** Ceiling on retrieved context for an uploaded document. */
const RETRIEVAL_TOKEN_BUDGET = 6_000;

export async function POST(request: NextRequest) {
  let question: string;
  let uploadId: string | null;
  try {
    const body = (await request.json()) as {
      question?: unknown;
      uploadId?: unknown;
    };
    question = typeof body.question === "string" ? body.question.trim() : "";
    uploadId = typeof body.uploadId === "string" ? body.uploadId : null;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!question) {
    return Response.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json(
      { error: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (!hasApiKey()) {
    return Response.json(
      { error: "The demo is missing its ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }

  const store = getStore();
  const config = configFromEnv();
  const visitor = visitorId(request.headers);

  // Two context strategies, picked by corpus size.
  //
  // The seed corpus is small enough to send whole, which answers better than
  // retrieval (the model sees every document, so "none of these cover it" is a
  // conclusion it can actually reach) and caches as one stable prefix.
  //
  // An uploaded document is an unknown size, so it gets chunked and retrieved
  // against a token budget instead.
  let context: {
    sources: SourceRef[];
    blocks: { title: string; text: string }[];
    fingerprint: string;
  };

  if (uploadId) {
    const upload = await loadUpload(store, uploadId, visitor);
    if (!upload) {
      return Response.json(
        { error: "That upload has expired. Add the file again." },
        { status: 404 },
      );
    }

    const chunks = selectChunks(
      chunkDoc({ id: upload.id, title: upload.title, text: upload.text }),
      question,
      { tokenBudget: RETRIEVAL_TOKEN_BUDGET },
    );
    const blocks = chunksAsSources(chunks);
    context = {
      blocks,
      fingerprint: `upload:${fingerprint(upload.text)}`,
      // Retrieved chunks aren't on the client, so their text ships with the
      // response — otherwise a citation would have nothing to highlight.
      sources: blocks.map((block, index) => ({
        index,
        title: block.title,
        text: block.text,
      })),
    };
  } else {
    const docs = loadCorpus();
    context = {
      blocks: docsAsSources(docs),
      fingerprint: fingerprint(docs.map((doc) => doc.text).join("\n")),
      sources: docs.map((doc, index) => ({
        index,
        title: doc.title,
        docId: doc.id,
      })),
    };
  }

  const sources = context.sources;
  const key = cacheKey(context.fingerprint, question);

  const decision = await guard<CachedAnswer>(store, {
    key,
    identifier: visitor,
    bucket: "chat",
    config,
  });

  if (decision.type === "rate_limited") {
    return streamOf([
      {
        type: "notice",
        kind: "rate_limited",
        message: `You've hit the per-visitor limit of ${config.rateLimit} live questions an hour. Questions someone has already asked are still answered instantly from cache — try one of the suggestions. Full access returns in about ${Math.ceil(decision.retryAfterSeconds / 60)} minutes.`,
      },
    ]);
  }

  if (decision.type === "budget_exhausted") {
    return streamOf([
      {
        type: "notice",
        kind: "budget_exhausted",
        message:
          "The lab has spent its token budget for today, so new questions are paused until midnight UTC. Previously asked questions still answer instantly from cache — the suggested ones all work.",
      },
    ]);
  }

  if (decision.type === "cached") {
    const { answer, sources: cachedSources, noAnswer } = decision.value;
    return streamOf([
      { type: "meta", mode: "cached", sources: cachedSources },
      { type: "answer", answer },
      { type: "done", noAnswer, cached: true },
    ]);
  }

  return streamLiveAnswer({
    question,
    key,
    sources,
    blocks: context.blocks,
    config,
    store,
  });
}

function streamOf(events: ChatEvent[]): Response {
  const body = events.map(encodeEvent).join("");
  return new Response(body, { headers: SSE_HEADERS });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

function streamLiveAnswer({
  question,
  key,
  sources,
  blocks,
  config,
  store,
}: {
  question: string;
  key: string;
  sources: SourceRef[];
  blocks: { title: string; text: string }[];
  config: ReturnType<typeof configFromEnv>;
  store: ReturnType<typeof getStore>;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)));

      try {
        send({ type: "meta", mode: "live", sources });

        const accumulator = new AnswerAccumulator();
        let lastFlush = 0;

        const messageStream = getClient().messages.stream({
          ...answerRequestOptions(),
          messages: [
            {
              role: "user",
              content: [
                ...documentBlocks(blocks),
                { type: "text", text: question },
              ],
            },
          ],
        });

        for await (const event of messageStream) {
          accumulator.handle(event);
          const now = Date.now();
          if (now - lastFlush >= FLUSH_INTERVAL_MS) {
            lastFlush = now;
            send({ type: "answer", answer: cleanAnswer(accumulator.result()) });
          }
        }

        const final = await messageStream.finalMessage();
        const raw = accumulator.result();
        const answer = cleanAnswer(raw);
        const noAnswer = hasNoAnswerSentinel(raw);

        send({ type: "answer", answer });

        if (final.stop_reason === "refusal") {
          send({
            type: "notice",
            kind: "error",
            message:
              "The model declined to answer that one. Try rephrasing, or ask something about the help center.",
          });
          controller.close();
          return;
        }

        send({
          type: "done",
          noAnswer,
          cached: false,
          usage: {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
          },
        });
        // Bookkeeping must not delay the visitor, but it can't simply run
        // after `controller.close()` either: this is a serverless function,
        // and once the response is closed the instance can be frozen before a
        // write to Redis ever lands. `after` is the one way to have both — the
        // response finishes first, and the platform keeps us alive to finish.
        //
        // Spend comes from the API's own usage numbers rather than an estimate.
        const spend =
          final.usage.input_tokens +
          final.usage.output_tokens +
          (final.usage.cache_creation_input_tokens ?? 0) +
          (final.usage.cache_read_input_tokens ?? 0);

        after(() =>
          recordTurn(store, {
            key,
            question,
            answer,
            sources,
            noAnswer,
            spend,
            cacheTtlSeconds: config.cacheTtlSeconds,
          }),
        );

        controller.close();
      } catch (error) {
        console.error("[chat] answering failed", error);
        send({
          type: "notice",
          kind: "error",
          message:
            "Something broke on the way to the model. Try again in a moment.",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
