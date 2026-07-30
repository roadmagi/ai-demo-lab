import { normalizeQuestion } from "./guard";
import type { Store } from "./store";

/**
 * The content-gap log.
 *
 * Every time the agent says it doesn't know, the question is recorded. That
 * list is the actual deliverable for a support team: it is a ranked backlog of
 * the docs they haven't written yet, produced as a side effect of running the
 * bot rather than as a separate research exercise.
 */

const COUNT_KEY = "gaps:count";
const META_KEY = "gaps:meta";
const ESCALATION_KEY = "gaps:escalations";

export type Gap = {
  question: string;
  asked: number;
  escalated: number;
  lastAskedAt: string;
};

type GapMeta = { question: string; lastAskedAt: string };

export async function recordGap(
  store: Store,
  question: string,
  now = Date.now(),
): Promise<void> {
  const field = normalizeQuestion(question);
  if (!field) return;

  await Promise.allSettled([
    store.hIncrBy(COUNT_KEY, field, 1),
    // The verbatim question is kept alongside the normalised key so the report
    // reads like something a person typed, not a slug.
    store.hSetJSON(META_KEY, field, {
      question: question.trim(),
      lastAskedAt: new Date(now).toISOString(),
    } satisfies GapMeta),
  ]);
}

export async function recordEscalation(
  store: Store,
  question: string,
): Promise<void> {
  const field = normalizeQuestion(question);
  if (!field) return;
  await store.hIncrBy(ESCALATION_KEY, field, 1);
}

/** Most-asked first. Ties break on the escalation count, then alphabetically. */
export async function listGaps(store: Store): Promise<Gap[]> {
  const [counts, meta, escalations] = await Promise.all([
    store.hGetAllJSON<number>(COUNT_KEY),
    store.hGetAllJSON<GapMeta>(META_KEY),
    store.hGetAllJSON<number>(ESCALATION_KEY),
  ]);

  return Object.entries(counts)
    .map(([field, asked]) => ({
      question: meta[field]?.question ?? field,
      asked: Number(asked) || 0,
      escalated: Number(escalations[field]) || 0,
      lastAskedAt: meta[field]?.lastAskedAt ?? "",
    }))
    .sort(
      (a, b) =>
        b.asked - a.asked ||
        b.escalated - a.escalated ||
        a.question.localeCompare(b.question),
    );
}
