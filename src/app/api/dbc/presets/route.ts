import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

import { getAppConfig } from "@/lib/config.server";
import { buildConfig, parseSpec } from "@/lib/curveStudio";
import {
  cacheStats,
  getCachedStats,
  getPreset,
  listPresets,
  savePreset,
  type PresetStats,
  type StoredPreset,
} from "@/lib/presetStore";
import { redisConfigured, redisExec } from "@/lib/redis";
import { withRetry } from "@/lib/retry";
import { explainVenueError, finalizeSteps, fromBase, toBase, type Step } from "@/lib/venueTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Curve Studio presets — a marketplace of Meteora DBC configs.
 *
 * A DBC config is a reusable on-chain account: it fixes the curve, the fee
 * schedule and the migration, and any number of pools can be opened against
 * it. Its `fee_claimer` collects the partner share of trading fees on every
 * one of those pools. So "publish a preset" here means "create a config whose
 * fee claimer is you", and every launch someone makes from it pays its author
 * for as long as the coin trades. No new program is involved; the marketplace
 * is the listing, and the economics are Meteora's own partner fee.
 *
 *   publish  → build the config transaction, remember who asked for it
 *   confirm  → once it has landed, check the account and list it
 *   list     → presets with launch / graduation counts
 *   launch   → open a pool against a preset's config
 *   earnings → what an author's presets have earned and not yet claimed
 *   claim    → claim it
 *
 * Publishing is two calls rather than one because the listing must not exist
 * before the config does. The pending record is keyed by a config address the
 * server generated a moment earlier, so only the wallet that asked to publish
 * can know it before it is on-chain — that is what stops anyone listing a
 * config under someone else's name.
 */

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

/** Pending publishes expire if the wallet never signs. */
const PENDING_TTL_SECONDS = 600;

/** Keeps each wallet prompt to a reviewable batch; call again for the rest. */
const MAX_CLAIMS_PER_REQUEST = 10;

const QUOTE_DECIMALS = 9;

/** PoolConfig layout: 8-byte discriminator, then `quote_mint`, then `fee_claimer`. */
const FEE_CLAIMER_OFFSET = 8 + 32;

const ASSET_CLASSES = ["Meme", "Community", "RWA", "Equity", "AI", "Other"];

type Body = {
  action?: "list" | "publish" | "confirm" | "launch" | "earnings" | "claim";
  owner?: string;
  /** publish */
  curve?: unknown;
  name?: string;
  description?: string;
  assetClass?: string;
  /** confirm / launch */
  config?: string;
  /** launch */
  symbol?: string;
  uri?: string;
  firstBuy?: string;
};

