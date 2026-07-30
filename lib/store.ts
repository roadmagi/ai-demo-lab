import { Redis } from "@upstash/redis";

/**
 * The small slice of a key-value store this app actually needs.
 *
 * Serverless functions share no memory, so the rate limiter and token budget
 * need somewhere durable to count. Upstash covers that in production; the
 * in-memory implementation keeps local dev working with nothing but an
 * Anthropic key in `.env.local`.
 */
export interface Store {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /** Increments and returns the new total. TTL is only applied on creation. */
  incrBy(key: string, amount: number, ttlSeconds?: number): Promise<number>;
  hIncrBy(key: string, field: string, amount: number): Promise<number>;
  hSetJSON(key: string, field: string, value: unknown): Promise<void>;
  hGetAllJSON<T>(key: string): Promise<Record<string, T>>;
}

class RedisStore implements Store {
  constructor(private readonly redis: Redis) {}

  async getJSON<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async setJSON(key: string, value: unknown, ttlSeconds?: number) {
    if (ttlSeconds) await this.redis.set(key, value, { ex: ttlSeconds });
    else await this.redis.set(key, value);
  }

  async incrBy(key: string, amount: number, ttlSeconds?: number) {
    const total = await this.redis.incrby(key, amount);
    // Only set the TTL when this call created the key, so a busy window can't
    // keep pushing the expiry out and turn a fixed window into a rolling one.
    if (ttlSeconds && total === amount) {
      await this.redis.expire(key, ttlSeconds);
    }
    return total;
  }

  async hIncrBy(key: string, field: string, amount: number) {
    return this.redis.hincrby(key, field, amount);
  }

  async hSetJSON(key: string, field: string, value: unknown) {
    await this.redis.hset(key, { [field]: value });
  }

  async hGetAllJSON<T>(key: string) {
    return (await this.redis.hgetall<Record<string, T>>(key)) ?? {};
  }
}

type Entry = { value: unknown; expiresAt: number | null };

/**
 * Process-local fallback. Fine for `npm run dev`; useless across serverless
 * instances, which is exactly why production needs Redis.
 */
export class MemoryStore implements Store {
  private data = new Map<string, Entry>();
  private hashes = new Map<string, Map<string, unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): Entry | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return entry;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const entry = this.live(key);
    return entry ? (structuredClone(entry.value) as T) : null;
  }

  async setJSON(key: string, value: unknown, ttlSeconds?: number) {
    this.data.set(key, {
      value: structuredClone(value),
      expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : null,
    });
  }

  async incrBy(key: string, amount: number, ttlSeconds?: number) {
    const entry = this.live(key);
    const total = ((entry?.value as number) ?? 0) + amount;
    this.data.set(key, {
      value: total,
      expiresAt:
        entry?.expiresAt ??
        (ttlSeconds ? this.now() + ttlSeconds * 1000 : null),
    });
    return total;
  }

  async hIncrBy(key: string, field: string, amount: number) {
    const hash = this.hashes.get(key) ?? new Map<string, unknown>();
    const total = ((hash.get(field) as number) ?? 0) + amount;
    hash.set(field, total);
    this.hashes.set(key, hash);
    return total;
  }

  async hSetJSON(key: string, field: string, value: unknown) {
    const hash = this.hashes.get(key) ?? new Map<string, unknown>();
    hash.set(field, structuredClone(value));
    this.hashes.set(key, hash);
  }

  async hGetAllJSON<T>(key: string) {
    const hash = this.hashes.get(key);
    if (!hash) return {} as Record<string, T>;
    return Object.fromEntries(
      [...hash.entries()].map(([field, value]) => [
        field,
        structuredClone(value) as T,
      ]),
    ) as Record<string, T>;
  }
}

/**
 * Held on `globalThis` rather than in a module variable.
 *
 * Next.js bundles route handlers and pages into separate module graphs, so a
 * module-scoped singleton gives `/api/escalate` and `/chat/gaps` two different
 * MemoryStore instances — writes land in one and reads come from the other,
 * and the gap report silently stays empty. Hot reloads have the same effect.
 * A global survives both. (Irrelevant for Redis, where the state is external
 * anyway, but the resolution runs through one path.)
 */
const STORE_KEY = Symbol.for("ai-demo-lab.store");
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Store };

/** Redis when it's configured, process memory otherwise. */
export function getStore(): Store {
  const container = globalThis as GlobalWithStore;
  if (container[STORE_KEY]) return container[STORE_KEY];

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  container[STORE_KEY] =
    url && token
      ? new RedisStore(new Redis({ url, token }))
      : new MemoryStore();

  return container[STORE_KEY];
}

export function isPersistent(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}
