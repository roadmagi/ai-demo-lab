import { createHash } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { getClient, hasApiKey, MODEL } from "@/lib/anthropic";
import type { CachedExtraction, ExtractEvent } from "@/lib/extract-protocol";
import {
  checkRateLimit,
  configFromEnv,
  readBudget,
  recordExtraction,
  visitorId,
} from "@/lib/guard";
import { EXTRACT_SYSTEM_PROMPT, INVOICE_TOOL, type Invoice } from "@/lib/invoice";
import { extractPdf, PdfError } from "@/lib/pdf";
import { encodeEvent } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { verifyInvoice } from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Well inside the API's 32 MB / 600 page ceilings, and far above any invoice. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 10;
/** Lower than chat's 12: a page is ~1,500-3,000 text tokens *plus* image tokens. */
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60 * 60;

/**
 * Fingerprint of everything that decides how a PDF is read. Part of the cache
 * key, so tightening the prompt or changing the schema retires stale results
 * instead of serving answers the current code would never produce.
 */
const EXTRACTION_VERSION = createHash("sha256")
  .update(EXTRACT_SYSTEM_PROMPT)
  .update(JSON.stringify(INVOICE_TOOL))
  .digest("hex")
  .slice(0, 8);

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

function streamOf(events: ExtractEvent[]): Response {
  return new Response(events.map((event) => encodeEvent(event)).join(""), {
    headers: SSE_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  if (!hasApiKey()) {
    return Response.json(
      { error: "The demo is missing its ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }

  let file: File | null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Malformed upload." }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "Attach a PDF invoice." }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "This demo reads PDFs. Scans and images aren't supported." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let text: string;
  let pages: number;
  try {
    ({ text, pages } = await extractPdf(bytes));
  } catch (error) {
    if (error instanceof PdfError) {
      // A scan is a stated limitation, not a malformed request: 422, not 400.
      const status = error.code === "no_text" ? 422 : 400;
      return Response.json({ error: error.message }, { status });
    }
    throw error;
  }

  if (pages > MAX_PAGES) {
    return Response.json(
      { error: `That PDF has ${pages} pages; the limit is ${MAX_PAGES}.` },
      { status: 413 },
    );
  }

  const store = getStore();
  const config = configFromEnv();
  const visitor = visitorId(request.headers);

  // Keyed on the bytes *and* on how they were interpreted, so re-running a
  // bundled sample during a demo is free while editing the prompt or the
  // schema invalidates every stale result. Demo 1 folds the corpus
  // fingerprint into its key for the same reason.
  //
  // Only the verified result is stored — never the PDF.
  const key = `extract:${EXTRACTION_VERSION}:${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`;

  const cached = await store.getJSON<CachedExtraction>(key);
  if (cached) {
    return streamOf([
      { type: "result", invoice: cached.invoice, text: cached.text, cached: true },
    ]);
  }

  const rate = await checkRateLimit(store, {
    identifier: visitor,
    bucket: "extract",
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
  });
  if (!rate.allowed) {
    return streamOf([
      {
        type: "notice",
        kind: "rate_limited",
        message: `You've extracted ${RATE_LIMIT} invoices this hour, which is the per-visitor limit — each one costs several times what a chat question does. The bundled samples still work instantly. Full access returns in about ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.`,
      },
    ]);
  }

  const budget = await readBudget(store, config.dailyTokenBudget);
  if (budget.exhausted) {
    return streamOf([
      {
        type: "notice",
        kind: "budget_exhausted",
        message:
          "The lab has spent its token budget for today, so new extractions are paused until midnight UTC. Invoices someone has already run still return instantly.",
      },
    ]);
  }

  return streamExtraction({ bytes, text, key, store, config });
}

function streamExtraction({
  bytes,
  text,
  key,
  store,
  config,
}: {
  bytes: Uint8Array;
  text: string;
  key: string;
  store: ReturnType<typeof getStore>;
  config: ReturnType<typeof configFromEnv>;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ExtractEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)));

      try {
        send({ type: "stage", stage: "extracting" });

        const message = await getClient().messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: EXTRACT_SYSTEM_PROMPT,
          tools: [INVOICE_TOOL],
          tool_choice: { type: "tool", name: INVOICE_TOOL.name },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: Buffer.from(bytes).toString("base64"),
                  },
                  // Citations stay OFF. Enabling them alongside a strict
                  // schema is a hard 400, and PDF citations are page-level
                  // anyway — useless on a one-page invoice. Grounding comes
                  // from quote verification instead.
                },
                { type: "text", text: "Extract this invoice." },
              ],
            },
          ],
        });

        const call = message.content.find((block) => block.type === "tool_use");
        if (!call || call.type !== "tool_use") {
          throw new Error("Model returned no tool call");
        }

        send({ type: "stage", stage: "verifying" });

        const invoice = verifyInvoice(call.input as Invoice, text);
        send({ type: "result", invoice, text, cached: false });

        const spend =
          message.usage.input_tokens +
          message.usage.output_tokens +
          (message.usage.cache_creation_input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0);

        after(() =>
          recordExtraction(store, {
            key,
            payload: { invoice, text } satisfies CachedExtraction,
            spend,
            cacheTtlSeconds: config.cacheTtlSeconds,
          }),
        );

        controller.close();
      } catch (error) {
        console.error("[extract] extraction failed", error);
        send({
          type: "notice",
          kind: "error",
          message: "Something broke on the way to the model. Try again in a moment.",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
