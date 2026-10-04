import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Several lockfiles exist above this directory, so pin the trace root here
  // instead of letting Next guess (it picks ~/pnpm-lock.yaml otherwise).
  outputFileTracingRoot: path.join(__dirname),
  // The Solana + Metaplex stack reaches for Node globals in the browser.
  // `buffer` is polyfilled explicitly in providers.tsx; these fallbacks stop
  // webpack from trying to bundle server-only modules it finds on the way.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
