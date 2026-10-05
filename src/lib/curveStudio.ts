import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  Rounding,
  TokenDecimal,
  TokenType,
  buildCurveWithLiquidityWeights,
  buildCurveWithMarketCap,
  buildCurveWithTwoSegments,
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  type BuildCurveBaseParams,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

/**
 * Curve Studio — describe a Dynamic Bonding Curve launch as a small, plain
 * spec, and turn that spec into the on-chain config Meteora expects.
 *
 * The spec is the unit everything else shares: the studio previews it in the
 * browser, `/api/dbc` builds the config from it on the server, and a published
 * preset stores it beside the config address so anyone browsing presets sees
 * the same chart the author did. Keeping one builder for all three is what
 * guarantees the preview is the curve that actually ships.
 *
 * Shapes, in the terms a launcher thinks in:
 *
 * - **classic** — one constant-product segment between the two market caps,
 *   the pump.fun-style curve most launchpads use.
 * - **wideBase** — liquidity weighted towards the start, so the price stays
 *   near the opening cap for much of the supply. More of the supply sells
 *   cheaply and the raise is smaller: a community or fair-distribution launch.
 * - **steepStart** — liquidity weighted towards the end, so the price climbs
 *   quickly through the early buying and flattens near graduation. Less supply
 *   sells before migration and the raise is larger. Every shape opens at the
 *   same price, so a single first buy gets the same deal on any of them; what
 *   changes is how fast the price runs away from it; by 10 SOL of buying a
 *   steep curve has handed out about half the supply a wide one has, which
 *   blunts a sniper buying in size.
 * - **twoStep** — two segments with a chosen share of the supply left for the
 *   migrated pool, for launches that want deeper liquidity after graduation.
 */

export type CurveShape = "classic" | "wideBase" | "steepStart" | "twoStep";

export type CurveSpec = {
  shape: CurveShape;
  /** Market cap in SOL at the open, and the cap at which it graduates. */
  initialMarketCap: number;
  migrationMarketCap: number;
  /**
   * wideBase / steepStart: how strongly liquidity leans to one end, 0-100.
   * 0 is an even spread (the same curve as classic); 100 is the most extreme
   * shape the studio offers.
   */
  intensity?: number;
  /** twoStep: share of the supply that goes into the migrated pool, 5-50. */
  supplyAtMigrationPct?: number;
  /** Swap fee traders pay once the launch has settled, in basis points. */
  feeBps: number;
  /**
   * Optional launch fee that starts high and decays to `feeBps`, so a bot
   * buying in the opening seconds pays for the privilege.
   */
  antiSniper?: { startFeeBps: number; minutes: number } | null;
  /** Share of the trading fee that goes to the coin's creator, 0-100. */
  creatorFeePct: number;
  /** Swap fee on the DAMM v2 pool the coin graduates into, in basis points. */
  migratedFeeBps: MigratedFeeBps;
};

export type MigratedFeeBps = 25 | 100 | 200 | 400;

const MIGRATED_FEE_OPTION: Record<MigratedFeeBps, MigrationFeeOption> = {
  25: MigrationFeeOption.FixedBps25,
  100: MigrationFeeOption.FixedBps100,
  200: MigrationFeeOption.FixedBps200,
  400: MigrationFeeOption.FixedBps400,
};

/** Supply is fixed at launch; this matches what most curve launches use. */
export const TOTAL_SUPPLY = 1_000_000_000;

const BASE_DECIMALS = TokenDecimal.SIX;
const QUOTE_DECIMALS = TokenDecimal.NINE;

/**
 * The weighted and two-segment builders refuse a zero leftover, so those
 * shapes keep a token dust of the supply back. It goes to the config's
 * leftover receiver at migration and is far too small to matter (0.0001%).
 */
const SHAPED_LEFTOVER = 1_000;

/** The liquidity-weights builder always lays the curve out in sixteen segments. */
const SEGMENTS = 16;

/** Largest per-segment weight ratio the studio exposes; past this the SDK's
 * price steps get coarse enough that the preview stops being trustworthy. */
const MAX_RATIO = 0.25;

/** Defaults for a spec built from nothing, matching the pre-studio launch. */
export const DEFAULT_SPEC: CurveSpec = {
  shape: "classic",
  initialMarketCap: 30,
  migrationMarketCap: 500,
  intensity: 50,
  supplyAtMigrationPct: 20,
  feeBps: 100,
  antiSniper: null,
  creatorFeePct: 50,
  migratedFeeBps: 200,
};

/**
 * Check a spec is something worth building. Returns a sentence a launcher can
 * act on, or null. The SDK validates the built config as well; this catches
 * the mistakes a person makes before they reach its less friendly messages.
 */
