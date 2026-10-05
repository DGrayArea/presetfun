/**
 * Publish the starter presets to a running presetfun deployment.
 *
 *   pnpm seed --url https://your-site.vercel.app --keypair ~/.config/solana/id.json --dry-run
 *   pnpm seed --url https://your-site.vercel.app --keypair ~/.config/solana/id.json
 *
 * It goes through the site's own API rather than writing to Redis directly,
 * so a seeded preset passes exactly the checks a user-published one does: the
 * server builds the config, the wallet signs, and the listing only appears once
 * the config is on-chain and matches the spec.
 *
 * The keypair is read locally and used only to sign; it never leaves this
 * machine. Each preset costs the config account's rent (a few thousandths of
 * a SOL) plus network fees, paid by the keypair, which also becomes each
 * preset's fee claimer.
 *
 * Flags:
 *   --url        base URL of the deployment (required)
 *   --keypair    path to a Solana keypair JSON (required)
 *   --rpc        RPC to send through (default: public mainnet; a keyed one is
 *                more reliable)
 *   --only       comma-separated starter preset ids, e.g. rwa-steady,meme-classic
 *   --dry-run    build and simulate every transaction, send nothing
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { Connection, Keypair, Transaction, clusterApiUrl } from "@solana/web3.js";

import { STARTER_PRESETS } from "../src/lib/curveStudio";

type Args = { url: string; keypair: string; rpc: string; only: string[] | null; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = get("--url")?.replace(/\/$/, "");
  const keypair = get("--keypair")?.replace(/^~(?=\/)/, homedir());
  if (!url || !keypair) {
    console.error("Usage: pnpm seed --url <site> --keypair <path> [--rpc <url>] [--only a,b] [--dry-run]");
    process.exit(1);
  }
  return {
    url,
    keypair,
    rpc: get("--rpc") ?? clusterApiUrl("mainnet-beta"),
    only: get("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    dryRun: argv.includes("--dry-run"),
  };
}

/** What each starter preset is listed as. Names and copy are the marketplace's first impression. */
const LISTING: Record<string, { name: string; description: string; assetClass: string }> = {
  "meme-classic": {
    name: "Classic meme",
    description: "The familiar pump-style curve: 30 → 500 SOL, 1% fee. A sensible default when you just want to launch.",
    assetClass: "Meme",
  },
  "meme-anti-snipe": {
    name: "Snipe-resistant meme",
    description:
      "Steep opening plus a 50% launch fee that decays to 1% over five minutes. A bot buying at the open pays half its SOL in fees and ends up holding far less of the supply.",
    assetClass: "Meme",
  },
  "community-fair": {
    name: "Community fair launch",
    description:
      "A wide, flat base (20 → 300 SOL): most of the supply sells near the opening price, so it spreads across many holders.",
    assetClass: "Community",
  },
  "rwa-steady": {
    name: "Real-world asset",
    description:
      "Valuation-first (500 → 5,000 SOL) with a 0.5% fee, keeping a quarter of the supply back to deepen the graduated pool. For tokenised property and other RWAs.",
    assetClass: "RWA",
  },
  "stock-paired": {
    name: "Stock-paired",
    description:
      "A narrow 2× range around a reference valuation, 0.3% fee and a 1% graduated pool, for names that already have a price.",
    assetClass: "Equity",
  },
};

async function api(url: string, body: Record<string, unknown>) {
  const res = await fetch(`${url}/api/dbc/presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(args.keypair, "utf8"))));
  const owner = wallet.publicKey.toBase58();
  const connection = new Connection(args.rpc, "confirmed");

  const presets = STARTER_PRESETS.filter((p) => !args.only || args.only.includes(p.id));
  if (presets.length === 0) throw new Error("No starter presets match --only.");

  // Skip anything this wallet has already listed under the same name, so the
  // script is safe to re-run after a partial failure.
  const listed = (await api(args.url, { action: "list" })).presets as { author: string; name: string }[];
  const mine = new Set(listed.filter((p) => p.author === owner).map((p) => p.name));

  const balance = (await connection.getBalance(wallet.publicKey)) / 1e9;
  console.log(`Wallet ${owner} · ${balance.toFixed(4)} SOL · ${args.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Site   ${args.url}\n`);

  let published = 0;
  for (const preset of presets) {
    const listing = LISTING[preset.id] ?? { name: preset.name, description: preset.blurb, assetClass: preset.assetClass };
    if (mine.has(listing.name)) {
      console.log(`· ${listing.name}: already listed by this wallet, skipping`);
      continue;
    }

    const res = await api(args.url, {
      action: "publish",
      owner,
      curve: preset.spec,
      ...listing,
    });
    const config = String(res.config);
    const [raw] = res.transactions as string[];
    const tx = Transaction.from(Buffer.from(raw, "base64"));
    // The server has already partial-signed with the new config's keypair.
    tx.partialSign(wallet);

    if (args.dryRun) {
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.log(`✗ ${listing.name}: simulation failed`, sim.value.err, sim.value.logs?.slice(-5));
      } else {
        console.log(`✓ ${listing.name}: simulates cleanly (${sim.value.unitsConsumed ?? "?"} CU), config would be ${config}`);
      }
      continue;
    }

    const signature = await connection.sendRawTransaction(tx.serialize());
    const conf = await connection.confirmTransaction(
      { signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: Number(res.lastValidBlockHeight) },
      "confirmed",
    );
    if (conf.value.err) {
      console.log(`✗ ${listing.name}: transaction failed`, conf.value.err, signature);
      continue;
    }

    // List it once the config is readable on-chain.
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      try {
        await api(args.url, { action: "confirm", owner, config });
        ok = true;
      } catch (err) {
        if (!/not landed/i.test(String(err))) throw err;
        await sleep(2_000);
      }
    }
    console.log(
      ok
        ? `✓ ${listing.name}: ${args.url}/p/${config}`
        : `! ${listing.name}: config ${config} landed (${signature}) but listing timed out; run again to retry`,
    );
    if (ok) published++;
  }

  if (!args.dryRun) {
    const after = (await connection.getBalance(wallet.publicKey)) / 1e9;
    console.log(`\nPublished ${published}. Spent ${(balance - after).toFixed(4)} SOL.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
