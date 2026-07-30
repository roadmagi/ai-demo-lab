"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Answer } from "@/lib/citations";
import type { ChatEvent, SourceRef } from "@/lib/protocol";
import { createEventParser } from "@/lib/protocol";
import { DocumentBar, type ActiveUpload } from "./DocumentBar";
import { EscalationForm } from "./EscalationForm";
import { SourcePane, type ResolvedSource } from "./SourcePane";

export type CorpusDoc = { id: string; title: string; text: string };

type Notice = { kind: "rate_limited" | "budget_exhausted" | "error"; message: string };

type Turn = {
  id: string;
  question: string;
  answer: Answer | null;
  sources: SourceRef[];
  mode: "live" | "cached" | null;
  status: "streaming" | "done";
  noAnswer: boolean;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  notice?: Notice;
};

type Props = {
  corpus: CorpusDoc[];
  suggested: readonly string[];
  gapProbes: readonly string[];
};

export function ChatWorkbench({ corpus, suggested, gapProbes }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const [upload, setUpload] = useState<ActiveUpload | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const corpusById = useMemo(
    () => new Map(corpus.map((doc) => [doc.id, doc])),
    [corpus],
  );

  const current = turns.at(-1) ?? null;

  const resolvedSources: ResolvedSource[] = useMemo(() => {
    if (!current) return [];
    return current.sources.flatMap((source) => {
      const text = source.text ?? (source.docId ? corpusById.get(source.docId)?.text : undefined);
      if (text === undefined) return [];
      return [{ index: source.index, title: source.title, text }];
    });
  }, [current, corpusById]);

  const update = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((previous) =>
      previous.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
    );
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      const id = `${turns.length}-${trimmed.slice(0, 24)}`;
      setTurns((previous) => [
        ...previous,
        {
          id,
          question: trimmed,
          answer: null,
          sources: [],
          mode: null,
          status: "streaming",
          noAnswer: false,
        },
      ]);
      setDraft("");
      setActiveMarker(null);
      setBusy(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, uploadId: upload?.id }),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          update(id, {
            status: "done",
            notice: {
              kind: "error",
              message:
                (detail as { error?: string } | null)?.error ??
                "The request failed before it reached the model.",
            },
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parse = createEventParser();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parse(decoder.decode(value, { stream: true }))) {
            applyEvent(id, event, update);
          }
        }
        update(id, { status: "done" });
      } catch {
        update(id, {
          status: "done",
          notice: {
            kind: "error",
            message: "The connection dropped. Try that question again.",
          },
        });
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, turns.length, update, upload],
  );

  return (
    <div className="grid gap-5 lg:h-[calc(100vh-8.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section className="flex min-h-0 flex-col rounded-xl border border-line bg-card">
        <header className="border-b border-line px-5 py-3">
          <h1 className="text-sm font-semibold">
            {upload ? "Ask your document" : "Ask the Kestrel help center"}
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            Each question is answered independently — there is no conversation
            memory between them.
          </p>
        </header>

        <DocumentBar
          upload={upload}
          onChange={(next) => {
            setUpload(next);
            setActiveMarker(null);
          }}
          disabled={busy}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {turns.length === 0 ? (
            upload ? (
              <UploadEmptyState title={upload.title} />
            ) : (
              <EmptyState
                suggested={suggested}
                gapProbes={gapProbes}
                onPick={ask}
                disabled={busy}
              />
            )
          ) : (
            <ol className="space-y-6">
              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  isCurrent={turn.id === current?.id}
                  activeMarker={activeMarker}
                  onSelectMarker={setActiveMarker}
                />
              ))}
            </ol>
          )}
        </div>

        <form
          className="border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
        >
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={500}
              placeholder={
                upload
                  ? "Ask something about your document…"
                  : "Ask about billing, SSO, exports, integrations, limits…"
              }
              aria-label="Your question"
              className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Asking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>

      <div className="min-h-0 lg:h-full">
        <SourcePane
          sources={resolvedSources}
          citations={current?.answer?.citations ?? []}
          activeMarker={activeMarker}
          onSelectMarker={setActiveMarker}
        />
      </div>
    </div>
  );
}

function applyEvent(
  id: string,
  event: ChatEvent,
  update: (id: string, patch: Partial<Turn>) => void,
) {
  switch (event.type) {
    case "meta":
      update(id, { sources: event.sources, mode: event.mode });
      return;
    case "answer":
      update(id, { answer: event.answer });
      return;
    case "done":
      update(id, {
        status: "done",
        noAnswer: event.noAnswer,
        mode: event.cached ? "cached" : "live",
        usage: event.usage,
      });
      return;
    case "notice":
      update(id, { status: "done", notice: event });
      return;
  }
}

