import Link from "next/link";
import { COMPANY } from "@/lib/kestrel";

type Demo = {
  href: string;
  title: string;
  blurb: string;
  points: string[];
  status: "live" | "building";
};

const DEMOS: Demo[] = [
  {
    href: "/chat",
    title: "Support agent with real citations",
    blurb: `Answers questions from ${COMPANY.name}'s help center. Every claim is anchored to the exact sentence it came from — click a citation and the source highlights.`,
    points: [
      "Citations are exact character spans, not model-invented references",
      "Says “I don't know” instead of guessing, then offers a human",
      "Unanswered questions roll up into a content-gap report",
    ],
    status: "live",
  },
  {
    href: "/extract",
    title: "Invoice extraction you can audit",
    blurb:
      "Drop in a PDF invoice, get structured rows out — where every field carries the text it was read from, and the arithmetic is checked independently of the model.",
    points: [
      "Every field carries the quote it came from, checked against the document",
      "Arithmetic is reconciled separately — a plausible wrong total gets caught",
      "Flagged fields are correctable inline, then exported as CSV",
    ],
    status: "live",
  },
  {
    href: "/repurpose",
    title: "Content repurposing engine",
    blurb:
      "One long-form source in, a week of channel-ready posts out — LinkedIn, X, and newsletter, each written for its own format.",
    points: [
      "Per-channel tone and length controls",
      "Keeps the source's actual claims intact",
      "Copy-ready output blocks",
    ],
    status: "building",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <section className="max-w-2xl">
        <p className="text-sm font-medium text-brand-ink">AI Demo Lab</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance">
          Three working AI systems you can try right now.
        </h1>
        <p className="mt-4 text-lg text-muted text-pretty">
          Not screenshots or a video — live software. Each demo is built around{" "}
          <strong className="font-medium text-ink">{COMPANY.name}</strong>, a
          fictional {COMPANY.tagline} company, so the pieces fit together the
          way they would inside a real business.
        </p>
      </section>

      <section className="mt-10 grid gap-5 md:grid-cols-3">
        {DEMOS.map((demo) => (
          <DemoCard key={demo.href} demo={demo} />
        ))}
      </section>

      <section className="mt-12 rounded-xl border border-line bg-card p-6">
        <h2 className="text-sm font-semibold">A note on how these run</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          These demos call a real model on a real API key, so every request is
          rate-limited per visitor, answers are cached and reused, and the whole
          lab runs under a daily token budget. If you hit a limit you&apos;ll
          get a cached answer and an honest banner rather than an error — the
          same thing I&apos;d build for a client shipping this to production.
        </p>
      </section>
    </div>
  );
}

function DemoCard({ demo }: { demo: Demo }) {
  const isLive = demo.status === "live";

  const card = (
    <article
      className={`flex h-full flex-col rounded-xl border bg-card p-5 transition ${
        isLive
          ? "border-line hover:border-brand hover:shadow-[0_1px_16px_-4px_rgba(59,91,255,0.35)]"
          : "border-dashed border-line opacity-75"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug text-pretty">
          {demo.title}
        </h2>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            isLive ? "bg-ok-wash text-ok" : "bg-warn-wash text-warn"
          }`}
        >
          {isLive ? "Live" : "In progress"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted text-pretty">
        {demo.blurb}
      </p>

      <ul className="mt-4 space-y-1.5 text-sm text-muted">
        {demo.points.map((point) => (
          <li key={point} className="flex gap-2">
            <span
              aria-hidden
              className="mt-1.5 size-1 shrink-0 rounded-full bg-brand"
            />
            <span className="text-pretty">{point}</span>
          </li>
        ))}
      </ul>

      <p
        className={`mt-5 border-t border-line pt-4 text-sm font-medium ${
          isLive ? "text-brand-ink" : "text-muted"
        }`}
      >
        {isLive ? "Open the demo →" : "Coming soon"}
      </p>
    </article>
  );

  return isLive ? (
    <Link
      href={demo.href}
      className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {card}
    </Link>
  ) : (
    card
  );
}
