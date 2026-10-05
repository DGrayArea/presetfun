"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui";
import {
  SCENARIOS,
  buildConfig,
  sampleCurve,
  simulateBuys,
  validateSpec,
  type CurveShape,
  type CurveSpec,
} from "@/lib/curveStudio";

/**
 * Play a scenario against every curve shape at once, with the caps and fees
 * currently set in the studio, so the trade-off between shapes is something
 * you can read off rather than take on trust.
 *
 * Two measures on purpose, because they answer different questions:
 * - "holds of supply" — how much of the token the first buyer ends up with.
 *   A steep start shrinks this, since less supply sells before graduation.
 * - "of all bought" — the first buyer's share of everything sold in the
 *   scenario. The curve shape barely moves this; the launch fee is what does,
 *   because it takes a slice of the sniper's SOL before it reaches the curve.
 */

const SHAPES: { value: CurveShape; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "wideBase", label: "Wide base" },
  { value: "steepStart", label: "Steep start" },
  { value: "twoStep", label: "Two-step" },
];

type Row = {
  shape: CurveShape;
  label: string;
  firstHolds: number;
  firstOfBought: number;
  othersEach: number;
  firstFeeSol: number;
  unfilled: number;
};

export function BuySimulator({ spec, fixed = false }: { spec: CurveSpec; fixed?: boolean }) {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  const rows = useMemo<Row[] | null>(() => {
    if (validateSpec(spec)) return null;
    try {
      return SHAPES.map(({ value, label }) => {
        const shaped: CurveSpec = { ...spec, shape: value };
        const fills = simulateBuys(shaped, scenario.buys, sampleCurve(buildConfig(shaped)));
        const [first, ...rest] = fills;
        const filled = rest.filter((f) => f.filled);
        const bought = fills.reduce((s, f) => s + f.supplyPct, 0);
        return {
          shape: value,
          label,
          firstHolds: first.supplyPct,
          firstOfBought: bought > 0 ? (first.supplyPct / bought) * 100 : 0,
          othersEach: filled.length ? filled.reduce((s, f) => s + f.supplyPct, 0) / filled.length : 0,
          firstFeeSol: first.feeSol,
          unfilled: rest.length - filled.length,
        };
      });
    } catch {
      return null;
    }
  }, [spec, scenario]);

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Buy simulator</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Play a scenario against every shape, with {fixed ? "this preset's" : "your"} caps and fees.{" "}
          {spec.antiSniper
            ? `The ${spec.antiSniper.startFeeBps / 100}% launch fee is applied by each buy's time.`
            : fixed
              ? "This preset has no launch fee, so the first buyer pays the normal fee."
              : "Turn on a launch fee above to see what it does to the first buyer."}
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScenarioId(s.id)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              s.id === scenarioId ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">{scenario.blurb}</p>

      {rows ? (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-1 py-1.5 font-medium">Shape</th>
                <th className="px-1 py-1.5 font-medium">First buyer holds</th>
                <th className="px-1 py-1.5 font-medium">…of all bought</th>
                <th className="px-1 py-1.5 font-medium">Each later buyer</th>
                <th className="px-1 py-1.5 font-medium">First buyer&rsquo;s fee</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r) => (
                <tr
                  key={r.shape}
                  className={`border-t border-white/5 ${
                    r.shape === spec.shape ? "text-accent" : "text-slate-300"
                  }`}
                >
                  <td className="px-1 py-1.5 font-sans">
                    {r.label}
                    {r.shape === spec.shape && <span className="ml-1 text-[10px]">({fixed ? "this preset" : "yours"})</span>}
                  </td>
                  <td className="px-1 py-1.5">{r.firstHolds.toFixed(1)}%</td>
                  <td className="px-1 py-1.5">{r.firstOfBought.toFixed(0)}%</td>
                  <td className="px-1 py-1.5">
                    {r.othersEach.toFixed(2)}%
                    {r.unfilled > 0 && (
                      <span className="ml-1 font-sans text-[10px] text-amber-300">
                        {r.unfilled} missed (graduated)
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1.5">{r.firstFeeSol.toFixed(2)} SOL</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-amber-300">Fix the curve settings above to run the simulator.</p>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        &ldquo;Holds&rdquo; is share of total supply; &ldquo;of all bought&rdquo; is share of everything sold in
        this scenario. A steeper curve shrinks the first; only the launch fee really moves the
        second. Before Meteora&rsquo;s volatility fee, so real fees on a busy curve run a little higher.
      </p>
    </Card>
  );
}
