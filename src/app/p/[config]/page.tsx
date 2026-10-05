import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Header } from "@/components/Header";
import { PresetDetail } from "@/components/PresetDetail";
import { buildConfig, summarize } from "@/lib/curveStudio";
import { loadPreset, siteUrl } from "@/lib/presetPage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ config: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { config } = await params;
  const preset = await loadPreset(config);
  if (!preset) return { title: "Preset not found · presetfun" };

  const s = summarize(buildConfig(preset.spec));
  const title = `${preset.name} · presetfun`;
  const description =
    preset.description ||
    `A ${preset.assetClass} launch curve on Meteora: ${preset.spec.initialMarketCap} → ${preset.spec.migrationMarketCap} SOL, graduates at ${s.raiseSol.toFixed(0)} SOL raised.`;
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PresetPage({ params }: Props) {
  const { config } = await params;
  const preset = await loadPreset(config);
  if (!preset) notFound();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <a href="/#presets" className="text-sm text-slate-400 hover:text-slate-200">
          ← All presets
        </a>
        <PresetDetail preset={preset} shareUrl={`${siteUrl()}/p/${preset.config}`} />
      </main>
    </>
  );
}
