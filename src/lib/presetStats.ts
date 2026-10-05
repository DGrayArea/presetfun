import type { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

import { cacheStats, getCachedStats, type PresetStats } from "@/lib/presetStore";
import { withRetry } from "@/lib/retry";
import { fromBase } from "@/lib/venueTx";

const QUOTE_DECIMALS = 9;

/**
 * Launch, graduation and volume counts for one preset: every pool opened
 * against its config. Cached briefly, since it is a getProgramAccounts scan.
 */
export async function presetStats(
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
