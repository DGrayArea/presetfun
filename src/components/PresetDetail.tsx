"use client";

import { useState } from "react";

import { useAppConfig } from "@/app/providers";
import { BuySimulator } from "@/components/BuySimulator";
import { CurveChart } from "@/components/CurveChart";
import { useCurvePreview } from "@/components/CurveStudio";
import { LaunchFromPreset, type Preset } from "@/components/PresetMarket";
import { Card } from "@/components/ui";
import { explorerUrl } from "@/lib/config";

/**
 * A preset's own page: what the curve does, how it has been used, a way to
 * share it, and the launch form. This is the link an author posts.
 */

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function PresetDetail({ preset, shareUrl }: { preset: Preset; shareUrl: string }) {
  const { cluster } = useAppConfig();
  const preview = useCurvePreview(preset.spec);
  const [copied, setCopied] = useState(false);
  const s = preview.summary;
  const spec = preset.spec;

  const tweet = `Launch on my "${preset.name}" bonding curve on Meteora: ${shareUrl}`;

  return (
    <div className="mt-4 space-y-4">
      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{preset.name}</h1>
            <a
              href={explorerUrl(cluster, "account", preset.author)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-slate-500 hover:text-slate-300"
            >
              by {short(preset.author)}
            </a>
          </div>
          <span className="rounded bg-white/5 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-400">
            {preset.assetClass}
          </span>
        </div>
        {preset.description && <p className="text-sm leading-relaxed text-slate-300">{preset.description}</p>}

        {preview.points && <CurveChart points={preview.points} />}

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Opens → graduates" value={`${spec.initialMarketCap} → ${spec.migrationMarketCap} SOL`} />
          <Stat label="Raise to graduate" value={s ? `${s.raiseSol.toFixed(1)} SOL` : "—"} />
          <Stat label="Swap fee" value={`${spec.feeBps / 100}%`} />
          <Stat
            label="Launch fee"
            value={spec.antiSniper ? `${spec.antiSniper.startFeeBps / 100}% → ${spec.antiSniper.minutes}m` : "Off"}
          />
          <Stat label="Creator share" value={`${spec.creatorFeePct}%`} />
          <Stat label="Graduated pool fee" value={`${spec.migratedFeeBps / 100}%`} />
          <Stat label="Launches" value={preset.stats ? String(preset.stats.launches) : "—"} />
          <Stat label="Graduated" value={preset.stats ? String(preset.stats.graduated) : "—"} />
        </dl>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1_500);
            }}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm transition hover:bg-white/5"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm transition hover:bg-white/5"
          >
            Post on X
          </a>
          <a
            href={explorerUrl(cluster, "account", preset.config)}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5"
          >
            Config on Solscan
          </a>
        </div>
      </Card>

      <BuySimulator spec={spec} fixed />

      <LaunchFromPreset preset={preset} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-slate-200">{value}</dd>
    </div>
  );
}
