"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { Card, Choice, DoneNote, ErrorNote, Field, Submit } from "@/components/ui";
import { useVenueAction } from "@/components/useVenueAction";
import { friendlyError } from "@/lib/friendlyError";
import { validateSpec, type CurveSpec } from "@/lib/curveStudio";

/**
 * Publish the curve on the page as a preset, instead of (or as well as)
 * launching a coin on it.
 *
 * Publishing creates a Meteora DBC config whose fee claimer is the author, so
 * every coin anyone launches from it pays the author the partner share of its
 * trading fees. After the config lands, a second call lists it — see
 * /api/dbc/presets for why that is two steps.
 */

const ASSET_CLASSES = ["Meme", "Community", "RWA", "Equity", "AI", "Other"];

/** The config usually lands well inside this; the listing call is retried until it does. */
const CONFIRM_ATTEMPTS = 6;

export function PublishPreset({ spec }: { spec: CurveSpec }) {
  const { publicKey } = useWallet();
  const { run, busy, error, setError, signatures } = useVenueAction();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assetClass, setAssetClass] = useState("Meme");
  const [listed, setListed] = useState<string | null>(null);
  const [listing, setListing] = useState(false);

  async function publish() {
    setError(null);
    setListed(null);
    const problem = validateSpec(spec);
    if (problem) return setError(problem);
    if (name.trim().length < 3) return setError("Give the preset a name of at least three characters.");

    const res = await run("/api/dbc/presets", {
      action: "publish",
      curve: spec,
      name: name.trim(),
      description: description.trim(),
      assetClass,
    });
    if (!res?.config) return;

    setListing(true);
    try {
      for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
        const r = await fetch("/api/dbc/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", owner: publicKey?.toBase58(), config: res.config }),
        });
        if (r.ok) {
          setListed(res.config as string);
          return;
        }
        const json = await r.json().catch(() => ({}));
        if (!/not landed/i.test(json.error ?? "")) throw new Error(json.error || "Listing failed.");
        await new Promise((ok) => setTimeout(ok, 2_000));
      }
      throw new Error("The config is on-chain but listing timed out. Open Presets and it will appear once it lands.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Listing failed.");
    } finally {
      setListing(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-white/15 px-4 py-3 text-left text-sm text-slate-400 transition hover:bg-white/5"
      >
        <span className="font-medium text-slate-200">Publish this curve as a preset</span>
        <span className="mt-0.5 block text-xs">
          Others launch from it, and you earn the partner share of their trading fees for as long as
          their coins trade.
        </span>
      </button>
    );
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Publish as a preset</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          This creates a Meteora config with you as its fee claimer: every coin launched from it pays
          you the partner share of its swap fees (the part the creator does not take). Publishing costs
          only the account rent, and presetfun takes no cut of what the preset earns.
        </p>
      </div>
      <ErrorNote>{friendlyError(error)}</ErrorNote>
      {listed && <DoneNote message="Preset is listed." signatures={signatures} />}
      {listed && (
        <p className="font-mono text-xs break-all text-slate-400">Config: {listed}</p>
      )}
      <Field label="Preset name" value={name} onChange={setName} placeholder="Slow RWA launch" mono={false} />
      <Field
        label="What it is for"
        value={description}
        onChange={setDescription}
        placeholder="Who should launch with this, and why"
        mono={false}
      />
      <Choice
        label="Asset class"
        value={assetClass}
        options={ASSET_CLASSES.map((c) => ({ value: c, label: c }))}
        onChange={setAssetClass}
      />
      <Submit
        onClick={publish}
        busy={busy || listing}
        disabled={name.trim().length < 3}
        label={listing ? "Listing…" : "Publish preset"}
        feeSol={0}
      />
    </Card>
  );
}
