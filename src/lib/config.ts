/**
 * Shared config types and pure helpers.
 *
 * Deliberately free of `process.env` so this module is safe in both the server
 * and the client bundle. The values are read per request in `config.server.ts`
 * and handed to the client as props.
 */

export type Cluster = "mainnet-beta" | "devnet" | "testnet";

/**
 * Platform fees, all optional and all zero by default. presetfun's own income
 * is meant to come from the same place a preset author's does — the partner
 * share of trading fees on configs it owns — not from tolls on every action.
 */
export type Fees = {
  /** Flat SOL charged when a coin is launched. */
  launchpadCreate: number;
  /** Percent of a curve buy, charged as a separate SOL transfer. */
  pumpTradePct: number;
  /** Flat SOL charged when claiming fees. */
  liquidityClaim: number;
};

export type AppConfig = {
  cluster: Cluster;
  rpcUrl: string;
  /** Where platform fees go, or null when none are charged. */
  feeWallet: string | null;
  fees: Fees;
  /** Features that cannot work on this deployment, with the reason shown. */
  unavailable: Partial<Record<Feature, string>>;
};

export type Feature = "dbc" | "uploads" | "presets";

/** What the browser is allowed to know: everything except the keyed RPC URL. */
export type PublicConfig = Omit<AppConfig, "rpcUrl">;

export function toPublicConfig(config: AppConfig): PublicConfig {
  const { rpcUrl: _rpcUrl, ...rest } = config;
  return rest;
}

/** Where the browser sends JSON-RPC. Absolute, because `Connection` demands it. */
export const RPC_PROXY_PATH = "/api/rpc";

/** Solscan links. Solscan takes ?cluster= for anything other than mainnet. */
export function explorerUrl(
  cluster: Cluster,
  kind: "tx" | "token" | "account",
  value: string,
): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://solscan.io/${kind}/${value}${suffix}`;
}
