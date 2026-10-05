import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

import { getAppConfig } from "@/lib/config.server";
import { presetStats } from "@/lib/presetStats";
import { getPreset, type PresetStats, type StoredPreset } from "@/lib/presetStore";
import { redisConfigured } from "@/lib/redis";

export type LoadedPreset = StoredPreset & { stats: PresetStats | null };

/**
 * One preset for its public page, with launch counts when the chain answers.
 * Null for anything that is not a listed preset, including a malformed
 * address, so the page can 404 rather than error.
 */
export async function loadPreset(config: string): Promise<LoadedPreset | null> {
  if (!redisConfigured) return null;
  try {
    new PublicKey(config);
  } catch {
    return null;
  }
  const preset = await getPreset(config).catch(() => null);
  if (!preset) return null;

  let stats: PresetStats | null = null;
  try {
    const { rpcUrl } = getAppConfig();
    const client = DynamicBondingCurveClient.create(new Connection(rpcUrl, "confirmed"), "confirmed");
    stats = await presetStats(client, config);
  } catch {
    // The page is still worth showing without counts.
  }
  return { ...preset, stats };
}

/** Absolute site origin for share links and social cards. */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
