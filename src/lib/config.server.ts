import { clusterApiUrl, PublicKey } from "@solana/web3.js";

import { redisConfigured } from "@/lib/redis";
import type { AppConfig, Cluster } from "./config";

/**
 * Reads config from the environment on the server, once per request. Not
 * `NEXT_PUBLIC_*`, so changing a value needs a restart rather than a rebuild.
 */

function envFloat(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? "");
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const VALID_CLUSTERS: Cluster[] = ["mainnet-beta", "devnet", "testnet"];

export function getAppConfig(): AppConfig {
  const rawCluster = process.env.SOLANA_CLUSTER?.trim() as Cluster | undefined;
  const cluster: Cluster =
    rawCluster && VALID_CLUSTERS.includes(rawCluster) ? rawCluster : "mainnet-beta";
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || clusterApiUrl(cluster);

  let feeWallet: string | null = null;
  const rawWallet = process.env.PLATFORM_FEE_WALLET?.trim();
  if (rawWallet) {
    try {
      feeWallet = new PublicKey(rawWallet).toBase58();
    } catch {
      console.warn("[config] PLATFORM_FEE_WALLET is not a valid address; charging no fees.");
    }
  }

  // With no fee wallet there is nowhere to send a fee, so none is shown either.
  const fees = feeWallet
    ? {
        launchpadCreate: envFloat(process.env.FEE_LAUNCH_SOL, 0),
        pumpTradePct: envFloat(process.env.FEE_TRADE_PCT, 0),
        liquidityClaim: envFloat(process.env.FEE_CLAIM_SOL, 0),
      }
    : { launchpadCreate: 0, pumpTradePct: 0, liquidityClaim: 0 };

  const unavailable: AppConfig["unavailable"] = {};
  if (cluster !== "mainnet-beta") {
    unavailable.dbc = "Meteora Dynamic Bonding Curve launches run on mainnet. This site is on a test network.";
  }
  if (!process.env.PINATA_JWT?.trim()) {
    unavailable.uploads = "Logo uploads aren't set up on this deployment yet, so launching is paused.";
  }
  if (!redisConfigured) {
    unavailable.presets = "The preset marketplace needs Redis, which isn't configured on this deployment.";
  }

  return { cluster, rpcUrl, feeWallet, fees, unavailable };
}
