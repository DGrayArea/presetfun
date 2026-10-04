"use client";

import dynamic from "next/dynamic";

import { useAppConfig } from "@/app/providers";

// The wallet button reads browser-only state; rendering it on the server would
// mismatch on hydration.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

export function Header() {
  const { cluster } = useAppConfig();
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-ground/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          presetfun
          {cluster !== "mainnet-beta" && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
              {cluster}
            </span>
          )}
        </a>
        <WalletMultiButton />
      </div>
    </header>
  );
}
