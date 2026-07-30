import { beforeEach, describe, expect, it } from "vitest";
import {
  budgetDay,
  cacheKey,
  checkRateLimit,
  configFromEnv,
  DEFAULT_CONFIG,
  guard,
  normalizeQuestion,
  readBudget,
  recordSpend,
  visitorId,
} from "@/lib/guard";
import { MemoryStore } from "@/lib/store";

const CONFIG = {
  rateLimit: 3,
  rateWindowSeconds: 60,
  dailyTokenBudget: 1_000,
  cacheTtlSeconds: 600,
};

describe("cache keying", () => {
  it("collapses casing, spacing, and punctuation", () => {
    expect(normalizeQuestion("  How  do I EXPORT?? ")).toBe("how do i export");
    expect(cacheKey("abc", "How do I export?")).toBe(
      cacheKey("abc", "how do i  export"),
    );
  });

  it("separates different questions", () => {
    expect(cacheKey("abc", "how do I export")).not.toBe(
      cacheKey("abc", "how do I cancel"),
    );
  });

  it("invalidates when the corpus fingerprint changes", () => {
    expect(cacheKey("v1", "same question")).not.toBe(
      cacheKey("v2", "same question"),
    );
  });
});

describe("rate limit", () => {
  let store: MemoryStore;
  const start = Date.UTC(2026, 6, 30, 12, 0, 0);
  const opts = {
    identifier: "visitor-1",
    bucket: "chat",
    limit: 3,
    windowSeconds: 60,
  };

  beforeEach(() => {
    store = new MemoryStore(() => start);
  });

  it("allows up to the limit and then blocks", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await checkRateLimit(store, { ...opts, now: start }));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it("counts each visitor separately", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(store, { ...opts, now: start });
    }
    const other = await checkRateLimit(store, {
      ...opts,
      identifier: "visitor-2",
      now: start,
    });
    expect(other.allowed).toBe(true);
  });

  it("resets in the next window", async () => {
    for (let i = 0; i < 4; i++) {
      await checkRateLimit(store, { ...opts, now: start });
    }
    const next = await checkRateLimit(store, {
      ...opts,
      now: start + 60_000,
    });
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(2);
  });

  it("reports seconds until the window rolls over", async () => {
    const result = await checkRateLimit(store, {
      ...opts,
      now: start + 15_000,
    });
    expect(result.retryAfterSeconds).toBe(45);
  });

  it("never reports a retry of zero seconds", async () => {
    const result = await checkRateLimit(store, {
      ...opts,
      now: start + 59_999,
    });
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("daily budget", () => {
  const noon = Date.UTC(2026, 6, 30, 12, 0, 0);

  it("keys on the UTC day", () => {
    expect(budgetDay(noon)).toBe("2026-07-30");
    expect(budgetDay(noon + 24 * 3600_000)).toBe("2026-07-31");
  });

  it("accumulates spend and flips to exhausted at the limit", async () => {
    const store = new MemoryStore(() => noon);
    expect((await readBudget(store, 1_000, noon)).exhausted).toBe(false);

    await recordSpend(store, 600, noon);
    let status = await readBudget(store, 1_000, noon);
    expect(status.spent).toBe(600);
    expect(status.exhausted).toBe(false);

    await recordSpend(store, 400, noon);
    status = await readBudget(store, 1_000, noon);
    expect(status.spent).toBe(1_000);
    expect(status.exhausted).toBe(true);
  });

  it("starts fresh on the next day", async () => {
    const store = new MemoryStore(() => noon);
    await recordSpend(store, 5_000, noon);
    const tomorrow = await readBudget(store, 1_000, noon + 24 * 3600_000);
    expect(tomorrow.spent).toBe(0);
    expect(tomorrow.exhausted).toBe(false);
  });

  it("ignores non-positive spend", async () => {
    const store = new MemoryStore(() => noon);
    await recordSpend(store, 0, noon);
    await recordSpend(store, -50, noon);
    expect((await readBudget(store, 1_000, noon)).spent).toBe(0);
  });
});

describe("guard composition", () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const base = {
    key: "answer:abc",
    identifier: "visitor-1",
    bucket: "chat",
    config: CONFIG,
    now,
  };

  it("allows a fresh request", async () => {
    const store = new MemoryStore(() => now);
    const decision = await guard(store, base);
    expect(decision.type).toBe("allow");
  });

  it("serves the cache without consuming rate limit or budget", async () => {
    const store = new MemoryStore(() => now);
    await store.setJSON("answer:abc", { text: "hello" });
    await recordSpend(store, CONFIG.dailyTokenBudget, now);

    for (let i = 0; i < 10; i++) {
      const decision = await guard<{ text: string }>(store, base);
      expect(decision).toEqual({ type: "cached", value: { text: "hello" } });
    }
  });

  it("rate limits before it touches the budget", async () => {
    const store = new MemoryStore(() => now);
    for (let i = 0; i < CONFIG.rateLimit; i++) {
      expect((await guard(store, base)).type).toBe("allow");
    }
    const blocked = await guard(store, base);
    expect(blocked.type).toBe("rate_limited");
    if (blocked.type === "rate_limited") {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("reports budget exhaustion once spend reaches the cap", async () => {
    const store = new MemoryStore(() => now);
    await recordSpend(store, CONFIG.dailyTokenBudget, now);
    const decision = await guard(store, base);
    expect(decision.type).toBe("budget_exhausted");
  });

  it("prefers a rate-limit answer over a budget answer for a heavy visitor", async () => {
    const store = new MemoryStore(() => now);
    await recordSpend(store, CONFIG.dailyTokenBudget, now);
    for (let i = 0; i < CONFIG.rateLimit; i++) {
      await guard(store, base);
    }
    // Both limits are blown; the visitor-specific one is the actionable
    // message, so it should win.
    expect((await guard(store, base)).type).toBe("rate_limited");
  });
});

describe("config from env", () => {
  it("falls back to defaults for missing or junk values", () => {
    expect(configFromEnv({})).toEqual(DEFAULT_CONFIG);
    expect(configFromEnv({ CHAT_RATE_LIMIT: "nonsense" }).rateLimit).toBe(
      DEFAULT_CONFIG.rateLimit,
    );
    expect(configFromEnv({ DEMO_DAILY_TOKEN_BUDGET: "-5" }).dailyTokenBudget).toBe(
      DEFAULT_CONFIG.dailyTokenBudget,
    );
  });

  it("reads valid overrides, including a zero budget", () => {
    const config = configFromEnv({
      CHAT_RATE_LIMIT: "5",
      DEMO_DAILY_TOKEN_BUDGET: "0",
    });
    expect(config.rateLimit).toBe(5);
    expect(config.dailyTokenBudget).toBe(0);
  });
});

describe("visitorId", () => {
  it("is stable per IP and never contains the raw address", () => {
    const a = visitorId(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    const b = visitorId(new Headers({ "x-forwarded-for": "203.0.113.7" }));
    const c = visitorId(new Headers({ "x-forwarded-for": "198.51.100.2" }));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("203.0.113.7");
  });

  it("falls back to a shared bucket when no IP header is present", () => {
    expect(visitorId(new Headers())).toBe(visitorId(new Headers()));
  });
});
