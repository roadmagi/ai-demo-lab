"use client";

import { useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_CHARS } from "@/lib/uploads";

export type ActiveUpload = { id: string; title: string; characters: number };

type Props = {
  upload: ActiveUpload | null;
  onChange: (upload: ActiveUpload | null) => void;
  disabled: boolean;
};

/**
 * Switches the agent between the seed help center and a document the visitor
 * brings. The point is to let someone test it on their own content — the
 * question every client asks about a demo like this.
 */
export function DocumentBar({ upload, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (file.size > MAX_UPLOAD_CHARS * 2) {
      setError(
        `That file is too big. The limit is ${MAX_UPLOAD_CHARS / 1000}k characters.`,
      );
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, text }),
      });
      const payload = (await response.json()) as {
        uploadId?: string;
        title?: string;
        characters?: number;
        error?: string;
      };

      if (!response.ok || !payload.uploadId) {
        setError(payload.error ?? "That upload didn't go through.");
        return;
      }

      onChange({
        id: payload.uploadId,
        title: payload.title ?? file.name,
        characters: payload.characters ?? text.length,
      });
    } catch {
      setError("Couldn't read that file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="border-b border-line px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-muted">Answering from</span>

        {upload ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-brand bg-brand-wash px-2.5 py-1 text-brand-ink">
            <span className="max-w-56 truncate font-medium">{upload.title}</span>
            <span className="text-muted">
              {Math.round(upload.characters / 1000)}k chars
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              aria-label="Switch back to the Kestrel help center"
              className="text-muted transition hover:text-ink"
            >
              ×
            </button>
          </span>
        ) : (
          <span className="rounded-full border border-line px-2.5 py-1 font-medium">
            Kestrel help center · 6 documents
          </span>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className="text-muted underline underline-offset-2 transition hover:text-ink disabled:opacity-50"
        >
          {busy ? "Reading…" : upload ? "Swap file" : "Use your own document"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {upload && (
        <p className="mt-2 text-xs leading-relaxed text-muted text-pretty">
          Your file is chunked and retrieved against per question rather than
          sent whole — the seed corpus is small enough to send entirely, an
          arbitrary upload isn&apos;t. It&apos;s held for an hour, then dropped.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </div>
  );
}
