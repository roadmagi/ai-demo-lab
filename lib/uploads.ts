import { randomUUID } from "node:crypto";
import type { Store } from "./store";

/**
 * Visitor-supplied documents, held for an hour and scoped to whoever uploaded
 * them.
 *
 * Only text formats are accepted. PDFs would work — the API reads them
 * natively — but their citations come back as page numbers rather than
 * character offsets, so the click-a-citation-and-see-the-sentence behaviour
 * that makes this demo worth showing would quietly stop working. A demo that
 * accepts more formats but delivers less is a worse demo.
 */

export const MAX_UPLOAD_CHARS = 200_000;
export const UPLOAD_TTL_SECONDS = 60 * 60;
export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".txt", ".text"];

export type Upload = {
  id: string;
  title: string;
  text: string;
  ownerId: string;
  createdAt: string;
};

export function isAcceptedFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function titleFrom(filename: string, text: string): string {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 120);
  return filename.replace(/\.[^.]+$/, "").slice(0, 120) || "Uploaded document";
}

export async function saveUpload(
  store: Store,
  {
    filename,
    text,
    ownerId,
    now = Date.now(),
  }: { filename: string; text: string; ownerId: string; now?: number },
): Promise<Upload> {
  const upload: Upload = {
    id: randomUUID(),
    title: titleFrom(filename, text),
    // Normalised for the same reason as the seed corpus: citation offsets are
    // counted against this exact string.
    text: text.replace(/\r\n/g, "\n"),
    ownerId,
    createdAt: new Date(now).toISOString(),
  };

  await store.setJSON(`upload:${upload.id}`, upload, UPLOAD_TTL_SECONDS);
  return upload;
}

/**
 * Returns the upload only to the visitor who created it. Without this check an
 * upload ID — which travels in a request body and is trivially guessable to
 * anyone who sees one — would read out another visitor's document.
 */
export async function loadUpload(
  store: Store,
  id: string,
  ownerId: string,
): Promise<Upload | null> {
  const upload = await store.getJSON<Upload>(`upload:${id}`);
  if (!upload || upload.ownerId !== ownerId) return null;
  return upload;
}
