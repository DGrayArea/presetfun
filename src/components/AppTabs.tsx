"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { FeatureGate } from "@/components/FeatureGate";

/** Each panel pulls in the Meteora SDK, so they load only when opened. */
const skeleton = () => (
  <div className="h-96 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
);
const CreateDbcLaunch = dynamic(
  () => import("@/components/CreateDbcLaunch").then((m) => m.CreateDbcLaunch),
  { loading: skeleton },
);
const PresetMarket = dynamic(
  () => import("@/components/PresetMarket").then((m) => m.PresetMarket),
  { loading: skeleton },
);
const DbcTrade = dynamic(() => import("@/components/DbcTrade").then((m) => m.DbcTrade), {
  loading: skeleton,
});

type Tab = "studio" | "presets" | "trade";

const TABS: { id: Tab; label: string }[] = [
  { id: "studio", label: "Curve Studio" },
  { id: "presets", label: "Presets" },
  { id: "trade", label: "Trade & claim" },
];

export function AppTabs() {
  const [tab, setTab] = useState<Tab>("studio");

  // Deep-linkable tabs (#presets, #trade), so a demo or a shared link can open
  // straight onto the marketplace.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash);
  }, []);
  function open(next: Tab) {
    setTab(next);
    history.replaceState(null, "", `#${next}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => open(t.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.id ? "bg-accent text-accent-ink" : "text-slate-400 hover:bg-white/5"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FeatureGate feature="dbc">
        {tab === "studio" && <CreateDbcLaunch />}
        {tab === "presets" && (
          <FeatureGate feature="presets">
            <PresetMarket />
          </FeatureGate>
        )}
        {tab === "trade" && <DbcTrade />}
      </FeatureGate>
    </div>
  );
}
