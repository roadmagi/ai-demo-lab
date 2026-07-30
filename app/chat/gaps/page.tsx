import type { Metadata } from "next";
import Link from "next/link";
import { listGaps } from "@/lib/gaps";
import { getStore, isPersistent } from "@/lib/store";

export const metadata: Metadata = {
  title: "Content gap report — AI Demo Lab",
  description:
    "Every question the support agent could not answer, ranked by how often it was asked.",
};

export const dynamic = "force-dynamic";

export default async function GapsPage() {
  const gaps = await listGaps(getStore());
  const totalAsked = gaps.reduce((sum, gap) => sum + gap.asked, 0);
  const totalEscalated = gaps.reduce((sum, gap) => sum + gap.escalated, 0);

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Content gap report
        </h1>
        <p className="mt-3 leading-relaxed text-muted text-pretty">
          Every question the agent declined to answer, ranked by how often it
          was asked. This is the part support teams actually keep: a bot that
          says &ldquo;I don&apos;t know&rdquo; is only worth running if someone
          finds out what it didn&apos;t know, so the refusal path writes here
          instead of disappearing into a log.
        </p>
      </header>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Distinct questions" value={gaps.length} />
        <Stat label="Times asked" value={totalAsked} />
        <Stat label="Escalated to a human" value={totalEscalated} />
      </dl>

      {!isPersistent() && (
        <p className="mt-6 rounded-lg border border-warn-wash bg-warn-wash px-3 py-2 text-sm text-warn">
          Running without Redis, so this report lives in process memory and
          resets whenever the server restarts. Set the Upstash environment
          variables to make it durable.
        </p>
      )}

      {gaps.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-line bg-card p-8 text-center">
          <p className="text-sm text-muted text-pretty">
            Nothing logged yet. Ask the agent something the help center
            doesn&apos;t cover — &ldquo;do you have a mobile app?&rdquo; is a
            good one — and it will show up here.
          </p>
          <Link
            href="/chat"
            className="mt-4 inline-block text-sm font-medium text-brand-ink hover:underline"
          >
            Open the agent →
          </Link>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-lg text-sm">
            <thead className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Question
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Asked
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Escalated
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Last asked
                </th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((gap) => (
                <tr
                  key={gap.question}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-4 py-3 text-pretty">{gap.question}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {gap.asked}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {gap.escalated || "—"}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-muted">
                    {formatDate(gap.lastAskedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <dt className="text-xs tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}