export function validateSpec(spec: CurveSpec): string | null {
  const { initialMarketCap: open, migrationMarketCap: grad } = spec;
  if (!(open > 0) || !(grad > 0)) return "Both market caps must be above zero.";
  if (!(grad > open)) return "The graduation market cap must be above the opening one.";
  if (grad / open > 1_000) return "Keep graduation within 1,000× the opening market cap.";
  if (!(spec.feeBps >= 25 && spec.feeBps <= 1_000)) {
    return "The swap fee must be between 0.25% and 10%.";
  }
  if (!(spec.creatorFeePct >= 0 && spec.creatorFeePct <= 100)) {
    return "The creator's fee share must be between 0 and 100 percent.";
  }
  if (!(spec.migratedFeeBps in MIGRATED_FEE_OPTION)) {
    return "Pick one of the offered fees for the graduated pool.";
  }
  if (spec.shape === "wideBase" || spec.shape === "steepStart") {
    const i = spec.intensity ?? DEFAULT_SPEC.intensity!;
    if (!(i >= 0 && i <= 100)) return "Intensity must be between 0 and 100.";
  }
  if (spec.shape === "twoStep") {
    const pct = spec.supplyAtMigrationPct ?? DEFAULT_SPEC.supplyAtMigrationPct!;
    if (!(pct >= 5 && pct <= 50)) return "Supply kept for the graduated pool must be 5-50%.";
  }
  if (spec.antiSniper) {
    const { startFeeBps, minutes } = spec.antiSniper;
    if (!(startFeeBps > spec.feeBps && startFeeBps <= 9_900)) {
      return "The launch fee must start above the normal fee and at most 99%.";
    }
    if (!(minutes >= 1 && minutes <= 60)) return "The launch fee can decay over 1-60 minutes.";
  }
  return null;
}

/**
 * Per-segment liquidity weights. A segment with more liquidity absorbs more
 * buying before the price moves, so weights that fall away from the start
 * hold the price down early (wideBase) and weights that rise do the opposite.
 */
export function shapeWeights(shape: "wideBase" | "steepStart", intensity: number): number[] {
  const t = Math.min(Math.max(intensity, 0), 100) / 100;
  // Per-segment growth factor: 1 at intensity 0, MAX_RATIO away from 1 at 100.
  const step = shape === "wideBase" ? 1 - MAX_RATIO * t : 1 / (1 - MAX_RATIO * t);
  return Array.from({ length: SEGMENTS }, (_, i) => Math.pow(step, i));
}

function baseParams(spec: CurveSpec, leftover: number): BuildCurveBaseParams {
  const launchFee = spec.antiSniper;
  return {
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: BASE_DECIMALS,
      tokenQuoteDecimal: QUOTE_DECIMALS,
      tokenAuthorityOption: 1,
      totalTokenSupply: TOTAL_SUPPLY,
      leftover,
    },
    fee: {
      baseFeeParams: {
        // Exponential decay front-loads the cost onto the first few seconds,
        // which is where snipers live, then hands back to the normal fee.
        baseFeeMode: launchFee ? BaseFeeMode.FeeSchedulerExponential : BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: launchFee
          ? {
              startingFeeBps: launchFee.startFeeBps,
              endingFeeBps: spec.feeBps,
              // One step every ten seconds keeps the decay smooth to a buyer.
              numberOfPeriod: launchFee.minutes * 6,
              totalDuration: launchFee.minutes * 60,
            }
          : {
              startingFeeBps: spec.feeBps,
              endingFeeBps: spec.feeBps,
              numberOfPeriod: 0,
              totalDuration: 0,
            },
      },
      dynamicFeeEnabled: true,
      // Fees taken in SOL, so the creator's share is worth something the
      // moment it is earned.
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: spec.creatorFeePct,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MIGRATED_FEE_OPTION[spec.migratedFeeBps],
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    // All migrated liquidity is permanently locked: liquidity nobody can pull
    // is the difference between a graduated coin and a rug waiting to happen.
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
  };
}

