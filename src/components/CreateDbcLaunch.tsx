"use client";

import { useState } from "react";

import { useAppConfig } from "@/app/providers";
import { explorerUrl } from "@/lib/config";
import {
  Card,
  ConnectGate,
  DoneNote,
  ErrorNote,
  Field,
  Submit,
} from "@/components/ui";
import { useVenueAction } from "@/components/useVenueAction";
import { friendlyError } from "@/lib/friendlyError";
import { CurveStudio } from "@/components/CurveStudio";
import { PublishPreset } from "@/components/PublishPreset";
import { DEFAULT_SPEC, validateSpec, type CurveSpec } from "@/lib/curveStudio";

/**
 * Start a launch on Meteora's Dynamic Bonding Curve.
 *
 * The curve is designed in Curve Studio: priced in market caps rather than
 * reserves or sqrt prices, because that is how anyone launching a coin thinks
 * about it, with the shape and fee schedule on top. The same spec can be
 * published as a preset instead, for others to launch from.
 */

export function CreateDbcLaunch() {
  const { cluster, fees } = useAppConfig();
  const { run, busy, error, setError, signatures } = useVenueAction();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [spec, setSpec] = useState<CurveSpec>({ ...DEFAULT_SPEC });
  const [firstBuy, setFirstBuy] = useState("");

  const [uploading, setUploading] = useState(false);
  const [made, setMade] = useState<{ mint: string; threshold: string } | null>(null);

  const specProblem = validateSpec(spec);

  async function launch() {
    setError(null);
    setMade(null);
    if (!name.trim() || !symbol.trim()) return setError("Name and symbol are required.");
    if (!image) return setError("Upload a logo.");
    if (specProblem) return setError(specProblem);

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

    const res = await run("/api/dbc", {
      action: "create",
      name: name.trim(),
      symbol: symbol.trim(),
      uri,
      curve: spec,
      firstBuy: firstBuy.trim(),
    });
    if (res) {
      setMade({
        mint: res.mint as string,
        threshold: res.migrationQuoteThreshold as string,
      });
    }
  }

  return (
    // The studio works without a wallet, so anyone can design and compare
    // curves; only launching and publishing need one.
    <div className="space-y-4">
      <ErrorNote>{friendlyError(error)}</ErrorNote>
      <DoneNote message="Launch is live." signatures={signatures} />

      {made && (
        <Card>
          <p className="text-sm text-slate-300">Your coin</p>
          <a
            href={explorerUrl(cluster, "token", made.mint)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 block font-mono text-xs break-all text-accent underline underline-offset-2"
          >
            {made.mint}
          </a>
          <p className="mt-2 text-xs text-slate-500">
            It graduates into a real pool once {made.threshold} SOL has been bought on the curve.
            Paste the mint into Trade to buy, sell, or collect your share of the fees.
          </p>
        </Card>
      )}

      <CurveStudio spec={spec} onChange={setSpec} />

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={setName} placeholder="My Coin" mono={false} />
          <Field label="Symbol" value={symbol} onChange={setSymbol} placeholder="MYC" mono={false} />
        </div>
        <Field
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="What it is"
          mono={false}
        />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-200">Logo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Pinned to IPFS along with the token metadata.
          </span>
        </label>
      </Card>

      <Card className="space-y-4">
        <Field
          label="Your first buy, in SOL"
          hint="Optional, and bought in the same transaction as the launch. Leave empty to start with nothing."
          value={firstBuy}
          onChange={setFirstBuy}
        />

        <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-slate-400">
          Liquidity is permanently locked when the coin graduates — nobody, you included, can pull
          it. Signing happens twice: once to create the curve&rsquo;s config, once to open the pool.
        </p>

        <ConnectGate prompt="Connect a wallet to launch on this curve.">
          <Submit
            onClick={launch}
            busy={busy || uploading}
            disabled={!name.trim() || !symbol.trim() || !image || Boolean(specProblem)}
            label={uploading ? "Pinning metadata…" : "Launch"}
            feeSol={fees.launchpadCreate}
          />
        </ConnectGate>
      </Card>

      <ConnectGate prompt="Connect a wallet to publish this curve as a preset.">
        <PublishPreset spec={spec} />
      </ConnectGate>
    </div>
  );
}
