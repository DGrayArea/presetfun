/**
 * Upload limits, shared by the client forms and the server route.
 *
 * Kept in one place because they drifted once already: the NFT form advertised
 * and accepted 15 MB while the route rejected anything over 5 MB, so a large
 * artwork failed only after the user had filled in the whole form.
 */

export const MAX_TOKEN_IMAGE_BYTES = 5 * 1024 * 1024;
/** Artwork is the product for an NFT, so it gets more headroom than a logo. */
export const MAX_NFT_IMAGE_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const ACCEPTED_IMAGE_LIST = Object.keys(ACCEPTED_IMAGE_TYPES);

export const maxImageBytes = (kind: "token" | "nft") =>
  kind === "nft" ? MAX_NFT_IMAGE_BYTES : MAX_TOKEN_IMAGE_BYTES;

export const formatMb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
