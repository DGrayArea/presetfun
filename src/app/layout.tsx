import type { Metadata, Viewport } from "next";

import { toPublicConfig } from "@/lib/config";
import { getAppConfig } from "@/lib/config.server";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "presetfun — design bonding curves, launch on Meteora",
  description:
    "Design a Meteora Dynamic Bonding Curve visually, launch a coin on it, or publish it as a preset that earns you the partner fee on every launch.",
};

export const viewport: Viewport = {
  themeColor: "#090b0f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read per request so a fee or cluster change only needs a restart.
  const config = getAppConfig();
  return (
    <html lang="en">
      <body className="min-h-screen bg-ground text-slate-100 antialiased">
        {/* Stripped of the RPC URL — that key stays on the server. */}
        <Providers config={toPublicConfig(config)}>{children}</Providers>
      </body>
    </html>
  );
}
