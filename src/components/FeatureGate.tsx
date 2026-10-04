"use client";

import type { ReactNode } from "react";

import { useAppConfig } from "@/app/providers";
import type { Feature } from "@/lib/config";

/** Replace a panel that cannot work on this deployment with the reason why. */
export function FeatureGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const reason = useAppConfig().unavailable[feature];
  if (!reason) return <>{children}</>;
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
      {reason}
    </div>
  );
}
