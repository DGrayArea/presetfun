import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/config.server";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * JSON-RPC proxy, so the browser never sees the RPC key.
 *
 * Before this, the endpoint was handed to `ConnectionProvider` as a prop, which
 * put a paid Helius URL in the page source for anyone to lift and point at
 * their own project. Now the key stays on the server and the client talks to
 * this route.
 *
 * That trade has to be made carefully: an unauthenticated proxy to a paid
 * endpoint is its own liability, and arguably a worse one — at least a stolen
 * key is visible in a dashboard, whereas a wide-open proxy just quietly bills
 * you. Three things narrow it:
 *
 *  1. A method allowlist. The browser needs six or seven cheap methods; the
 *     ones that actually cost real money to serve (getProgramAccounts and
 *     friends) are simply not reachable. Everything heavy already runs
 *     server-side in our own routes, where it uses the key directly.
 *  2. A per-IP rate limit, with a batch charged by its length.
 *  3. A same-origin check, which stops another site from pointing its own app
 *     at this endpoint. Forgeable by hand, so it is a deterrent rather than a
 *     control — the allowlist is what does the real work.
 */

/**
 * What the browser is actually allowed to ask for.
 *
 * Derived from what the client code does: send a transaction, wait for it, read
 * a balance, price an account's rent. Wallet adapters add a few harmless
 * health-check calls. Anything absent from this list is a sign the work belongs
 * in a server route, not the browser.
 */
const ALLOWED = new Set([
  // Sending and confirming.
  "sendTransaction",
  "simulateTransaction",
  "getLatestBlockhash",
  "isBlockhashValid",
  "getSignatureStatuses",
  "getBlockHeight",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  // Reading a single account or balance.
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getMinimumBalanceForRentExemption",
  // Cheap health and identity calls wallet adapters make on connect.
  "getVersion",
  "getSlot",
  "getEpochInfo",
  "getGenesisHash",
]);

/** Plenty for a normal session; a runaway loop hits it long before the bill does. */
const LIMIT = 240;
const WINDOW_MS = 60_000;
const MAX_BATCH = 20;
const MAX_BODY_BYTES = 200_000;

type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

function rpcError(id: unknown, code: number, message: string, status: number) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

/**
 * Reject a request that a browser on another site made against our endpoint.
 * Same-origin requests from our own pages send an Origin we can match; requests
 * with no Origin at all (curl, a mobile wallet's in-app webview) are let
 * through, because blocking those would break real users.
 */
function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  if (crossSite(req)) {
    return rpcError(null, -32600, "Cross-origin requests are not accepted here.", 403);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return rpcError(null, -32600, "Request body too large.", 413);
  }

  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error.", 400);
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return rpcError(null, -32600, `Send between 1 and ${MAX_BATCH} calls per request.`, 400);
  }

  // Charge the request *before* checking what it asks for. Validating first
  // would let someone hammer this endpoint with blocked methods for free — they
  // would never reach the RPC node, but they would still be burning our
  // function invocations, and nothing would slow them down.
  const gate = await rateLimit({
    name: "rpc",
    key: clientIp(req),
    limit: LIMIT,
    windowMs: WINDOW_MS,
    cost: calls.length,
  });
  if (!gate.ok) {
    const res = rpcError(null, -32005, "Too many requests. Slow down and try again.", 429);
    res.headers.set("Retry-After", String(gate.retryAfter));
    return res;
  }

  for (const call of calls) {
    const method = typeof call?.method === "string" ? call.method : "";
    if (!ALLOWED.has(method)) {
      // Naming the method is deliberate: if this ever fires for a legitimate
      // flow, the log says exactly what to add.
      console.warn("[rpc] blocked method", method || "(none)");
      return rpcError(
        call?.id,
        -32601,
        `The method "${method || "(none)"}" is not available through this endpoint.`,
        403,
      );
    }
  }

  const { rpcUrl } = getAppConfig();

  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
      // A node that has not answered in 20s is not going to; failing here beats
      // holding the function open until the platform kills it.
      signal: AbortSignal.timeout(20_000),
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        // Chain state is never cacheable, and a stale blockhash is worse than
        // a slow one.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never surface the upstream URL — that is the whole point of this route.
    console.error("[rpc] upstream failed:", message);
    return rpcError(null, -32603, "The RPC node did not respond. Try again.", 502);
  }
}
