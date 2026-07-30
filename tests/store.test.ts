import { afterEach, describe, expect, it } from "vitest";
import {
  createStore,
  MemoryStore,
  ResilientStore,
  type Store,
} from "@/lib/store";

/**
 * Stands in for an unreachable Upstash: every call rejects the way
 * `@upstash/redis` does when DNS fails (`TypeError: fetch failed`).
 */
class FailingStore implements Store {
  calls = 0;

  private fail(): never {
    this.calls++;
    throw new TypeError("fetch failed");
  }

  async getJSON<T>(): Promise<T | null> {
    return this.fail();
  }
  async setJSON(): Promise<void> {
    return this.fail();
  }
  async incrBy(): Promise<number> {
    return this.fail();
  }
  async hIncrBy(): Promise<number> {
    return this.fail();
  }
  async hSetJSON(): Promise<void> {
    return this.fail();
  }
  async hGetAllJSON<T>(): Promise<Record<string, T>> {
    return this.fail();
  }
}

describe("resilient store", () => {
  it("serves reads from the fallback instead of throwing", async () => {
    const store = new ResilientStore(new FailingStore(), new MemoryStore());

    await expect(store.getJSON("missing")).resolves.toBeNull();
  });

  it("keeps writes readable after the primary fails", async () => {
    const store = new ResilientStore(new FailingStore(), new MemoryStore());

    await store.setJSON("answer", { text: "hello" });

    await expect(store.getJSON("answer")).resolves.toEqual({ text: "hello" });
  });

  it("keeps counting so the rate limiter still bites", async () => {
    const store = new ResilientStore(new FailingStore(), new MemoryStore());

    expect(await store.incrBy("visitor", 1)).toBe(1);
    expect(await store.incrBy("visitor", 1)).toBe(2);
    expect(await store.incrBy("visitor", 1)).toBe(3);
  });

  it("keeps hash writes readable, so the gap report survives", async () => {
    const store = new ResilientStore(new FailingStore(), new MemoryStore());

    await store.hSetJSON("gaps", "q1", { asked: 2 });
    expect(await store.hIncrBy("gaps", "count", 5)).toBe(5);

    await expect(store.hGetAllJSON("gaps")).resolves.toEqual({
      q1: { asked: 2 },
      count: 5,
    });
  });

  it("reports itself degraded and announces the first failure once", async () => {
    const seen: unknown[] = [];
    const store = new ResilientStore(new FailingStore(), new MemoryStore(), (
      error,
    ) => seen.push(error));

    expect(store.degraded).toBe(false);

    await store.getJSON("a");
    await store.getJSON("b");

    expect(store.degraded).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("stops calling a primary that has already failed", async () => {
    const primary = new FailingStore();
    const store = new ResilientStore(primary, new MemoryStore());

    await store.getJSON("a");
    await store.getJSON("b");
    await store.setJSON("c", 1);

    // One failed call is a dead DNS lookup per request otherwise.
    expect(primary.calls).toBe(1);
  });

  it("leaves a healthy primary in charge", async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    const store = new ResilientStore(primary, fallback);

    await store.setJSON("k", "v");

    expect(store.degraded).toBe(false);
    await expect(primary.getJSON("k")).resolves.toBe("v");
    await expect(fallback.getJSON("k")).resolves.toBeNull();
  });
});

describe("store construction", () => {
  const KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
  const saved = new Map(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const setEnv = (url?: string, token?: string) => {
    if (url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = url;
    if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = token;
  };

  it("uses memory when nothing is configured", () => {
    setEnv(undefined, undefined);

    expect(createStore()).toBeInstanceOf(MemoryStore);
  });

  it("uses Redis when it is configured", () => {
    setEnv("https://example.upstash.io", "AXtoken");

    expect(createStore()).toBeInstanceOf(ResilientStore);
  });

  it("falls back to memory when the client rejects the URL", () => {
    // `new Redis()` validates and throws before any call is made, so the
    // per-call guard never sees it. Production hit exactly this and 500'd.
    setEnv("redis://example.upstash.io:6379", "AXtoken");

    expect(() => createStore()).not.toThrow();
    expect(createStore()).toBeInstanceOf(MemoryStore);
  });

  it("unwraps values pasted with surrounding quotes", () => {
    // Dashboards store what you paste. A quoted URL is not a URL, and the
    // resulting error names a string that looks perfectly correct in the UI.
    setEnv('"https://example.upstash.io"', '"AXtoken"');

    expect(createStore()).toBeInstanceOf(ResilientStore);
  });

  it("treats a blank value as absent", () => {
    setEnv("   ", "AXtoken");

    expect(createStore()).toBeInstanceOf(MemoryStore);
  });
});
