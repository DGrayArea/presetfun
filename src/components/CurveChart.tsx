"use client";

import { useMemo, useState } from "react";

import type { CurvePoint } from "@/lib/curveStudio";

/**
 * Market cap against supply sold, from the open to graduation.
 *
 * Plain SVG rather than a chart library: it is one line (two, with the
 * comparison) and pulling a charting package into the launch page for that
 * would cost more than it draws. Hover reads the curve at the pointer, which
 * is the question a launcher actually asks of it — "if this much has sold,
 * what is it worth and how much has been raised?"
 */

const PAD = { top: 16, right: 16, bottom: 34, left: 62 };

function fmt(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function CurveChart({
  points,
  compare,
  compareLabel = "Classic",
  compact = false,
}: {
  points: CurvePoint[];
  /** A second curve drawn faintly behind, for comparison. */
  compare?: CurvePoint[];
  compareLabel?: string;
  /** Card-sized: a narrower canvas (so labels stay legible) and no legend. */
  compact?: boolean;
}) {
  const W = compact ? 400 : 640;
  const H = compact ? 200 : 260;
  const [hover, setHover] = useState<CurvePoint | null>(null);

  const { xMax, yMax, path, comparePath, x, y } = useMemo(() => {
    const all = compare ? [...points, ...compare] : points;
    const xMax = Math.min(100, Math.max(...all.map((p) => p.soldPct)) * 1.05 || 100);
    const yMax = Math.max(...all.map((p) => p.marketCapSol)) * 1.08 || 1;
    const x = (v: number) => PAD.left + (v / xMax) * (W - PAD.left - PAD.right);
    const y = (v: number) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
    const line = (ps: CurvePoint[]) =>
      ps.map((p, i) => `${i ? "L" : "M"}${x(p.soldPct).toFixed(1)},${y(p.marketCapSol).toFixed(1)}`).join("");
    return { xMax, yMax, path: line(points), comparePath: compare ? line(compare) : null, x, y };
  }, [points, compare, W, H]);

  const end = points[points.length - 1];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const sold = ((px - PAD.left) / (W - PAD.left - PAD.right)) * xMax;
    if (sold < 0 || sold > end.soldPct) return setHover(null);
    // Points are dense enough that the nearest one reads the curve well.
    let best = points[0];
    for (const p of points) if (Math.abs(p.soldPct - sold) < Math.abs(best.soldPct - sold)) best = p;
    setHover(best);
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * xMax);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Bonding curve: market cap rises from ${fmt(points[0].marketCapSol)} to ${fmt(end.marketCapSol)} SOL as ${end.soldPct.toFixed(0)}% of supply sells`}
      >
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-white/5" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text
            key={`x${v}`}
            x={x(v)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            className="fill-slate-500 text-[11px]"
          >
            {v.toFixed(0)}%
          </text>
        ))}
        <text x={PAD.left} y={H - 4} className="fill-slate-500 text-[11px]">
          Supply sold →
        </text>
        <text
          x={12}
          y={H - PAD.bottom - 4}
          className="fill-slate-500 text-[11px]"
          transform={`rotate(-90 12 ${H - PAD.bottom - 4})`}
        >
          Market cap (SOL)
        </text>

        {comparePath && (
          <path d={comparePath} fill="none" strokeDasharray="4 4" strokeWidth={1.5} className="stroke-slate-500" />
        )}
        <path d={path} fill="none" strokeWidth={2.5} className="stroke-accent" />

        {/* Graduation */}
        <circle cx={x(end.soldPct)} cy={y(end.marketCapSol)} r={4} className="fill-accent" />

        {hover && (
          <g>
            <line
              x1={x(hover.soldPct)}
              x2={x(hover.soldPct)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-white/20"
            />
            <circle cx={x(hover.soldPct)} cy={y(hover.marketCapSol)} r={4} className="fill-white" />
          </g>
        )}
      </svg>

      {!compact && (
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-accent" /> This curve
          </span>
          {compare && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-4 border-t border-dashed border-slate-500" /> {compareLabel}
            </span>
          )}
        </span>
        <span className="font-mono text-slate-400">
          {hover
            ? `${hover.soldPct.toFixed(1)}% sold · ${fmt(hover.marketCapSol)} SOL cap · ${fmt(hover.raisedSol)} SOL raised`
            : "Hover the curve to read it"}
        </span>
      </div>
      )}
      {compact && hover && (
        <p className="mt-1 text-right font-mono text-[11px] text-slate-400">
          {hover.soldPct.toFixed(1)}% sold · {fmt(hover.marketCapSol)} SOL cap
        </p>
      )}
    </div>
  );
}
