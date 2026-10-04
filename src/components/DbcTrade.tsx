"use client";

import { useState } from "react";

import { useAppConfig } from "@/app/providers";
import { explorerUrl } from "@/lib/config";
import {
  Card,
  Choice,
  ConnectGate,
  DoneNote,
  ErrorNote,
  Field,
  PoolLookup,
  Submit,
} from "@/components/ui";
import { useVenueAction } from "@/components/useVenueAction";
import { friendlyError } from "@/lib/friendlyError";

type Pool = {
  poolId: string;
  mint: string;
  config: string;
  migrated: boolean;
  quoteReserve: string;
  baseReserve: string;
  migrationTarget: string;
};

type Quote = { amountOut: string; minimumAmountOut: string; fee: string; feeToken: string };

/** Trade a Meteora DBC coin while it is still on its curve, and collect creator fees. */
export function DbcTrade() {
  const { cluster, fees } = useAppConfig();
  const { run, call, busy, error, setError, signatures, setSignatures } = useVenueAction();

  const [address, setAddress] = useState("");
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("Done.");

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("2");
  const [quote, setQuote] = useState<Quote | null>(null);

  const progress = pool
    ? Math.min((Number(pool.quoteReserve) / Number(pool.migrationTarget)) * 100, 100)
    : 0;

  async function lookup(reset = true) {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    if (reset) {
      setPool(null);
      setQuote(null);
      setSignatures([]);
    }
    try {
      const j = await call("/api/dbc", { action: "pool", poolId: address.trim() });
      setPool(j.pool as Pool);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  async function priceIt() {
    if (!pool || !amount.trim()) return setQuote(null);
    try {
      const j = await call("/api/dbc", {
        action: "quote",
        poolId: pool.poolId,
        side,
        amount,
        slippagePct: Number(slippage) || 2,
      });
      setQuote(j as unknown as Quote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not price that.");
      setQuote(null);
    }
  }

  async function act(body: Record<string, unknown>, message: string) {
    if (!pool) return;
    setNote(message);
    const res = await run("/api/dbc", { ...body, poolId: pool.poolId });
    if (res) {
      setAmount("");
      setQuote(null);
      await lookup(false);
    }
  }

  return (
    <ConnectGate prompt="Connect a wallet to trade a Meteora launch or claim its fees.">
    <div className="space-y-4">
      <PoolLookup
        value={address}
        onChange={setAddress}
        onSubmit={() => lookup()}
        loading={loading}
        placeholder="Coin mint or DBC pool address"
      />

      <ErrorNote>{friendlyError(error)}</ErrorNote>
      <DoneNote message={note} signatures={signatures} />

      {pool && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <a
                href={explorerUrl(cluster, "token", pool.mint)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-xs text-slate-400 underline underline-offset-2"
              >
                {pool.mint.slice(0, 6)}…{pool.mint.slice(-6)}
              </a>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  pool.migrated
                    ? "bg-violet-500/10 text-violet-300"
                    : "bg-emerald-500/10 text-emerald-400"
                }`}
              >
                {pool.migrated ? "Graduated" : "On the curve"}
              </span>
            </div>

            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {Number(pool.quoteReserve).toLocaleString(undefined, { maximumFractionDigits: 3 })}{" "}
                of {Number(pool.migrationTarget).toLocaleString()} SOL raised
                {pool.migrated ? " — liquidity has moved to a real pool." : ` (${progress.toFixed(1)}%)`}
              </p>
            </div>
          </Card>

          {pool.migrated ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                This coin has graduated off its curve into a Meteora DAMM v2 pool, where any
                aggregator can route to it.
              </p>
              <a
                href={`https://jup.ag/swap/SOL-${pool.mint}`}
                target="_blank"
                rel="noreferrer noopener"
                className="block rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
              >
                Trade on Jupiter
              </a>
            </div>
          ) : (
            <Card className="space-y-4">
              <Choice
                label="Side"
                value={side}
                options={[
                  { value: "buy" as const, label: "Buy" },
                  { value: "sell" as const, label: "Sell" },
                ]}
                onChange={(v) => {
                  setSide(v);
                  setQuote(null);
                }}
              />
              <Field
                label={side === "buy" ? "SOL to spend" : "Tokens to sell"}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setQuote(null);
                }}
              />
              <Field label="Max slippage %" value={slippage} onChange={setSlippage} />

              <button
                onClick={priceIt}
                disabled={!amount.trim()}
                className="w-full rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:bg-white/5 disabled:opacity-50"
              >
                Price it
              </button>

              {quote && (
                <div className="space-y-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
                  <Row
                    label="You receive"
                    value={`${Number(quote.amountOut).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${side === "buy" ? "tokens" : "SOL"}`}
                  />
                  <Row
                    label="At worst"
                    value={Number(quote.minimumAmountOut).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}
                  />
                  <Row label="Swap fee" value={`${quote.fee} ${quote.feeToken}`} />
                </div>
              )}

              <Submit
                onClick={() =>
                  act(
                    { action: "trade", side, amount, slippagePct: Number(slippage) || 2 },
                    side === "buy" ? "Bought." : "Sold.",
                  )
                }
                busy={busy}
                disabled={!amount.trim()}
                label={side === "buy" ? "Buy" : "Sell"}
                feeSol={
                  side === "buy"
                    ? Math.round(Number(amount || 0) * (fees.pumpTradePct / 100) * 1e6) / 1e6
                    : 0
                }
              />
            </Card>
          )}

          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">Creator fees</h3>
            <p className="text-xs leading-relaxed text-slate-500">
              Your share of every swap on this coin, in SOL. It keeps accruing after the coin
              graduates, so this is worth coming back to.
            </p>
            <button
              onClick={() => act({ action: "claim" }, "Creator fees claimed.")}
              disabled={busy}
              className="w-full rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/15 disabled:opacity-50"
            >
              Claim · {fees.liquidityClaim} SOL
            </button>
          </Card>
        </>
      )}
    </div>
    </ConnectGate>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  );
}
