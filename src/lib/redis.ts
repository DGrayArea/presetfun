/**
 * The smallest possible Upstash Redis client: its REST API through fetch.
 *
 * No SDK, on purpose. `@upstash/redis`'s `Redis.fromEnv()` only reads the
 * unprefixed variable names, and Vercel's integration lets you choose a prefix
 * (this deployment uses `STORAGE_`), so the lookup below accepts any variable
 * ending in a known name as long as its matching token is set.
 */

function findRedis(): { url: string; token: string } {
  const pairs: [string, string][] = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ];
  for (const [urlSuffix, tokenSuffix] of pairs) {
    for (const name of Object.keys(process.env)) {
      if (!name.endsWith(urlSuffix)) continue;
      const prefix = name.slice(0, name.length - urlSuffix.length);
      const url = process.env[name]?.trim();
      const token = process.env[prefix + tokenSuffix]?.trim();
      if (url && token) return { url: url.replace(/\/$/, ""), token };
    }
  }
  return { url: "", token: "" };
}

const { url: REDIS_URL, token: REDIS_TOKEN } = findRedis();

/** Whether a Redis is configured at all. */
export const redisConfigured = Boolean(REDIS_URL && REDIS_TOKEN);

type Command = (string | number)[];

/**
 * Run commands atomically in one MULTI/EXEC round trip and return each
 * command's result, in order. Throws if Redis is missing, slow or errors.
 */
export async function redisExec(commands: Command[], timeoutMs = 1_500): Promise<unknown[]> {
  if (!redisConfigured) throw new Error("Redis is not configured.");
  const res = await fetch(`${REDIS_URL}/multi-exec`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash returned ${res.status}.`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(`Upstash: ${failed.error}`);
  return out.map((r) => r.result);
}