/** Turn a spec into the config Meteora's `createConfig` takes. Throws on a bad spec. */
export function buildConfig(spec: CurveSpec): ConfigParameters {
  const problem = validateSpec(spec);
  if (problem) throw new Error(problem);

  const caps = {
    initialMarketCap: spec.initialMarketCap,
    migrationMarketCap: spec.migrationMarketCap,
  };

  switch (spec.shape) {
    case "classic":
      return buildCurveWithMarketCap({ ...baseParams(spec, 0), ...caps });
    case "wideBase":
    case "steepStart":
      return buildCurveWithLiquidityWeights({
        ...baseParams(spec, SHAPED_LEFTOVER),
        ...caps,
        liquidityWeights: shapeWeights(spec.shape, spec.intensity ?? DEFAULT_SPEC.intensity!),
      });
    case "twoStep":
      return buildCurveWithTwoSegments({
        ...baseParams(spec, SHAPED_LEFTOVER),
        ...caps,
        percentageSupplyOnMigration:
          spec.supplyAtMigrationPct ?? DEFAULT_SPEC.supplyAtMigrationPct!,
      });
    default:
      throw new Error("Unknown curve shape.");
  }
}

export type CurvePoint = {
  /** Share of total supply bought off the curve so far, 0-100. */
  soldPct: number;
  /** Market cap in SOL at this point (spot price × total supply). */
  marketCapSol: number;
  /** SOL raised on the curve so far, before fees. */
  raisedSol: number;
};

const Q64 = new BN(1).shln(64);

/** sqrt price (Q64.64, raw units) → market cap in SOL over the full supply. */
function marketCapAt(sqrtPrice: BN): number {
  // price per raw base unit in raw quote units = (sqrtPrice / 2^64)^2
  const s = Number(sqrtPrice.toString()) / Number(Q64.toString());
  const rawPrice = s * s;
  const solPerToken = rawPrice * 10 ** (BASE_DECIMALS - QUOTE_DECIMALS);
  return solPerToken * TOTAL_SUPPLY;
}

/**
 * Walk the built curve from the opening price to graduation and report how
 * supply, market cap and the raise move together. Each segment is subdivided
 * so a chart of it is smooth; the walk stops at the migration threshold, since
 * any curve past that point is never traded.
 */
export function sampleCurve(config: ConfigParameters, totalPoints = 128): CurvePoint[] {
  const threshold = Number(config.migrationQuoteThreshold.toString());
  // Spread a fixed budget of points over however many segments the shape
  // has, so a two-segment classic curve is as smooth as a sixteen-segment one.
  const live = config.curve.filter((s) => !s.liquidity.isZero()).length || 1;
  const pointsPerSegment = Math.max(4, Math.ceil(totalPoints / live));
  const points: CurvePoint[] = [
    { soldPct: 0, marketCapSol: marketCapAt(config.sqrtStartPrice), raisedSol: 0 },
  ];

  let lower = config.sqrtStartPrice;
  let base = 0;
  let quote = 0;

  for (const segment of config.curve) {
    if (segment.liquidity.isZero() || segment.sqrtPrice.lte(lower)) continue;
    const upper = segment.sqrtPrice;
    const span = upper.sub(lower);

    for (let k = 1; k <= pointsPerSegment; k++) {
      const from = lower.add(span.muln(k - 1).divn(pointsPerSegment));
      const to = k === pointsPerSegment ? upper : lower.add(span.muln(k).divn(pointsPerSegment));
      const dBase = Number(
        getDeltaAmountBaseUnsigned(from, to, segment.liquidity, Rounding.Down).toString(),
      );
      const dQuote = Number(
        getDeltaAmountQuoteUnsigned(from, to, segment.liquidity, Rounding.Down).toString(),
      );

      if (quote + dQuote >= threshold) {
        // Graduation lands inside this step: take the share of it that gets
        // the raise exactly to the threshold, and stop there.
        const share = dQuote > 0 ? (threshold - quote) / dQuote : 0;
        base += dBase * share;
        quote = threshold;
        const sqrtEnd = Number(from.toString()) + Number(to.sub(from).toString()) * share;
        points.push(point(base, quote, marketCapAt(new BN(Math.floor(sqrtEnd).toString()))));
        return points;
      }

      base += dBase;
      quote += dQuote;
      points.push(point(base, quote, marketCapAt(to)));
    }
    lower = upper;
  }
  return points;
}

function point(base: number, quote: number, marketCapSol: number): CurvePoint {
  return {
    soldPct: (base / 10 ** BASE_DECIMALS / TOTAL_SUPPLY) * 100,
    marketCapSol,
    raisedSol: quote / 10 ** QUOTE_DECIMALS,
  };
}

export type CurveSummary = {
  /** SOL that has to be bought on the curve before it graduates. */
  raiseSol: number;
  /** Share of the supply sold off the curve by graduation. */
  soldAtGraduationPct: number;
  openMarketCapSol: number;
  graduationMarketCapSol: number;
  /** Share of the supply the first 1 / 5 / 10 SOL of buying takes, before fees. */
  firstBuys: { sol: number; supplyPct: number }[];
};

