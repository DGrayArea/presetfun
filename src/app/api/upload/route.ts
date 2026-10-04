import { NextResponse } from "next/server";

export const runtime = "nodejs";
/** Uploads must never be cached or statically evaluated. */
export const dynamic = "force-dynamic";

const PINATA_JWT = process.env.PINATA_JWT;
const GATEWAY = (process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs").replace(
  /\/$/,
  "",
);

// Pinata's v3 Files API. The legacy pinning API (api.pinata.cloud/pinning/*)
// returns NO_SCOPES_FOUND for the JWT this project uses, and v3 takes a bearer
// token only — no key/secret fallback.
const FILES_V3_ENDPOINT = "https://uploads.pinata.cloud/v3/files";

import { ACCEPTED_IMAGE_TYPES as ALLOWED_TYPES, formatMb, maxImageBytes } from "@/lib/limits";
import { clientIp, rateLimit } from "@/lib/rateLimit";

// Anyone who can reach this route spends your Pinata quota, so throttle it.
// Per caller, and — because a per-caller limit does nothing against many
// addresses at once — a ceiling across everyone per day, so the quota cannot
// be drained in one go. Both hold across instances once Upstash is configured;
// see `@/lib/rateLimit`.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const DAILY_MAX = Math.max(Number(process.env.UPLOAD_DAILY_MAX) || 500, 1);

async function pinToIpfs(
  body: Blob,
  filename: string,
  pinName: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", body, filename);
  form.append("network", "public");
  form.append("name", pinName);

  const res = await fetch(FILES_V3_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Pinata upload failed [${res.status}]: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: { cid?: string } };
  const cid = json?.data?.cid;
  if (!cid) throw new Error("Pinata response did not include a CID.");
  return `${GATEWAY}/${cid}`;
}

export async function POST(req: Request) {
  if (!PINATA_JWT) {
    return NextResponse.json(
      { error: "Server is missing PINATA_JWT. Set it in .env.local." },
      { status: 500 },
    );
  }

  const gate = await rateLimit({
    name: "upload",
    key: clientIp(req),
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const image = form.get("image");
  const name = String(form.get("name") ?? "").trim();
  const symbol = String(form.get("symbol") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const website = String(form.get("website") ?? "").trim();
  const twitter = String(form.get("twitter") ?? "").trim();
  const telegram = String(form.get("telegram") ?? "").trim();
  // NFT-only fields.
  const isNft = String(form.get("kind") ?? "") === "nft";
  const royaltyBps = Number.parseInt(String(form.get("royaltyBps") ?? "0"), 10) || 0;
  const creator = String(form.get("creator") ?? "").trim();
  let attributes: { trait_type: string; value: string }[] = [];
  if (isNft) {
    try {
      const raw = JSON.parse(String(form.get("attributes") ?? "[]"));
      if (Array.isArray(raw)) {
        attributes = raw
          .filter((a) => a && typeof a.trait_type === "string" && a.trait_type.trim())
          .slice(0, 64)
          .map((a) => ({
            trait_type: String(a.trait_type).slice(0, 64),
            value: String(a.value ?? "").slice(0, 128),
          }));
      }
    } catch {
      return NextResponse.json({ error: "Attributes were not valid JSON." }, { status: 400 });
    }
  }

  if (!name || !symbol) {
    return NextResponse.json({ error: "Name and symbol are required." }, { status: 400 });
  }
  if (name.length > 32) {
    return NextResponse.json({ error: "Name must be 32 characters or fewer." }, { status: 400 });
  }
  if (symbol.length > 10) {
    return NextResponse.json({ error: "Symbol must be 10 characters or fewer." }, { status: 400 });
  }
  if (description.length > 1000) {
    return NextResponse.json(
      { error: "Description must be 1000 characters or fewer." },
      { status: 400 },
    );
  }
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "An image file is required." }, { status: 400 });
  }
  const sizeCap = maxImageBytes(isNft ? "nft" : "token");
  if (image.size > sizeCap) {
    return NextResponse.json(
      { error: `Image must be ${formatMb(sizeCap)} or smaller.` },
      { status: 400 },
    );
  }

  const ext = ALLOWED_TYPES[image.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Image must be a PNG, JPEG, GIF, or WebP." },
      { status: 400 },
    );
  }

  // Counted only once the request is valid, so junk requests can't use up
  // the site-wide allowance and pause launches for everyone.
  const daily = await rateLimit({
    name: "upload-daily",
    key: "all",
    limit: DAILY_MAX,
    windowMs: 24 * 60 * 60_000,
  });
  if (!daily.ok) {
    console.warn(`[upload] daily ceiling of ${DAILY_MAX} reached`);
    return NextResponse.json(
      { error: "Uploads are paused for today. Try again later." },
      { status: 429, headers: { "Retry-After": String(daily.retryAfter) } },
    );
  }

  try {
    const safeSymbol = symbol.replace(/[^a-zA-Z0-9_-]/g, "") || "token";

    const imageUrl = await pinToIpfs(image, `${safeSymbol}.${ext}`, `${safeSymbol}-logo`);

    // Metaplex off-chain JSON standard — same shape the CLI scripts produce.
    // NFTs additionally carry traits, royalty and creators, which is what
    // marketplaces read to render the item and route royalty payments.
    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      external_url: website,
      attributes,
      ...(isNft ? { seller_fee_basis_points: royaltyBps } : {}),
      properties: {
        files: [{ uri: imageUrl, type: image.type }],
        category: "image",
        ...(isNft && creator ? { creators: [{ address: creator, share: 100 }] } : {}),
      },
      ...(twitter || telegram
        ? { extensions: { ...(twitter ? { twitter } : {}), ...(telegram ? { telegram } : {}) } }
        : {}),
    };

    const metadataUri = await pinToIpfs(
      new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
      "metadata.json",
      `${safeSymbol}-metadata`,
    );

    return NextResponse.json({ imageUrl, metadataUri });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    console.error("[upload]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
