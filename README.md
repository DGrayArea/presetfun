# presetfun

**Design a Meteora Dynamic Bonding Curve visually, launch a coin on it, or publish it as a preset that pays you the partner fee on every launch.**

Built for the Colosseum Crypto World's Fair hackathon (Meteora DBC sidetrack).

## Why

Meteora's [Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc) lets a launch carry its own curve, fee schedule and migration. Almost every launchpad on top of it still ships one fixed curve. presetfun makes the curve itself the product:

1. **Curve Studio** — choose a shape, set the caps and fees, and see the curve the program will run before signing.
2. **Preset marketplace** — publish a curve as a reusable on-chain config; anyone can launch from it, and its author earns on every launch.

## Curve Studio

| Shape | What it does | Built with |
|---|---|---|
| Classic | One constant-product segment between the two market caps | `buildCurveWithMarketCap` |
| Wide base | Liquidity weighted to the start: price holds near the open, more supply sells cheaply, smaller raise | `buildCurveWithLiquidityWeights` |
| Steep start | Liquidity weighted to the end: price runs up through early buying, larger raise; by 10 SOL of buying it has handed out about half the supply a wide curve has | `buildCurveWithLiquidityWeights` |
| Two-step | Two segments with 5–50% of supply kept back to deepen the graduated pool | `buildCurveWithTwoSegments` |

Plus:
- **Anti-sniper launch fee** — exponential fee scheduler starting at 25 / 50 / 80% and decaying to the normal fee over 3–10 minutes.
- **Graduation** — migrates to **DAMM v2** with the fee tier you pick (0.25–4%), liquidity permanently locked.
- **Live preview** — market cap vs supply sold, SOL raised by graduation, and what the first 1 / 5 / 10 SOL of buying gets. The preview runs the same `buildConfig` the server uses to build the transaction, so the chart *is* the shipped curve (tested in `test/curveStudio.test.ts`).
- **Starter presets** for memes, community fair launches, real-world assets and stock-paired launches.
- **Buy simulator** — play a scenario (sniper vs crowd, whale at the open, fair crowd) against every shape at once with your caps and fees. It reports two things on purpose: how much of the *supply* the first buyer ends up holding (a steeper curve shrinks this) and their share of *everything bought* (the curve shape barely moves this; the anti-sniper fee does).

## Preset marketplace

A DBC config is an on-chain account that any number of pools can be opened against, and its `fee_claimer` collects the partner share of trading fees on all of them. So:

- **Publish** = create a config with *you* as fee claimer. Costs only rent.
- **Launch from a preset** = open a pool against that config. The launcher keeps the creator share; the author earns the partner share for the life of the coin.
- **Earnings** = every config you're fee claimer on (presets *and* your own studio launches), read from chain, claimable in one batch.

No new program: the marketplace is a listing, and the economics are Meteora's own partner fee. Listings can't be spoofed — a preset is only listed after its config lands on-chain, is checked against the published spec, and the publish request is keyed to a config address the server generated for that wallet.

Every preset has its own page at `/p/<config>` with the curve, its launch and graduation counts, the simulator, a one-click launch form and share buttons. Its social card draws the curve itself, so a preset link posted on X or Telegram shows what it does.

When you launch on **your own** curve from the studio, the config's fee claimer is you, so you keep both the creator and the partner share.

## Stack

Next.js 15 · React 19 · Tailwind 4 · `@meteora-ag/dynamic-bonding-curve-sdk` · Solana wallet adapter (+ Mobile Wallet Adapter) · Upstash Redis · Pinata (IPFS metadata)

```
src/lib/curveStudio.ts        spec → DBC config, curve sampling, starter presets
src/app/api/dbc/route.ts      launch on your own curve, trade, claim creator fees
src/app/api/dbc/presets/      publish / confirm / list / launch / earnings / claim
src/components/CurveStudio    the designer + live chart
src/components/PresetMarket   marketplace, launch-from-preset, author earnings
src/components/BuySimulator   scenario simulator across all shapes
src/app/p/[config]/           shareable preset page + generated social card
```

The browser never sees the RPC key: it talks to `/api/rpc`, a method-allowlisted, rate-limited proxy.

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill in RPC, Pinata, Upstash
pnpm dev
pnpm test                    # curve builder, sampling and simulator tests
```

### Seed the marketplace

Publishes the five starter presets through the site's own publish → confirm flow, signed by a local keypair (which becomes their fee claimer). Each costs the config account's rent plus network fees.

```bash
pnpm seed --url https://your-site.vercel.app --keypair ~/.config/solana/id.json --dry-run   # simulate only
pnpm seed --url https://your-site.vercel.app --keypair ~/.config/solana/id.json             # publish
```

`--only rwa-steady,meme-anti-snipe` limits it to some presets; `--rpc` sends through a keyed RPC. Re-running skips presets the wallet has already listed.

## License

MIT