/** Supply share bought by `sol` of buying from the open, read off the samples. */
export function supplyForSol(points: CurvePoint[], sol: number): number {
  if (sol <= 0) return 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.raisedSol >= sol) {
      const t = (sol - a.raisedSol) / (b.raisedSol - a.raisedSol || 1);
      return a.soldPct + (b.soldPct - a.soldPct) * t;
    }
  }
  return points[points.length - 1]?.soldPct ?? 0;
}

export function summarize(config: ConfigParameters, points = sampleCurve(config)): CurveSummary {
  const last = points[points.length - 1];
  return {
    raiseSol: Number(config.migrationQuoteThreshold.toString()) / 10 ** QUOTE_DECIMALS,
    soldAtGraduationPct: last.soldPct,
    openMarketCapSol: points[0].marketCapSol,
    graduationMarketCapSol: last.marketCapSol,
    firstBuys: [1, 5, 10].map((sol) => ({ sol, supplyPct: supplyForSol(points, sol) })),
  };
}

/** Normalise untrusted input (a request body, a stored preset) into a spec, or throw. */
export function parseSpec(raw: unknown): CurveSpec {
  if (!raw || typeof raw !== "object") throw new Error("curve must be an object.");
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, label: string) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${label} must be a number.`);
    return n;
  };
  const shapes: CurveShape[] = ["classic", "wideBase", "steepStart", "twoStep"];
  if (!shapes.includes(r.shape as CurveShape)) throw new Error("Unknown curve shape.");

  const anti = r.antiSniper as Record<string, unknown> | null | undefined;
  const spec: CurveSpec = {
    shape: r.shape as CurveShape,
    initialMarketCap: num(r.initialMarketCap, "initialMarketCap"),
    migrationMarketCap: num(r.migrationMarketCap, "migrationMarketCap"),
    intensity: r.intensity === undefined ? undefined : num(r.intensity, "intensity"),
    supplyAtMigrationPct:
      r.supplyAtMigrationPct === undefined
        ? undefined
        : num(r.supplyAtMigrationPct, "supplyAtMigrationPct"),
    feeBps: Math.round(num(r.feeBps, "feeBps")),
    antiSniper: anti
      ? {
          startFeeBps: Math.round(num(anti.startFeeBps, "antiSniper.startFeeBps")),
          minutes: Math.round(num(anti.minutes, "antiSniper.minutes")),
        }
      : null,
    creatorFeePct: num(r.creatorFeePct, "creatorFeePct"),
    migratedFeeBps: num(r.migratedFeeBps ?? 200, "migratedFeeBps") as MigratedFeeBps,
  };
  const problem = validateSpec(spec);
  if (problem) throw new Error(problem);
  return spec;
}

/**
 * Starting points shipped with the studio, one per kind of asset. They are
 * specs, not on-chain configs: picking one fills the studio in, and the
 * launcher can publish it as their own preset or launch from it directly.
 */
export const STARTER_PRESETS: {
  id: string;
  name: string;
  assetClass: string;
  blurb: string;
  spec: CurveSpec;
}[] = [
  {
    id: "meme-classic",
    name: "Classic meme",
    assetClass: "Meme",
    blurb: "The familiar pump-style curve: 30 → 500 SOL, 1% fee, graduates around 98 SOL raised.",
    spec: { ...DEFAULT_SPEC },
  },
  {
    id: "meme-anti-snipe",
    name: "Snipe-resistant meme",
    assetClass: "Meme",
    blurb:
      "Steep opening and a 50% launch fee that decays to 1% over five minutes, so the first block pays for being first.",
    spec: {
      ...DEFAULT_SPEC,
      shape: "steepStart",
      intensity: 60,
      antiSniper: { startFeeBps: 5_000, minutes: 5 },
    },
  },
  {
    id: "community-fair",
    name: "Community fair launch",
    assetClass: "Community",
    blurb:
      "A wide, flat base: most of the supply sells near the opening price, so it ends up in many hands rather than a few.",
    spec: { ...DEFAULT_SPEC, shape: "wideBase", intensity: 70, initialMarketCap: 20, migrationMarketCap: 300 },
  },
  {
    id: "rwa-steady",
    name: "Real-world asset",
    assetClass: "RWA",
    blurb:
      "Starts at a valuation, not a meme cap (500 → 5,000 SOL), with a low 0.5% fee and a quarter of the supply kept to deepen the graduated pool.",
    spec: {
      ...DEFAULT_SPEC,
      shape: "twoStep",
      initialMarketCap: 500,
      migrationMarketCap: 5_000,
      supplyAtMigrationPct: 25,
      feeBps: 50,
      migratedFeeBps: 25,
    },
  },
  {
    id: "stock-paired",
    name: "Stock-paired",
    assetClass: "Equity",
    blurb:
      "For a name with a reference price: narrow 2× range around it, 0.3% fee, and a 1% graduated pool for active trading.",
    spec: {
      ...DEFAULT_SPEC,
      shape: "wideBase",
      intensity: 30,
      initialMarketCap: 1_000,
      migrationMarketCap: 2_000,
      feeBps: 30,
      migratedFeeBps: 100,
    },
  },
];

/**
 * Buy simulator.
 *
 * Plays a list of buys against a curve, in order, and reports what each buyer
 * walked away with. It answers the question the shapes exist for: "if a bot
 * puts 20 SOL in at the open and a crowd follows, who ends up holding what?"
 *
 * Fees are applied the way the program applies them to a SOL-in buy: taken
 * from the input before it reaches the curve. The anti-sniper fee is read
 * from the exponential schedule at each buy's time. The program's dynamic
 * (volatility) fee is not modelled, so real fees on a busy curve run slightly
 * higher; the comparison between shapes is what this is for, not a quote.
 */

export type SimBuy = { sol: number; atSeconds: number };

export type SimFill = {
  sol: number;
  atSeconds: number;
  feePct: number;
  feeSol: number;
  /** Share of total supply this buyer received. */
  supplyPct: number;
  /** Market cap the buyer effectively paid, averaged over their fill. */
  avgMarketCapSol: number;
  /** False once the curve has graduated and the buy could not fill. */
  filled: boolean;
};

/** Base fee in percent at `t` seconds after the open, per the spec's schedule. */
export function feePctAt(spec: CurveSpec, t: number): number {
  const end = spec.feeBps / 100;
  const launch = spec.antiSniper;
  if (!launch) return end;
  const periods = launch.minutes * 6;
  const periodSeconds = (launch.minutes * 60) / periods;
  const period = Math.min(Math.floor(Math.max(t, 0) / periodSeconds), periods);
  const start = launch.startFeeBps / 100;
  // Exponential decay from start to end across the periods.
  return start * Math.pow(end / start, period / periods);
}

export function simulateBuys(spec: CurveSpec, buys: SimBuy[], points?: CurvePoint[]): SimFill[] {
  const curve = points ?? sampleCurve(buildConfig(spec));
  const raise = curve[curve.length - 1].raisedSol;
  let raised = 0;

  return buys.map(({ sol, atSeconds }) => {
    const feePct = feePctAt(spec, atSeconds);
    const toCurve = Math.min(sol * (1 - feePct / 100), raise - raised);
    if (toCurve <= 0) {
      return { sol, atSeconds, feePct, feeSol: 0, supplyPct: 0, avgMarketCapSol: 0, filled: false };
    }
    const before = supplyForSol(curve, raised);
    raised += toCurve;
    const supplyPct = supplyForSol(curve, raised) - before;
    // Paid toCurve SOL for supplyPct% of the supply → implied market cap.
    const avgMarketCapSol = supplyPct > 0 ? toCurve / (supplyPct / 100) : 0;
    return {
      sol,
      atSeconds,
      feePct,
      feeSol: sol * (feePct / 100),
      supplyPct,
      avgMarketCapSol,
      filled: true,
    };
  });
}

export type Scenario = {
  id: string;
  label: string;
  blurb: string;
  buys: SimBuy[];
};

/** A first buyer at the open, then a crowd arriving after a delay. */
export function sniperScenario(sniperSol: number, crowd: number, eachSol: number, crowdAfterSeconds: number): SimBuy[] {
  return [
    { sol: sniperSol, atSeconds: 0 },
    ...Array.from({ length: crowd }, (_, i) => ({ sol: eachSol, atSeconds: crowdAfterSeconds + i * 5 })),
  ];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "sniper",
    label: "Sniper vs crowd",
    blurb: "A bot puts 20 SOL in at the open; 25 people buy 1 SOL each over the next few minutes.",
    buys: sniperScenario(20, 25, 1, 60),
  },
  {
    id: "whale",
    label: "Whale at the open",
    blurb: "One wallet buys 50 SOL in the first second, then 10 people buy 2 SOL each.",
    buys: sniperScenario(50, 10, 2, 30),
  },
  {
    id: "crowd",
    label: "Fair crowd",
    blurb: "40 people buy 1 SOL each, one every ten seconds. No one gets there first.",
    buys: Array.from({ length: 40 }, (_, i) => ({ sol: 1, atSeconds: i * 10 })),
  },
];
