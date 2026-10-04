"use client";

import "@/lib/polyfills";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";

import { RPC_PROXY_PATH, type PublicConfig } from "@/lib/config";

import "@solana/wallet-adapter-react-ui/styles.css";

const ConfigContext = createContext<PublicConfig | null>(null);

/** Runtime config, resolved on the server and passed in through the tree. */
export function useAppConfig(): PublicConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("useAppConfig must be used inside <Providers>");
  return config;
}

export function Providers({ config, children }: { config: PublicConfig; children: ReactNode }) {
  // Desktop wallets (Phantom, Solflare, Backpack…) register themselves through
  // the Wallet Standard, so they need no entry here.
  //
  // Mobile Wallet Adapter does need an explicit adapter. It only activates on
  // Android — it reports readyState "Unsupported" on desktop and iOS, so it is
  // filtered out of the wallet list there rather than showing a dead option.
  // Constructed lazily because it reads window.location, and this subtree is
  // server-rendered from layout.tsx.
  const wallets = useMemo(() => {
    if (typeof window === "undefined") return [];
    return [
      new SolanaMobileWalletAdapter({
        addressSelector: createDefaultAddressSelector(),
        appIdentity: {
          name: "presetfun",
          uri: window.location.origin,
          icon: "/icon.svg", // resolved relative to `uri`
        },
        authorizationResultCache: createDefaultAuthorizationResultCache(),
        cluster: config.cluster,
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      }),
    ];
  }, [config.cluster]);

  // `Connection` parses its endpoint with `new URL`, so a bare path will not do
  // — it has to be absolute. During the server render there is no origin to
  // read; the value is a placeholder that is replaced on hydration, before any
  // RPC call can happen.
  const endpoint = useMemo(
    () =>
      typeof window === "undefined"
        ? `http://localhost${RPC_PROXY_PATH}`
        : `${window.location.origin}${RPC_PROXY_PATH}`,
    [],
  );

  return (
    <ConfigContext.Provider value={config}>
      {/*
        Pointed at our own proxy rather than the RPC node, so the key never
        reaches the browser. Nothing subscribes any more — confirmations poll
        over HTTP via `confirmSignature` — so the WebSocket endpoint web3.js
        derives from this URL is never opened.
      */}
      <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ConfigContext.Provider>
  );
}
