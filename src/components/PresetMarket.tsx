"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { useAppConfig } from "@/app/providers";
import { explorerUrl } from "@/lib/config";
import { Card, ConnectGate, DoneNote, ErrorNote, Field, Submit } from "@/components/ui";
import { useVenueAction } from "@/components/useVenueAction";
import { CurveChart } from "@/components/CurveChart";
import { useCurvePreview } from "@/components/CurveStudio";
import { friendlyError } from "@/lib/friendlyError";
import type { CurveSpec } from "@/lib/curveStudio";

/**
 * Browse published Curve Studio presets, launch a coin from one, and — for
 * authors — collect what their presets have earned.
 */

type Preset = {
  config: string;
  author: string;
  name: string;
  description: string;
  assetClass: string;
  spec: CurveSpec;
  createdAt: number;
  stats: { launches: number; graduated: number; volumeSol: number } | null;
};

type Earnings = {
  presets: { config: string; name: string; launches: number; unclaimedSol: string }[];
  unclaimedSol: string;
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function PresetMarket() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [chosen, setChosen] = useState<Preset | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch("/api/dbc/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load presets.");
      setPresets(j.presets as Preset[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load presets.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const classes = useMemo(
    () => ["All", ...Array.from(new Set((presets ?? []).map((p) => p.assetClass)))],
    [presets],
  );
  const shown = (presets ?? []).filter((p) => filter === "All" || p.assetClass === filter);

  if (chosen) return <LaunchFromPreset preset={chosen} onBack={() => setChosen(null)} />;

  return (
    <div className="space-y-4">
      <AuthorEarnings />

      <ErrorNote>{loadError}</ErrorNote>

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {classes.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${
                filter === c ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {presets === null && !loadError && (
        <div className="h-48 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
      )}

      {presets?.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">
            No presets yet. Design a curve under <span className="text-slate-200">Start a launch</span>{" "}
            and publish it — you will be the first.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((p) => (
          <PresetCard key={p.config} preset={p} onLaunch={() => setChosen(p)} />
        ))}
      </div>
    </div>
  );
}

function PresetCard({ preset, onLaunch }: { preset: Preset; onLaunch: () => void }) {
  const { cluster } = useAppConfig();
  const preview = useCurvePreview(preset.spec);
  const s = preset.stats;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{preset.name}</h3>
          <a
            href={explorerUrl(cluster, "account", preset.author)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[11px] text-slate-500 hover:text-slate-300"
          >
            by {short(preset.author)}
          </a>
        </div>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
          {preset.assetClass}
        </span>
      </div>
      {preset.description && <p className="text-xs leading-relaxed text-slate-400">{preset.description}</p>}
      {preview.points && <CurveChart points={preview.points} compact />}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Raise" value={preview.summary ? `${preview.summary.raiseSol.toFixed(0)} SOL` : "—"} />
        <Mini label="Launches" value={s ? String(s.launches) : "—"} />
        <Mini label="Graduated" value={s ? String(s.graduated) : "—"} />
      </dl>
      <button
        onClick={onLaunch}
        className="mt-auto rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
      >
        Launch with this preset
      </button>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className="font-mono text-xs text-slate-200">{value}</dd>
    </div>
  );
}

function LaunchFromPreset({ preset, onBack }: { preset: Preset; onBack: () => void }) {
  const { cluster, fees } = useAppConfig();
  const { run, busy, error, setError, signatures } = useVenueAction();
  const preview = useCurvePreview(preset.spec);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [firstBuy, setFirstBuy] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mint, setMint] = useState<string | null>(null);

  async function launch() {
    setError(null);
    setMint(null);
    if (!name.trim() || !symbol.trim()) return setError("Name and symbol are required.");
    if (!image) return setError("Upload a logo.");

    let uri: string;
    try {
      setUploading(true);
      const form = new FormData();
      form.append("image", image);
      form.append("name", name.trim());
      form.append("symbol", symbol.trim());
      form.append("description", description.trim());
      const up = await fetch("/api/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!up.ok || !upJson.metadataUri) throw new Error(upJson.error || "Upload failed.");
      uri = upJson.metadataUri;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pin the logo and metadata.");
      return;
    } finally {
      setUploading(false);
    }

    const res = await run("/api/dbc/presets", {
      action: "launch",
      config: preset.config,
      name: name.trim(),
      symbol: symbol.trim(),
      uri,
      firstBuy: firstBuy.trim(),
    });
    if (res?.mint) setMint(res.mint as string);
  }

  return (
    <ConnectGate prompt="Connect a wallet to launch from this preset.">
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-slate-200">
          ← All presets
        </button>
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">{preset.name}</h3>
            <span className="font-mono text-[11px] text-slate-500">by {short(preset.author)}</span>
          </div>
          {preview.points && <CurveChart points={preview.points} />}
          <p className="text-xs leading-relaxed text-slate-500">
            The curve, fees and graduation are fixed by the preset. The preset&rsquo;s author earns the
            partner share of this coin&rsquo;s swap fees; you keep the creator share (
            {preset.spec.creatorFeePct}%).
          </p>
        </Card>

        <ErrorNote>{friendlyError(error)}</ErrorNote>
        <DoneNote message="Launch is live." signatures={signatures} />
        {mint && (
          <Card>
            <p className="text-sm text-slate-300">Your coin</p>
            <a
              href={explorerUrl(cluster, "token", mint)}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 block font-mono text-xs break-all text-accent underline underline-offset-2"
            >
              {mint}
            </a>
          </Card>
        )}

        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} placeholder="My Coin" mono={false} />
            <Field label="Symbol" value={symbol} onChange={setSymbol} placeholder="MYC" mono={false} />
          </div>
          <Field label="Description" value={description} onChange={setDescription} placeholder="What it is" mono={false} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-200">Logo</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
            />
          </label>
          <Field
            label="Your first buy, in SOL"
            hint="Optional, bought in the same transaction as the launch."
            value={firstBuy}
            onChange={setFirstBuy}
          />
          <Submit
            onClick={launch}
            busy={busy || uploading}
            disabled={!name.trim() || !symbol.trim() || !image}
            label={uploading ? "Pinning metadata…" : "Launch"}
            feeSol={fees.launchpadCreate}
          />
        </Card>
      </div>
    </ConnectGate>
  );
}

/**
 * Shown to a connected wallet that is fee claimer on any config: its published
 * presets and the configs behind its own studio launches.
 */
function AuthorEarnings() {
  const { connected, publicKey } = useWallet();
  const { fees } = useAppConfig();
  const { run, call, busy, error, signatures } = useVenueAction();
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return setEarnings(null);
    try {
      setEarnings((await call("/api/dbc/presets", { action: "earnings" })) as unknown as Earnings);
    } catch {
      setEarnings(null);
    }
  }, [call, publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!connected || !earnings || earnings.presets.length === 0) return null;
  const owed = Number(earnings.unclaimedSol);

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">Your partner-fee earnings</h3>
        <span className="font-mono text-sm text-slate-200">{owed.toFixed(4)} SOL unclaimed</span>
      </div>
      <ul className="space-y-1 text-xs text-slate-400">
        {earnings.presets.map((p) => (
          <li key={p.config} className="flex justify-between gap-2">
            <span>{p.name}</span>
            <span className="font-mono">
              {p.launches} launch{p.launches === 1 ? "" : "es"} · {Number(p.unclaimedSol).toFixed(4)} SOL
            </span>
          </li>
        ))}
      </ul>
      <ErrorNote>{friendlyError(error)}</ErrorNote>
      <DoneNote message="Claimed." signatures={signatures} />
      {owed > fees.liquidityClaim && (
        <Submit
          onClick={async () => {
            if (await run("/api/dbc/presets", { action: "claim" })) refresh();
          }}
          busy={busy}
          label="Claim earnings"
          feeSol={fees.liquidityClaim}
        />
      )}
    </Card>
  );
}
