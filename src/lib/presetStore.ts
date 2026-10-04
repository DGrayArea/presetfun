import { redisExec } from "@/lib/redis";
import type { CurveSpec } from "@/lib/curveStudio";

/**
 * Where published Curve Studio presets are listed.
 *
 * The preset itself lives on-chain: it is a Meteora DBC config account, and
 * anyone can open a pool against it. What Redis adds is the part the chain
 * does not carry — a name, a description, and the spec the config was built
 * from, so the marketplace can draw the curve without reverse-engineering it.
 * Nothing here is trusted on the way back in to a launch: the launch route
 * reads the config account itself.
 *
 * Layout: one JSON string per preset under `preset:<config>`, and a sorted set
 * `presets:index` of config addresses scored by publish time, newest first.
 */

export type StoredPreset = {
  config: string;
  author: string;
  name: string;
  description: string;
  assetClass: string;
  spec: CurveSpec;
  createdAt: number;
};

const INDEX = "presets:index";
const keyFor = (config: string) => `preset:${config}`;

/** Most presets the marketplace pages through at once. */
export const MAX_LIST = 100;

export async function savePreset(preset: StoredPreset): Promise<void> {
  await redisExec([
    ["SET", keyFor(preset.config), JSON.stringify(preset)],
    ["ZADD", INDEX, preset.createdAt, preset.config],
  ]);
}

export async function getPreset(config: string): Promise<StoredPreset | null> {
  const [raw] = await redisExec([["GET", keyFor(config)]]);
  return typeof raw === "string" ? (JSON.parse(raw) as StoredPreset) : null;
}

export async function listPresets(limit = MAX_LIST): Promise<StoredPreset[]> {
  const [configs] = await redisExec([["ZREVRANGE", INDEX, 0, Math.min(limit, MAX_LIST) - 1]]);
  const ids = (configs as string[] | null) ?? [];
  if (ids.length === 0) return [];
  const [values] = await redisExec([["MGET", ...ids.map(keyFor)]]);
  return ((values as (string | null)[]) ?? [])
    .filter((v): v is string => typeof v === "string")
    .map((v) => JSON.parse(v) as StoredPreset);
}

/**
 * Per-preset launch counts are an on-chain scan (getProgramAccounts over the
 * pools for one config), so they are cached for a few minutes rather than
 * recomputed on every visit to the marketplace.
 */
const STATS_TTL_SECONDS = 300;

export type PresetStats = { launches: number; graduated: number; volumeSol: number };

export async function getCachedStats(config: string): Promise<PresetStats | null> {
  const [raw] = await redisExec([["GET", `preset-stats:${config}`]]);
  return typeof raw === "string" ? (JSON.parse(raw) as PresetStats) : null;
}

export async function cacheStats(config: string, stats: PresetStats): Promise<void> {
  await redisExec([["SET", `preset-stats:${config}`, JSON.stringify(stats), "EX", STATS_TTL_SECONDS]]);
}
