import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { CollectFeeMode, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

import { getAppConfig } from "@/lib/config.server";
import { DEFAULT_SPEC, buildConfig, parseSpec, type CurveSpec } from "@/lib/curveStudio";
import { withRetry } from "@/lib/retry";
import { explainVenueError, finalizeSteps, fromBase, toBase, type Step } from "@/lib/venueTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Meteora Dynamic Bonding Curve — launch a coin, trade it, claim the fees.
 *
 * DBC is the curve infrastructure a lot of Solana launchpads are built on
 * rather than a launchpad in its own right, which is why it is worth supporting
 * directly: one integration covers the same mechanism several front-ends use.
 *
 * The shape differs from pump.fun in one way that matters. A pump coin uses a
 * single global curve with fixed parameters; a DBC launch carries its own
 * `config` account describing the curve, the fee split and what happens at
 * migration. That config is created by a *partner*, and the partner is the
 * account that later claims partner trading fees. A launch designed in the
 * studio is created against a fresh config whose fee claimer is the launcher
 * themselves, so they keep both the creator and the partner share. (Launching
 * from someone else's preset is /api/dbc/presets, where the preset's author is
 * the partner instead.)
 *
 * Creation is two transactions, not one: the config has to exist on-chain
 * before the pool that references it can be initialised. They are returned in
 * order and the client signs them in sequence.
 */

const NOT_A_POOL =
  "No Meteora DBC pool found. Paste either the coin's mint or its pool address.";

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

type Body = {
  action?: "pool" | "quote" | "create" | "trade" | "claim";
  owner?: string;
  poolId?: string;
  /** create */
  name?: string;
  symbol?: string;
  uri?: string;
  /**
   * The whole curve, as Curve Studio describes it. When absent, the flat
   * fields below are read instead, which is what launches sent before the
   * studio existed and still produces exactly the same config.
   */
  curve?: unknown;
  /** Market cap in SOL at launch, and the cap at which it migrates to a real pool. */
  initialMarketCap?: number;
  migrationMarketCap?: number;
  /** Swap fee traders pay, in basis points. */
  feeBps?: number;
  /** Share of the trading fee that goes to the coin's creator, 0-100. */
  creatorFeePct?: number;
  /** Optional SOL the creator buys at launch, seeding the curve. */
  firstBuy?: string;
  /** trade / quote */
  side?: "buy" | "sell";
  amount?: string;
  slippagePct?: number;
};

function key(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address.`);
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const { cluster, rpcUrl, feeWallet, fees } = getAppConfig();
  if (cluster !== "mainnet-beta") {
    return NextResponse.json(
      { error: "Meteora DBC is only deployed on mainnet." },
      { status: 400 },
    );
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const client = DynamicBondingCurveClient.create(connection, "confirmed");
  const action = body.action ?? "pool";

  try {
    if (!body.owner) throw new Error("owner is required.");
    const ownerKey = key(body.owner, "Wallet");

    if (action === "create") {
      const { name, symbol, uri, firstBuy } = body;
      if (!name?.trim() || !symbol?.trim() || !uri?.trim()) {
        throw new Error("name, symbol and uri are required.");
      }
      // Describes the whole launch: the price curve, who earns what while it
      // trades, and where the liquidity lands once it graduates.
      const spec: CurveSpec = body.curve
        ? parseSpec(body.curve)
        : parseSpec({
            ...DEFAULT_SPEC,
            shape: "classic",
            initialMarketCap: body.initialMarketCap ?? DEFAULT_SPEC.initialMarketCap,
            migrationMarketCap: body.migrationMarketCap ?? DEFAULT_SPEC.migrationMarketCap,
            feeBps: body.feeBps ?? DEFAULT_SPEC.feeBps,
            creatorFeePct: body.creatorFeePct ?? DEFAULT_SPEC.creatorFeePct,
          });
      const curve = buildConfig(spec);

      const configKeypair = Keypair.generate();
      const baseMint = Keypair.generate();
      const buyLamports = firstBuy?.trim() ? toBase(firstBuy, 9, "SOL") : new BN(0);

      const { createConfigTx, createPoolWithFirstBuyTx } =
        await client.partner.createConfigAndPoolWithFirstBuy({
          config: configKeypair.publicKey,
          // The launcher claims the partner share too: no middleman on their own curve.
          feeClaimer: ownerKey,
          // Unsold supply at migration goes back to whoever launched it.
          leftoverReceiver: ownerKey,
          quoteMint: WSOL,
          payer: ownerKey,
          ...curve,
          preCreatePoolParam: {
            name: name.trim(),
            symbol: symbol.trim(),
            uri: uri.trim(),
            poolCreator: ownerKey,
            baseMint: baseMint.publicKey,
          },
          firstBuyParam: buyLamports.isZero()
            ? undefined
            : {
                buyer: ownerKey,
                buyAmount: buyLamports,
                // The creator is buying their own launch at a price they set
                // seconds ago, so there is nothing to slip against.
                minimumAmountOut: new BN(0),
                referralTokenAccount: null,
              },
        });

      const steps: Step[] = [
        { tx: createConfigTx, signers: [configKeypair] },
        { tx: createPoolWithFirstBuyTx, signers: [baseMint] },
      ];

      const out = await finalizeSteps({
        connection,
        steps,
        owner: ownerKey,
        feeWallet,
        feeSol: fees.launchpadCreate,
      });

      return NextResponse.json({
        ...out,
        feeSol: fees.launchpadCreate,
        mint: baseMint.publicKey.toBase58(),
        config: configKeypair.publicKey.toBase58(),
        migrationQuoteThreshold: fromBase(curve.migrationQuoteThreshold.toString(), 9),
      });
    }

    // Everything below needs a live pool.
    if (!body.poolId) throw new Error("poolId is required.");
    const given = key(body.poolId, "Pool or mint");

    // People have the coin's mint, not the pool address it launched into, so
    // accept either: try the address as a pool first, then as a base mint.
    let poolKey = given;
    let virtualPool = null;
    try {
      virtualPool = await withRetry(() => client.state.getPool(given));
    } catch {
      // Pointed at anything that is not a pool account, the decoder throws
      // rather than returning null — so this has to swallow and fall through to
      // the mint lookup, not propagate.
    }
    if (!virtualPool) {
      const byMint = await withRetry(() => client.state.getPoolByBaseMint(given));
      if (byMint) {
        poolKey = byMint.publicKey;
        virtualPool = byMint.account;
      }
    }
    if (!virtualPool) throw new Error(NOT_A_POOL);
    const state = virtualPool.poolState;
    const poolConfig = await withRetry(() => client.state.getPoolConfig(state.config));
    if (!poolConfig) throw new Error("That pool's config account is missing.");

    // Read from the config rather than assuming: a DBC launch picks its own
    // token decimals, and the fee is denominated by the pool's collect mode —
    // either in the quote (SOL) or in whatever the trade paid out.
    const baseDecimals = poolConfig.tokenDecimal;
    const QUOTE_DECIMALS = 9;
    const feeInQuote = poolConfig.collectFeeMode === CollectFeeMode.QuoteToken;

    const summary = {
      poolId: poolKey.toBase58(),
      mint: state.baseMint.toBase58(),
      config: state.config.toBase58(),
      // Once this flips the curve is done and the coin has moved to a real pool.
      migrated: state.isMigrated !== 0,
      quoteReserve: fromBase(state.quoteReserve.toString(), 9),
      baseReserve: fromBase(state.baseReserve.toString(), baseDecimals),
      migrationTarget: fromBase(poolConfig.migrationQuoteThreshold.toString(), 9),
    };

    if (action === "pool") return NextResponse.json({ pool: summary });

    if (action === "trade" || action === "quote") {
      const { side = "buy", amount, slippagePct = 2 } = body;
      if (!amount?.trim()) throw new Error("amount is required.");
      if (summary.migrated) {
        throw new Error(
          "This coin has already graduated off its curve — trade it on the migrated pool instead.",
        );
      }

      const sellingToken = side === "sell";
      const amountIn = toBase(
        amount,
        sellingToken ? baseDecimals : QUOTE_DECIMALS,
        sellingToken ? "That token" : "SOL",
      );
      const outDecimals = sellingToken ? QUOTE_DECIMALS : baseDecimals;

      // Quoted for trades too: its minimumAmountOut is what protects the
      // trade from a sandwich. Slippage is clamped to a sane range.
      const slippage = Math.min(Math.max(Number(slippagePct) || 2, 0.1), 50);
      const quote = client.pool.swapQuote({
        virtualPool,
        config: poolConfig,
        swapBaseForQuote: sellingToken,
        amountIn,
        slippageBps: Math.round(slippage * 100),
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        // The curve is time-activated, so "now" is the point it prices against.
        currentPoint: new BN(Math.floor(Date.now() / 1000)),
      });

      if (action === "quote") {
        return NextResponse.json({
          pool: summary,
          amountOut: fromBase(quote.outputAmount.toString(), outDecimals),
          minimumAmountOut: fromBase(quote.minimumAmountOut.toString(), outDecimals),
          fee: fromBase(quote.tradingFee.toString(), feeInQuote ? QUOTE_DECIMALS : outDecimals),
          feeToken: feeInQuote ? "SOL" : sellingToken ? "SOL" : "token",
        });
      }

      const tx = await client.pool.swap({
        owner: ownerKey,
        pool: poolKey,
        amountIn,
        minimumAmountOut: quote.minimumAmountOut,
        swapBaseForQuote: sellingToken,
        referralTokenAccount: null,
      });

      // Percent of the trade rather than a flat charge, so a small buy is not
      // swamped by the fee — the same shape as the pump.fun trade fee.
      const feeSol =
        Math.round(Number(amount) * (fees.pumpTradePct / 100) * 1e9) / 1e9 || 0;

      const out = await finalizeSteps({
        connection,
        steps: [{ tx }],
        owner: ownerKey,
        feeWallet,
        feeSol: sellingToken ? 0 : feeSol,
      });
      return NextResponse.json({ ...out, pool: summary, feeSol: sellingToken ? 0 : feeSol });
    }

    if (action === "claim") {
      const owed = Number(state.creatorQuoteFee.toString()) / 1e9;
      if (owed <= 0) throw new Error("No creator fees to claim on this coin yet.");
      if (owed <= fees.liquidityClaim) {
        throw new Error(
          `Only ${owed.toFixed(6)} SOL is waiting, which is less than the ${fees.liquidityClaim} SOL claim fee. Wait until more builds up.`,
        );
      }
      const tx = await client.creator.claimCreatorTradingFee({
        creator: ownerKey,
        payer: ownerKey,
        pool: poolKey,
        maxBaseAmount: new BN(0),
        maxQuoteAmount: state.creatorQuoteFee,
      });

      const out = await finalizeSteps({
        connection,
        steps: [{ tx }],
        owner: ownerKey,
        feeWallet,
        feeSol: fees.liquidityClaim,
      });
      return NextResponse.json({ ...out, pool: summary, feeSol: fees.liquidityClaim });
    }

    throw new Error("Unknown action.");
  } catch (err) {
    const message = explainVenueError(err, NOT_A_POOL);
    console.error("[dbc]", action, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
