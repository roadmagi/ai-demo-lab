import type { NextRequest } from "next/server";
import { checkRateLimit, visitorId } from "@/lib/guard";
import { recordEscalation, recordGap } from "@/lib/gaps";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records a handoff to a human. Nothing is emailed — this is a demo — but the
 * question is written to the gap log so the escalation shows up in the report
 * alongside the questions that produced it.
 */
export async function POST(request: NextRequest) {
  let question: string;
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!question) {
    return Response.json({ error: "Nothing to escalate." }, { status: 400 });
  }

  const store = getStore();

  // This endpoint writes to a shared store on unauthenticated input, so it
  // gets its own limit even though it never calls the model.
  const rate = await checkRateLimit(store, {
    identifier: visitorId(request.headers),
    bucket: "escalate",
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many escalations from this address." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  // The email and note are deliberately not stored. They would be personal
  // data on a public demo with no retention policy, and the gap report does
  // not need them to be useful.
  await Promise.allSettled([
    recordGap(store, question),
    recordEscalation(store, question),
  ]);

  return Response.json({ ok: true });
}
