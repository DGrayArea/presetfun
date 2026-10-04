/**
 * A sliding-window rate limiter, shared by the routes that cost money to call —
 * IPFS pinning and the RPC proxy.
 *
 * **Where the counts live decides whether it works.** On Vercel every
 * invocation may land on a different instance, and each cold start begins with
 * empty memory, so an in-memory count is per-instance and easy to outrun. When
 * Upstash Redis is configured (`UPSTASH_REDIS_REST_URL` / `_TOKEN`, or the
 * `KV_REST_API_URL` / `_TOKEN` pair Vercel's Upstash integration sets, with or
 * without the prefix chosen there, e.g. `STORAGE_`), counts
 * live there instead and hold across every instance and restart.
 *
 * Without it, or if Redis cannot be reached, this falls back to memory: weaker,
 * but still a limit, rather than failing open or failing every request.
 *
 * What the in-memory version gets right, which the first version did not: eviction. That one
 * emptied the whole map once it held 5,000 keys, so anyone who could cycle
 * through addresses could wipe every other caller's counter and start clean.
 * Here, expired windows are dropped first and only genuinely active keys are
 * ever evicted, oldest first.
 */

import { redisConfigured, redisExec } from "@/lib/redis";

type Window = { hits: number[] };

const stores = new Map<string, Map<string, Window>>();

/** Stop unbounded growth if a lot of distinct keys are live at once. */
const MAX_KEYS = 20_000;

function storeFor(name: string): Map<string, Window> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function sweep(store: Map<string, Window>, now: number, windowMs: number) {
  for (const [key, win] of store) {
    if (win.hits.length === 0 || now - win.hits[win.hits.length - 1] >= windowMs) {
      store.delete(key);
    }
  }
  // Still crowded after dropping everything expired: evict the least recently
  // seen keys rather than clearing the map, so active limits survive.
  if (store.size > MAX_KEYS) {
    const byAge = [...store.entries()].sort(
      (a, b) => a[1].hits[a[1].hits.length - 1] - b[1].hits[b[1].hits.length - 1],
    );
    for (const [key] of byAge.slice(0, store.size - MAX_KEYS)) store.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window frees up — for the Retry-After header. */
  retryAfter: number;
};

type Limit = {
  name: string;
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
};

/** Whether counts are shared across instances, for logs and health checks. */
export const rateLimitIsShared = redisConfigured;

/**
 * The same sliding window, kept in a Redis sorted set: one member per hit,
 * scored by its time. Old hits are trimmed, new ones added and the rest counted
 * in one MULTI/EXEC round trip, so concurrent requests cannot interleave.
 */
async function redisLimit({ name, key, limit, windowMs, cost = 1 }: Limit): Promise<RateLimitResult> {
  const now = Date.now();
  const k = `rl:${name}:${key}`;
  const nonce = Math.random().toString(36).slice(2);
  const members = Array.from({ length: cost }, (_, i) => [String(now), `${now}-${nonce}-${i}`]).flat();

  const out = await redisExec([
    ["ZREMRANGEBYSCORE", k, "0", String(now - windowMs)],
    ["ZADD", k, ...members],
    ["ZCARD", k],
    ["ZRANGE", k, "0", "0", "WITHSCORES"],
    ["PEXPIRE", k, String(windowMs)],
  ]);

  const count = Number(out[2] ?? 0);
  const oldest = Number((out[3] as string[] | undefined)?.[1] ?? now);
  const ok = count <= limit;
  return {
    ok,
    remaining: Math.max(limit - count, 0),
    retryAfter: ok ? 0 : Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
  };
}

let warned = false;

/**
 * Record a hit and say whether it is allowed.
 *
 * `cost` lets one expensive request count as several cheap ones, which is how
 * the RPC proxy charges a batch by its length.
 */
export async function rateLimit(opts: Limit): Promise<RateLimitResult> {
  if (rateLimitIsShared) {
    try {
      return await redisLimit(opts);
    } catch (err) {
      console.error("[rateLimit] Redis unavailable, using memory:", err instanceof Error ? err.message : err);
    }
  } else if (!warned && process.env.VERCEL) {
    warned = true;
    console.warn(
      "[rateLimit] No Upstash Redis configured; limits are per-instance and reset on cold starts.",
    );
  }
  return memoryLimit(opts);
}

function memoryLimit({
  name,
  key,
  limit,
  windowMs,
  cost = 1,
}: Limit): RateLimitResult {
  const store = storeFor(name);
  const now = Date.now();

  // Sweeping on a fraction of calls keeps the common path cheap.
  if (store.size > 64 && Math.random() < 0.02) sweep(store, now, windowMs);

  const win = store.get(key) ?? { hits: [] };
  const hits = win.hits.filter((t) => now - t < windowMs);

  for (let i = 0; i < cost; i++) hits.push(now);
  win.hits = hits;
  store.set(key, win);

  const ok = hits.length <= limit;
  return {
    ok,
    remaining: Math.max(limit - hits.length, 0),
    retryAfter: ok ? 0 : Math.ceil((windowMs - (now - hits[0])) / 1000),
  };
}

/**
 * Best guess at who is calling.
 *
 * `x-forwarded-for` is a client-controlled header everywhere except behind a
 * proxy that overwrites it — which Vercel does. Only the first entry is the
 * real client; the rest are hops and are trivially forged, so they are ignored.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Per-IP guard for a route: a ready 429 response when the caller is over
 * `limit` in `windowMs`, otherwise null.
 */
export async function limitByIp(
  req: Request,
  name: string,
  limit: number,
  windowMs = 60_000,
): Promise<Response | null> {
  const gate = await rateLimit({ name, key: clientIp(req), limit, windowMs });
  if (gate.ok) return null;
  return Response.json(
    { error: "Too many requests. Wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
  );
}
