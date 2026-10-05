import { ImageResponse } from "next/og";

import { buildConfig, sampleCurve, summarize } from "@/lib/curveStudio";
import { loadPreset } from "@/lib/presetPage";

/**
 * The card X and Telegram show when a preset link is posted: the curve itself,
 * drawn from the same samples as the studio chart, with the numbers a
 * launcher would ask about first.
 */

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "presetfun bonding curve preset";

const ACCENT = "#6d4aff";
const GROUND = "#090b0f";

export default async function Image({ params }: { params: Promise<{ config: string }> }) {
  const { config } = await params;
  const preset = await loadPreset(config);

  if (!preset) {
    return new ImageResponse(
      (
        <div style={{ display: "flex", width: "100%", height: "100%", background: GROUND, color: "white", alignItems: "center", justifyContent: "center", fontSize: 64 }}>
          presetfun
        </div>
      ),
      size,
    );
  }

  const built = buildConfig(preset.spec);
  const points = sampleCurve(built, 64);
  const s = summarize(built, points);

  // Chart box inside the card.
  const W = 620;
  const H = 290;
  const xMax = Math.max(...points.map((p) => p.soldPct)) || 100;
  const yMax = Math.max(...points.map((p) => p.marketCapSol)) * 1.05 || 1;
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${((p.soldPct / xMax) * W).toFixed(1)},${(H - (p.marketCapSol / yMax) * H).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${W},${H} L0,${H} Z`;
  const end = points[points.length - 1];

  const stats: [string, string][] = [
    ["Opens → graduates", `${preset.spec.initialMarketCap} → ${preset.spec.migrationMarketCap} SOL`],
    ["Raise to graduate", `${s.raiseSol.toFixed(0)} SOL`],
    ["Supply sold by then", `${s.soldAtGraduationPct.toFixed(0)}%`],
    [
      "Launch fee",
      preset.spec.antiSniper
        ? `${preset.spec.antiSniper.startFeeBps / 100}% → ${preset.spec.feeBps / 100}%`
        : `${preset.spec.feeBps / 100}% flat`,
    ],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: GROUND,
          color: "white",
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
            <div style={{ display: "flex", width: 44, height: 44, borderRadius: 10, background: ACCENT }} />
            presetfun
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#cbd5e1",
              background: "rgba(255,255,255,0.08)",
              padding: "8px 16px",
              borderRadius: 8,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            {preset.assetClass}
          </div>
        </div>

        <div style={{ display: "flex", flexShrink: 0, marginTop: 22, fontSize: 56, fontWeight: 800, lineHeight: 1.15 }}>
          {preset.name.slice(0, 40)}
        </div>
        <div style={{ display: "flex", flexShrink: 0, marginTop: 6, fontSize: 24, color: "#94a3b8" }}>
          A Meteora bonding curve. Launch a coin on it in one click.
        </div>

        <div style={{ display: "flex", flexShrink: 0, marginTop: 28, gap: 48 }}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <path d={area} fill={ACCENT} fillOpacity={0.18} />
            <path d={path} fill="none" stroke={ACCENT} strokeWidth={6} strokeLinecap="round" />
            <circle cx={(end.soldPct / xMax) * W} cy={H - (end.marketCapSol / yMax) * H} r={10} fill="white" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
            {stats.map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 20, color: "#64748b" }}>{label}</div>
                <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
