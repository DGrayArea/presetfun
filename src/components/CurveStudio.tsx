"use client";

import { useMemo } from "react";

import { Card, Choice, Field } from "@/components/ui";
import { CurveChart } from "@/components/CurveChart";
import {
  DEFAULT_SPEC,
  STARTER_PRESETS,
  buildConfig,
  sampleCurve,
  summarize,
  validateSpec,
  type CurveShape,
  type CurveSpec,
  type MigratedFeeBps,
} from "@/lib/curveStudio";

/**
 * The curve designer: pick a shape, set the caps and fees, and see the curve
 * the program will actually run before anything is signed.
 *
 * The preview is built with the same `buildConfig` the server uses, so the
 * chart and the numbers under it are the shipped curve, not an approximation.
 */

const SHAPES: { value: CurveShape; label: string; hint: string }[] = [
  {
    value: "classic",
    label: "Classic",
    hint: "One smooth curve between the two caps. The pump-style default.",
  },
  {
    value: "wideBase",
    label: "Wide base",
    hint: "Price holds near the open for most of the supply, so it spreads across many buyers. Raises less.",
  },
  {
    value: "steepStart",
    label: "Steep start",
    hint: "Price runs up through early buying and flattens near graduation. Large early buys get less; raises more.",
  },
  {
    value: "twoStep",
    label: "Two-step",
    hint: "Two segments, with a share of the supply kept back to deepen the pool it graduates into.",
  },
];

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtSol(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

export function useCurvePreview(spec: CurveSpec) {
  return useMemo(() => {
    const problem = validateSpec(spec);
    if (problem) return { problem, points: null, summary: null };
    try {
      const config = buildConfig(spec);
      const points = sampleCurve(config);
      return { problem: null, points, summary: summarize(config, points) };
    } catch (err) {
      return {
        problem: err instanceof Error ? err.message : "This curve cannot be built.",
        points: null,
        summary: null,
      };
    }
  }, [spec]);
}

export function CurveStudio({
  spec,
  onChange,
}: {
  spec: CurveSpec;
  onChange: (next: CurveSpec) => void;
}) {
  const set = (patch: Partial<CurveSpec>) => onChange({ ...spec, ...patch });
  const preview = useCurvePreview(spec);

  // The classic curve between the same caps, drawn behind for comparison.
  const classic = useMemo(() => {
    if (spec.shape === "classic" || validateSpec({ ...spec, shape: "classic" })) return undefined;
    try {
      return sampleCurve(buildConfig({ ...spec, shape: "classic", antiSniper: null }));
    } catch {
      return undefined;
    }
  }, [spec]);

  const shape = SHAPES.find((s) => s.value === spec.shape)!;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-200">Start from</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange({ ...p.spec })}
                className="rounded-lg border border-white/10 px-3 py-2 text-left transition hover:bg-white/5"
              >
                <span className="flex items-center justify-between gap-2 text-sm text-slate-200">
                  {p.name}
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {p.assetClass}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{p.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <Choice
          label="Curve shape"
          hint={shape.hint}
          value={spec.shape}
          options={SHAPES.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(shape) => set({ shape })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Opening market cap (SOL)"
            value={String(spec.initialMarketCap)}
            onChange={(v) => set({ initialMarketCap: num(v, 0) })}
          />
          <Field
            label="Graduation market cap (SOL)"
            value={String(spec.migrationMarketCap)}
            onChange={(v) => set({ migrationMarketCap: num(v, 0) })}
          />
        </div>

        {(spec.shape === "wideBase" || spec.shape === "steepStart") && (
          <label className="block">
            <span className="mb-1.5 flex justify-between text-sm font-medium text-slate-200">
              Intensity <span className="font-mono text-slate-400">{spec.intensity ?? 50}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={spec.intensity ?? 50}
              onChange={(e) => set({ intensity: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
            />
            <span className="mt-1 block text-xs text-slate-500">
              0 is an even spread (the classic curve). Higher leans the curve harder.
            </span>
          </label>
        )}

        {spec.shape === "twoStep" && (
          <label className="block">
            <span className="mb-1.5 flex justify-between text-sm font-medium text-slate-200">
              Supply kept for the graduated pool
              <span className="font-mono text-slate-400">{spec.supplyAtMigrationPct ?? 20}%</span>
            </span>
            <input
              type="range"
              min={5}
              max={50}
              value={spec.supplyAtMigrationPct ?? 20}
              onChange={(e) => set({ supplyAtMigrationPct: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
            />
          </label>
        )}
      </Card>

      <Card className="space-y-4">
        {preview.problem || !preview.points || !preview.summary ? (
          <p className="text-sm text-amber-300">{preview.problem}</p>
        ) : (
          <>
            <CurveChart points={preview.points} compare={classic} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Raise to graduate" value={`${fmtSol(preview.summary.raiseSol)} SOL`} />
              <Stat
                label="Supply sold by then"
                value={`${preview.summary.soldAtGraduationPct.toFixed(1)}%`}
              />
              {preview.summary.firstBuys.slice(0, 2).map((b) => (
                <Stat
                  key={b.sol}
                  label={`First ${b.sol} SOL buys`}
                  value={`${b.supplyPct.toFixed(1)}% of supply`}
                />
              ))}
            </dl>
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <Choice
          label="Swap fee"
          hint="Paid by traders on every buy and sell while the coin is on the curve."
          value={spec.feeBps}
          options={[
            { value: 30, label: "0.3%" },
            { value: 50, label: "0.5%" },
            { value: 100, label: "1%" },
            { value: 200, label: "2%" },
            { value: 500, label: "5%" },
          ]}
          onChange={(feeBps) =>
            set({
              feeBps,
              // Keep a launch fee meaningful if the normal fee moves above it.
              antiSniper:
                spec.antiSniper && spec.antiSniper.startFeeBps <= feeBps
                  ? { ...spec.antiSniper, startFeeBps: Math.min(9_900, feeBps * 10) }
                  : spec.antiSniper,
            })
          }
        />

        <Choice
          label="Launch fee (anti-sniper)"
          hint={
            spec.antiSniper
              ? `Starts at ${spec.antiSniper.startFeeBps / 100}% and decays to ${spec.feeBps / 100}% over ${spec.antiSniper.minutes} minutes, so a bot buying in the first seconds pays most of it.`
              : "Off: the normal fee applies from the first trade."
          }
          value={spec.antiSniper ? `${spec.antiSniper.startFeeBps}/${spec.antiSniper.minutes}` : "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "2500/3", label: "25% → 3 min" },
            { value: "5000/5", label: "50% → 5 min" },
            { value: "8000/10", label: "80% → 10 min" },
          ]}
          onChange={(v) => {
            if (v === "off") return set({ antiSniper: null });
            const [startFeeBps, minutes] = v.split("/").map(Number);
            set({ antiSniper: { startFeeBps, minutes } });
          }}
        />

        <Field
          label="Creator's share of the swap fee (%)"
          hint="The rest is the partner share: yours too when you launch on your own curve, or the author's when you launch from someone's preset."
          value={String(spec.creatorFeePct)}
          onChange={(v) => set({ creatorFeePct: num(v, DEFAULT_SPEC.creatorFeePct) })}
        />

        <Choice
          label="Fee on the graduated pool"
          hint="The coin moves into a Meteora DAMM v2 pool at graduation, with its liquidity permanently locked."
          value={spec.migratedFeeBps}
          options={[
            { value: 25 as MigratedFeeBps, label: "0.25%" },
            { value: 100 as MigratedFeeBps, label: "1%" },
            { value: 200 as MigratedFeeBps, label: "2%" },
            { value: 400 as MigratedFeeBps, label: "4%" },
          ]}
          onChange={(migratedFeeBps) => set({ migratedFeeBps })}
        />
      </Card>
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
