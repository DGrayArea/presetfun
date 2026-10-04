/**
 * Turns the raw errors wallets, RPC nodes and SDKs throw into something a
 * person can act on. Anything not recognised is shown as it came, since a
 * precise message beats a vague one.
 */
const RULES: [RegExp, string][] = [
  [/user rejected|user declined|rejected the request|approval denied/i, "You cancelled it in your wallet. Nothing was sent."],
  [/\b429\b|too many requests|rate limit/i, "The Solana network is busy right now. Wait a moment and try again."],
  [/\b(403|502|503|504)\b|forbidden|fetch failed|failed to fetch|networkerror|econnreset|socket hang up/i,
    "Couldn't reach the Solana network. Check your connection and try again in a moment."],
  [/blockhash not found|block height exceeded|transaction expired|has expired/i,
    "The transaction expired before it landed. Nothing was charged. Try again."],
  [/insufficient (funds|lamports)|debit an account but found no record of a prior credit/i,
    "Not enough SOL in your wallet to cover this and the network fees."],
  [/slippage|0x1771|exceeds desired slippage|tolerance exceeded/i,
    "The price moved past your slippage limit, so nothing was traded. Try again or raise slippage."],
  [/bundle.*(dropped|failed|not land|rejected)|jito/i,
    "The Jito bundle didn't land. Nothing in it was executed. Try again, ideally with a higher tip."],
];

export function friendlyError(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = String(raw).trim();
  for (const [re, msg] of RULES) if (re.test(text)) return msg;
  return text;
}
