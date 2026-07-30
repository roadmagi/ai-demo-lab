import type { NextRequest } from "next/server";
import { checkRateLimit, visitorId } from "@/lib/guard";
import { getStore, isPersistent } from "@/lib/store";
import {
  MAX_UPLOAD_CHARS,
  isAcceptedFilename,
  saveUpload,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepts a text document from the visitor. The client reads the file and
 * posts its contents as JSON, which avoids multipart parsing for what is
 * always plain text anyway.
 */
export async function POST(request: NextRequest) {
  let filename: string;
  let text: string;
  try {
    const body = (await request.json()) as {
      filename?: unknown;
      text?: unknown;
    };
    filename = typeof body.filename === "string" ? body.filename : "";
    text = typeof body.text === "string" ? body.text : "";
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!filename || !isAcceptedFilename(filename)) {
    return Response.json(
      { error: "Upload a .md or .txt file. PDFs aren't supported here — see the README for why." },
      { status: 400 },
    );
  }
  if (!text.trim()) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }
  if (text.length > MAX_UPLOAD_CHARS) {
    return Response.json(
      {
        error: `That file is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_UPLOAD_CHARS.toLocaleString("en-US")}.`,
      },
      { status: 413 },
    );
  }

  // An upload is written by one request and read by the next. On serverless
  // those are different instances, so process memory isn't good enough — it
  // would accept the file and then lose it on the very next question. Better
  // to refuse up front than to look like it worked.
  if (!isPersistent() && process.env.NODE_ENV === "production") {
    return Response.json(
      {
        error:
          "Uploads need shared storage, which isn't configured on this deployment. The Kestrel help center demo works without it.",
      },
      { status: 503 },
    );
  }

  const store = getStore();
  const ownerId = visitorId(request.headers);

  // Uploads are cheap to store but expensive to answer against, so they get a
  // tighter limit than questions do.
  const rate = await checkRateLimit(store, {
    identifier: ownerId,
    bucket: "upload",
    limit: 3,
    windowSeconds: 24 * 60 * 60,
  });
  if (!rate.allowed) {
    return Response.json(
      {
        error:
          "That's the upload limit for today. The Kestrel help center is still fully open.",
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const upload = await saveUpload(store, { filename, text, ownerId });

  return Response.json({
    uploadId: upload.id,
    title: upload.title,
    characters: upload.text.length,
  });
}