function key(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address.`);
  }
}

function clean(text: unknown, max: number): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

async function presetStats(
  client: DynamicBondingCurveClient,
  config: string,
): Promise<PresetStats> {
  const cached = await getCachedStats(config).catch(() => null);
  if (cached) return cached;
  const pools = await withRetry(() => client.state.getPoolsByConfig(config));
  const stats: PresetStats = {
    launches: pools.length,
    graduated: pools.filter((p) => p.account.poolState.isMigrated !== 0).length,
    // SOL currently sitting in the curves, plus what graduated ones raised.
    volumeSol: pools.reduce(
      (sum, p) => sum + Number(fromBase(p.account.poolState.quoteReserve, QUOTE_DECIMALS)),
      0,
    ),
  };
  await cacheStats(config, stats).catch(() => {});
  return stats;
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
    return NextResponse.json({ error: "Meteora DBC is only deployed on mainnet." }, { status: 400 });
  }
  if (!redisConfigured) {
    return NextResponse.json({ error: "Presets need Redis, which is not configured." }, { status: 503 });
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const client = DynamicBondingCurveClient.create(connection, "confirmed");
  const action = body.action ?? "list";

  try {
    if (action === "list") {
      const presets = await listPresets();
      const withStats = await Promise.all(
        presets.map(async (p) => ({
          ...p,
          stats: await presetStats(client, p.config).catch(() => null),
        })),
      );
      return NextResponse.json({ presets: withStats });
    }

    if (!body.owner) throw new Error("owner is required.");
    const ownerKey = key(body.owner, "Wallet");

    if (action === "publish") {
      const spec = parseSpec(body.curve);
      const name = clean(body.name, 48);
      const description = clean(body.description, 280);
      const assetClass = ASSET_CLASSES.includes(body.assetClass ?? "") ? body.assetClass! : "Other";
      if (name.length < 3) throw new Error("Give the preset a name of at least three characters.");

      const configKeypair = Keypair.generate();
      const tx = await client.partner.createConfig({
        config: configKeypair.publicKey,
        // The author earns the partner share on every launch from this preset.
        feeClaimer: ownerKey,
        // Only the shaped curves leave anything over (a token dust of the
        // supply); it is set per config, so it goes to the author too.
        leftoverReceiver: ownerKey,
        quoteMint: WSOL,
        payer: ownerKey,
        ...buildConfig(spec),
      });

      const config = configKeypair.publicKey.toBase58();
      const pending: StoredPreset = {
        config,
        author: ownerKey.toBase58(),
        name,
        description,
        assetClass,
        spec,
        createdAt: Date.now(),
      };
      await redisExec([
        ["SET", `preset-pending:${config}`, JSON.stringify(pending), "EX", PENDING_TTL_SECONDS],
      ]);

      // Publishing is free beyond rent: the platform is paid when the preset
      // is used, not when it is made.
      const out = await finalizeSteps({
        connection,
        steps: [{ tx, signers: [configKeypair] }],
        owner: ownerKey,
        feeWallet: null,
        feeSol: 0,
      });
      return NextResponse.json({ ...out, config });
    }

    if (action === "confirm") {
      if (!body.config) throw new Error("config is required.");
      const config = key(body.config, "Config").toBase58();
      const [raw] = await redisExec([["GET", `preset-pending:${config}`]]);
      if (typeof raw !== "string") {
        if (await getPreset(config)) return NextResponse.json({ ok: true, config });
        throw new Error("No publish is waiting for that config. It may have expired; publish again.");
      }
      const pending = JSON.parse(raw) as StoredPreset;
      if (pending.author !== ownerKey.toBase58()) {
        throw new Error("Only the wallet that published this preset can confirm it.");
      }

      const onChain = (await withRetry(() =>
        client.state.getPoolConfig(config),
      )) as PoolConfig | null;
      if (!onChain) throw new Error("The config has not landed yet. Try again in a few seconds.");
      // Check the account really is the curve the listing will describe.
      const expected = buildConfig(pending.spec);
      if (
        !onChain.feeClaimer.equals(ownerKey) ||
        !onChain.sqrtStartPrice.eq(expected.sqrtStartPrice) ||
        !onChain.migrationQuoteThreshold.eq(expected.migrationQuoteThreshold)
      ) {
        throw new Error("The on-chain config does not match the preset that was published.");
      }

      await savePreset(pending);
      await redisExec([["DEL", `preset-pending:${config}`]]);
      return NextResponse.json({ ok: true, config });
    }

    if (action === "launch") {
      if (!body.config) throw new Error("Pick a preset to launch from.");
      const preset = await getPreset(key(body.config, "Config").toBase58());
      if (!preset) throw new Error("That preset is not listed here.");

      const name = clean(body.name, 32);
      const symbol = clean(body.symbol, 10);
      const uri = clean(body.uri, 200);
      if (!name || !symbol || !uri) throw new Error("name, symbol and uri are required.");

      const baseMint = Keypair.generate();
      const buyLamports = body.firstBuy?.trim() ? toBase(body.firstBuy, 9, "SOL") : new BN(0);
      const tx = await client.creator.createPoolWithFirstBuy({
        createPoolParam: {
          name,
          symbol,
          uri,
          payer: ownerKey,
          poolCreator: ownerKey,
          config: new PublicKey(preset.config),
          baseMint: baseMint.publicKey,
        },
        firstBuyParam: buyLamports.isZero()
          ? undefined
          : {
              buyer: ownerKey,
              buyAmount: buyLamports,
              // The creator buys their own launch in the same transaction that
              // opens it, so there is nothing to slip against.
              minimumAmountOut: new BN(0),
              referralTokenAccount: null,
            },
      });

      const steps: Step[] = [{ tx, signers: [baseMint] }];
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
        config: preset.config,
      });
    }

    if (action === "earnings" || action === "claim") {
      // Every config this wallet is fee claimer on: its published presets and
      // the private configs behind its own studio launches. Read from chain,
      // so a launch earns here whether or not it was ever listed.
      const configs = await withRetry(() =>
        client.state.program.account.poolConfig.all([
          { memcmp: { offset: FEE_CLAIMER_OFFSET, bytes: ownerKey.toBase58() } },
        ]),
      );
      const listed = new Map(
        (await listPresets().catch(() => [] as StoredPreset[]))
          .filter((p) => p.author === ownerKey.toBase58())
          .map((p) => [p.config, p]),
      );
      const mine = configs.map((c) => {
        const config = c.publicKey.toBase58();
        return { config, name: listed.get(config)?.name ?? "Your own launch", listed: listed.has(config) };
      });
      const pools = (
        await Promise.all(
          mine.map(async (p) => {
            const found = await withRetry(() => client.state.getPoolsByConfig(p.config));
            return found.map((f) => ({ preset: p, poolId: f.publicKey, pool: f.account }));
          }),
        )
      ).flat();

      const owed = pools.filter((p) => !p.pool.poolState.partnerQuoteFee.isZero());
      const unclaimed = owed.reduce((sum, p) => sum.add(p.pool.poolState.partnerQuoteFee), new BN(0));

      if (action === "earnings") {
        return NextResponse.json({
          presets: mine.map((p) => ({
            config: p.config,
            name: p.name,
            listed: p.listed,
            launches: pools.filter((x) => x.preset.config === p.config).length,
            unclaimedSol: fromBase(
              owed
                .filter((x) => x.preset.config === p.config)
                .reduce((sum, x) => sum.add(x.pool.poolState.partnerQuoteFee), new BN(0)),
              QUOTE_DECIMALS,
            ),
          })),
          unclaimedSol: fromBase(unclaimed, QUOTE_DECIMALS),
        });
      }

      if (owed.length === 0) throw new Error("Nothing waiting to be claimed yet.");
      const batch = owed
        .sort((a, b) => b.pool.poolState.partnerQuoteFee.cmp(a.pool.poolState.partnerQuoteFee))
        .slice(0, MAX_CLAIMS_PER_REQUEST);
      const steps: Step[] = await Promise.all(
        batch.map(async ({ poolId, pool }) => ({
          tx: await client.partner.claimPartnerTradingFee({
            feeClaimer: ownerKey,
            payer: ownerKey,
            pool: poolId,
            // Claim exactly what the account says is owed; the program caps at
            // the real balance, so a stale read can only under-claim.
            maxBaseAmount: pool.poolState.partnerBaseFee,
            maxQuoteAmount: pool.poolState.partnerQuoteFee,
          }),
        })),
      );
      const out = await finalizeSteps({
        connection,
        steps,
        owner: ownerKey,
        feeWallet,
        feeSol: fees.liquidityClaim,
      });
      return NextResponse.json({
        ...out,
        feeSol: fees.liquidityClaim,
        claimingSol: fromBase(
          batch.reduce((sum, p) => sum.add(p.pool.poolState.partnerQuoteFee), new BN(0)),
          QUOTE_DECIMALS,
        ),
        remaining: owed.length - batch.length,
      });
    }

    throw new Error("Unknown action.");
  } catch (err) {
    const message = explainVenueError(err, "That preset could not be found.");
    console.error("[dbc/presets]", action, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
