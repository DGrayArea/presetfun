import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { buildCurveWithMarketCap, validateConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";

import {
  DEFAULT_SPEC,
  STARTER_PRESETS,
  buildConfig,
  parseSpec,
  sampleCurve,
  shapeWeights,
  summarize,
  validateSpec,
  type CurveSpec,
} from "@/lib/curveStudio";

const shapes: CurveSpec[] = [
  { ...DEFAULT_SPEC, shape: "classic" },
  { ...DEFAULT_SPEC, shape: "wideBase", intensity: 70 },
  { ...DEFAULT_SPEC, shape: "steepStart", intensity: 70 },
  { ...DEFAULT_SPEC, shape: "twoStep", supplyAtMigrationPct: 20 },
];

describe("curve studio: building configs", () => {
  it.each(shapes)("builds a config the SDK accepts for $shape", (spec) => {
    const config = buildConfig(spec);
    expect(() =>
      validateConfigParameters({ ...config, leftoverReceiver: Keypair.generate().publicKey }),
    ).not.toThrow();
    expect(config.migrationQuoteThreshold.gtn(0)).toBe(true);
  });

  it("keeps classic identical to the pre-studio launch", () => {
    // Existing launches were built with buildCurveWithMarketCap and these
    // numbers; the studio's classic shape must not move them.
    const studio = buildConfig(DEFAULT_SPEC);
    const legacy = buildCurveWithMarketCap({
      initialMarketCap: 30,
      migrationMarketCap: 500,
      token: { tokenType: 0, tokenBaseDecimal: 6, tokenQuoteDecimal: 9, tokenAuthorityOption: 1, totalTokenSupply: 1e9, leftover: 0 },
      fee: {
        baseFeeParams: {
          baseFeeMode: 0,
          feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
        },
        dynamicFeeEnabled: true,
        collectFeeMode: 0,
        creatorTradingFeePercentage: 50,
        poolCreationFee: 0,
        enableFirstSwapWithMinFee: false,
      },
      migration: { migrationOption: 1, migrationFeeOption: 3, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
      liquidityDistribution: {
        partnerPermanentLockedLiquidityPercentage: 100,
        partnerLiquidityPercentage: 0,
        creatorPermanentLockedLiquidityPercentage: 0,
        creatorLiquidityPercentage: 0,
      },
      lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
      activationType: 1,
    });
    expect(studio.sqrtStartPrice.toString()).toBe(legacy.sqrtStartPrice.toString());
    expect(studio.migrationQuoteThreshold.toString()).toBe(legacy.migrationQuoteThreshold.toString());
  });

  it("gives each shape the behaviour it is named for", () => {
    const classic = summarize(buildConfig(shapes[0]));
    const wide = summarize(buildConfig(shapes[1]));
    const steep = summarize(buildConfig(shapes[2]));

    // A wide base sells more of the supply cheaply, so it raises less.
    expect(wide.soldAtGraduationPct).toBeGreaterThan(classic.soldAtGraduationPct);
    expect(wide.raiseSol).toBeLessThan(classic.raiseSol);
    // A steep start does the opposite.
    expect(steep.soldAtGraduationPct).toBeLessThan(classic.soldAtGraduationPct);
    expect(steep.raiseSol).toBeGreaterThan(classic.raiseSol);
    // All shapes open at the same price, so a first 1 SOL buy gets much the
    // same share; by 10 SOL of buying the steep curve has given out far less.
    expect(steep.firstBuys[0].supplyPct / wide.firstBuys[0].supplyPct).toBeGreaterThan(0.7);
    expect(steep.firstBuys[2].supplyPct).toBeLessThan(wide.firstBuys[2].supplyPct * 0.7);
  });

  it("makes intensity 0 an even spread", () => {
    expect(new Set(shapeWeights("wideBase", 0))).toEqual(new Set([1]));
    expect(new Set(shapeWeights("steepStart", 0))).toEqual(new Set([1]));
  });
});

describe("curve studio: sampling", () => {
  it.each(shapes)("walks $shape from the opening cap to the graduation cap", (spec) => {
    const config = buildConfig(spec);
    const points = sampleCurve(config);
    const first = points[0];
    const last = points[points.length - 1];

    expect(first.marketCapSol).toBeCloseTo(spec.initialMarketCap, 0);
    expect(last.marketCapSol / spec.migrationMarketCap).toBeGreaterThan(0.97);
    expect(last.marketCapSol / spec.migrationMarketCap).toBeLessThan(1.03);
    // The chart ends exactly where the program graduates the coin.
    expect(last.raisedSol).toBeCloseTo(Number(config.migrationQuoteThreshold.toString()) / 1e9, 6);
    // Supply and market cap only ever go up along the curve.
    for (let i = 1; i < points.length; i++) {
      expect(points[i].soldPct).toBeGreaterThanOrEqual(points[i - 1].soldPct);
      expect(points[i].marketCapSol).toBeGreaterThanOrEqual(points[i - 1].marketCapSol * 0.999);
    }
  });
});

describe("curve studio: specs", () => {
  it.each(STARTER_PRESETS)("ships a buildable starter preset: $name", ({ spec }) => {
    expect(validateSpec(spec)).toBeNull();
    const s = summarize(buildConfig(spec));
    expect(s.raiseSol).toBeGreaterThan(0);
    expect(s.soldAtGraduationPct).toBeGreaterThan(0);
    expect(s.soldAtGraduationPct).toBeLessThan(100);
  });

  it("rejects specs a launcher would regret", () => {
    expect(validateSpec({ ...DEFAULT_SPEC, migrationMarketCap: 20 })).toMatch(/above the opening/);
    expect(validateSpec({ ...DEFAULT_SPEC, feeBps: 5 })).toMatch(/swap fee/);
    expect(
      validateSpec({ ...DEFAULT_SPEC, antiSniper: { startFeeBps: 50, minutes: 5 } }),
    ).toMatch(/start above/);
    expect(validateSpec({ ...DEFAULT_SPEC, shape: "twoStep", supplyAtMigrationPct: 90 })).toMatch(/5-50%/);
  });

  it("parses request bodies, numbers as strings included", () => {
    const spec = parseSpec({
      shape: "steepStart",
      initialMarketCap: "40",
      migrationMarketCap: "800",
      intensity: 50,
      feeBps: 100,
      creatorFeePct: "25",
      migratedFeeBps: 100,
      antiSniper: { startFeeBps: 3000, minutes: 3 },
    });
    expect(spec.initialMarketCap).toBe(40);
    expect(spec.antiSniper).toEqual({ startFeeBps: 3000, minutes: 3 });
    expect(() => parseSpec({ ...spec, shape: "cubic" })).toThrow(/shape/);
    expect(() => parseSpec({ ...spec, initialMarketCap: "lots" })).toThrow(/number/);
  });
});
