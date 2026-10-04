/**
 * Retry a transient RPC read.
 *
 * The first request that reaches a route importing the Raydium SDK reliably
 * fails with a bare `TypeError: fetch failed`, and the identical call succeeds
 * immediately afterwards. The SDK's module graph is very large, and the first
 * RPC read races its initialisation — in dev that is the on-demand compile, in
 * production it is a cold lambda.
 *
 * It is worth being precise about what this is *not*: it is not the RPC being
 * down (curl succeeds throughout) and it is not missing `force-dynamic`, which
 * is what it first appeared to be — that route recovered on retry, not because
 * of the flag.
 *
 * Only network-shaped failures are retried. A decode error or a missing
 * account is a real answer and must surface immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 250 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const transient = /fetch failed|network|ECONNRESET|ETIMEDOUT|socket hang up|502|503|504/i.test(
        message,
      );
      if (!transient || i === attempts - 1) throw err;
      // Linear backoff is enough; this clears on the first retry in practice.
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }

  throw lastError;
}
