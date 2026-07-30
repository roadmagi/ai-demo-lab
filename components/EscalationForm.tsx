"use client";

import { useState } from "react";

type State = "idle" | "open" | "sending" | "sent" | "error";

/**
 * The handoff. A support bot that can't answer is only useful if it does
 * something with that fact — here it captures the question for a human and
 * files it in the gap report at the same time.
 */
export function EscalationForm({ question }: { question: string }) {
  const [state, setState] = useState<State>("idle");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  if (state === "sent") {
    return (
      <p className="rounded-lg border border-ok-wash bg-ok-wash px-3 py-2 text-sm text-ok">
        Passed to the support team. In a real deployment this would open a
        ticket and land in the gap report — which it just did.
      </p>
    );
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState("open")}
        className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition hover:border-brand hover:text-ink"
      >
        Ask a human instead →
      </button>
    );
  }

  return (
    <form
      className="space-y-2 rounded-lg border border-line bg-bg p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setState("sending");
        try {
          const response = await fetch("/api/escalate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, email, note }),
          });
          setState(response.ok ? "sent" : "error");
        } catch {
          setState("error");
        }
      }}
    >
      <p className="text-xs text-muted">
        Nothing is emailed anywhere — this is a demo. The question is recorded
        in the gap report.
      </p>
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        aria-label="Your email"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Anything else the team should know? (optional)"
        aria-label="Additional context"
        className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-ink disabled:opacity-50"
        >
          {state === "sending" ? "Sending…" : "Send to support"}
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="text-sm text-muted underline underline-offset-2 hover:text-ink"
        >
          Cancel
        </button>
        {state === "error" && (
          <span className="text-sm text-warn">That didn&apos;t go through.</span>
        )}
      </div>
    </form>
  );
}
