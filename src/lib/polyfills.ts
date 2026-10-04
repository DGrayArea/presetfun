import { Buffer } from "buffer";

// @solana/web3.js, @solana/spl-token and the Metaplex beet serializers all
// assume a global Buffer. Next.js does not polyfill Node globals in the
// browser, so we install it before any of that code runs.
// (`process.env` is already provided by Next.js in the browser bundle, so only
// Buffer needs installing here.)
if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  if (!g.Buffer) g.Buffer = Buffer;
}

export {};
