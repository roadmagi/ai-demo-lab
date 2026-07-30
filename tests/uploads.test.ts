import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store";
import {
  MAX_UPLOAD_CHARS,
  isAcceptedFilename,
  loadUpload,
  saveUpload,
} from "@/lib/uploads";

const now = Date.UTC(2026, 6, 30, 12, 0, 0);

describe("isAcceptedFilename", () => {
  it("accepts text formats regardless of case", () => {
    for (const name of ["notes.md", "NOTES.MD", "a.markdown", "b.txt", "c.TEXT"]) {
      expect(isAcceptedFilename(name)).toBe(true);
    }
  });

  it("rejects everything else, including PDFs", () => {
    for (const name of ["policy.pdf", "sheet.xlsx", "app.js", "noextension"]) {
      expect(isAcceptedFilename(name)).toBe(false);
    }
  });

  it("is not fooled by an extension in the middle of the name", () => {
    expect(isAcceptedFilename("report.md.exe")).toBe(false);
  });
});

describe("saveUpload", () => {
  it("derives a title from the first heading", async () => {
    const store = new MemoryStore(() => now);
    const upload = await saveUpload(store, {
      filename: "whatever.md",
      text: "# Refund Policy\n\nWe refund within 30 days.",
      ownerId: "owner-1",
      now,
    });
    expect(upload.title).toBe("Refund Policy");
  });

  it("falls back to the filename when there is no heading", async () => {
    const store = new MemoryStore(() => now);
    const upload = await saveUpload(store, {
      filename: "refund-policy.txt",
      text: "We refund within 30 days.",
      ownerId: "owner-1",
      now,
    });
    expect(upload.title).toBe("refund-policy");
  });

  it("normalises CRLF so citation offsets line up with the rendered text", async () => {
    const store = new MemoryStore(() => now);
    const upload = await saveUpload(store, {
      filename: "a.txt",
      text: "line one\r\nline two\r\n",
      ownerId: "owner-1",
      now,
    });
    expect(upload.text).toBe("line one\nline two\n");
    expect(upload.text).not.toContain("\r");
  });
});

describe("loadUpload", () => {
  it("returns the document to its owner", async () => {
    const store = new MemoryStore(() => now);
    const saved = await saveUpload(store, {
      filename: "a.md",
      text: "# Doc\n\nbody",
      ownerId: "owner-1",
      now,
    });
    const loaded = await loadUpload(store, saved.id, "owner-1");
    expect(loaded?.text).toBe("# Doc\n\nbody");
  });

  it("refuses to hand a document to a different visitor", async () => {
    const store = new MemoryStore(() => now);
    const saved = await saveUpload(store, {
      filename: "a.md",
      text: "secret contract terms",
      ownerId: "owner-1",
      now,
    });
    expect(await loadUpload(store, saved.id, "owner-2")).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    const store = new MemoryStore(() => now);
    expect(await loadUpload(store, "no-such-id", "owner-1")).toBeNull();
  });

  it("expires after its TTL", async () => {
    let clock = now;
    const store = new MemoryStore(() => clock);
    const saved = await saveUpload(store, {
      filename: "a.md",
      text: "body",
      ownerId: "owner-1",
      now,
    });
    clock = now + 61 * 60 * 1000;
    expect(await loadUpload(store, saved.id, "owner-1")).toBeNull();
  });
});

describe("limits", () => {
  it("keeps the character ceiling well inside a single request body", () => {
    expect(MAX_UPLOAD_CHARS).toBeLessThanOrEqual(1_000_000);
  });
});