function TurnView({
  turn,
  isCurrent,
  activeMarker,
  onSelectMarker,
}: {
  turn: Turn;
  isCurrent: boolean;
  activeMarker: number | null;
  onSelectMarker: (marker: number | null) => void;
}) {
  const streaming = turn.status === "streaming";
  const empty = !turn.answer || turn.answer.segments.length === 0;

  return (
    <li className="space-y-2">
      <p className="font-medium">{turn.question}</p>

      {turn.notice ? (
        <Notice notice={turn.notice} />
      ) : (
        <>
          {empty && streaming && <Thinking />}
          {turn.answer && turn.answer.segments.length > 0 && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
              {turn.answer.segments.map((segment, index) => (
                <span key={index}>
                  {segment.text}
                  {isCurrent &&
                    segment.markers.map((marker) => (
                      <CitationMarker
                        key={marker}
                        marker={marker}
                        active={marker === activeMarker}
                        onSelect={onSelectMarker}
                      />
                    ))}
                </span>
              ))}
            </p>
          )}

          {turn.status === "done" && (
            <TurnFooter turn={turn} empty={empty} />
          )}
        </>
      )}
    </li>
  );
}

function TurnFooter({ turn, empty }: { turn: Turn; empty: boolean }) {
  if (empty && !turn.noAnswer) return null;

  return (
    <div className="space-y-3 pt-1">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {turn.mode === "cached" && (
          <Badge tone="neutral">Served from cache — no model call</Badge>
        )}
        {turn.mode === "live" && turn.usage && (
          <Badge tone="neutral">
            {turn.usage.cacheReadTokens > 0
              ? `${turn.usage.cacheReadTokens.toLocaleString()} input tokens read from prompt cache`
              : `${turn.usage.inputTokens.toLocaleString()} input tokens (cache warming)`}
          </Badge>
        )}
        {turn.answer && turn.answer.citations.length > 0 && (
          <Badge tone="ok">
            {turn.answer.citations.length} citation
            {turn.answer.citations.length === 1 ? "" : "s"}
          </Badge>
        )}
        {turn.noAnswer && <Badge tone="warn">Not covered by the docs</Badge>}
      </div>

      {turn.noAnswer && <EscalationForm question={turn.question} />}
    </div>
  );
}

function CitationMarker({
  marker,
  active,
  onSelect,
}: {
  marker: number;
  active: boolean;
  onSelect: (marker: number | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(active ? null : marker)}
      aria-label={`Show source ${marker}`}
      className={`mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-super text-[10px] font-semibold transition ${
        active
          ? "bg-brand text-white"
          : "bg-brand-wash text-brand-ink hover:bg-brand hover:text-white"
      }`}
    >
      {marker}
    </button>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "neutral" | "ok" | "warn";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-bg text-muted",
    ok: "bg-ok-wash text-ok",
    warn: "bg-warn-wash text-warn",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 ${tones[tone]}`}>{children}</span>
  );
}

function Notice({ notice }: { notice: Notice }) {
  const isError = notice.kind === "error";
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${
        isError
          ? "border-line bg-bg text-muted"
          : "border-warn-wash bg-warn-wash text-warn"
      }`}
    >
      {notice.message}
    </p>
  );
}

function Thinking() {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted">
      <span className="size-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-brand" />
    </p>
  );
}

function EmptyState({
  suggested,
  gapProbes,
  onPick,
  disabled,
}: {
  suggested: readonly string[];
  gapProbes: readonly string[];
  onPick: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
          Questions the docs answer
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {suggested.map((question) => (
            <Chip
              key={question}
              disabled={disabled}
              onClick={() => onPick(question)}
            >
              {question}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
          Questions they don&apos;t
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted text-pretty">
          These aren&apos;t in the help center. Watch it say so instead of
          inventing an answer — the behaviour that decides whether a support bot
          is safe to put in front of customers.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {gapProbes.map((question) => (
            <Chip
              key={question}
              disabled={disabled}
              onClick={() => onPick(question)}
            >
              {question}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

function UploadEmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-6">
      <p className="text-sm leading-relaxed text-muted text-pretty">
        <span className="font-medium text-ink">{title}</span> is loaded. Ask
        anything about it — the answer will cite the exact lines it came from,
        and it will tell you when your document doesn&apos;t cover something
        rather than filling the gap in.
      </p>
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-line px-3 py-1.5 text-sm text-muted transition hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
