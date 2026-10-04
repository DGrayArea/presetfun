import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type Signer,
} from "@solana/web3.js";
import BN from "bn.js";

/**
 * Shared plumbing for the DEX routes that hand a wallet unsigned transactions.
 *
 * Raydium's CPMM work always fits in one transaction, so those routes finish
 * inline. Concentrated liquidity does not: Meteora returns an array for a
 * withdrawal (claim, then remove, then close) and Orca splits a position close
 * the same way. That changes two things, and both are easy to get wrong.
 */

export type Step = { tx: Transaction; signers?: Signer[] };

/**
 * Attach the service fee, stamp the blockhash, and serialise.
 *
 * The fee goes on the **last** transaction deliberately. A user who signs the
 * first prompt and then closes their wallet has done nothing and should owe
 * nothing; putting the fee last means we only get paid once the work is
 * actually through. It also keeps the fee atomic with the final step rather
 * than floating as a separate transfer the user could be charged for twice.
 *
 * Ephemeral signers (Meteora's position account, Orca's position mint) are
 * partial-signed here, and only after the fee instruction and blockhash are in
 * place — signing captures the message as it stands, so anything appended
 * afterwards silently invalidates the signature.
 */
export async function finalizeSteps({
  connection,
  steps,
  owner,
  feeWallet,
  feeSol,
}: {
  connection: Connection;
  steps: Step[];
  owner: PublicKey;
  feeWallet: string | null;
  feeSol: number;
}): Promise<{ transactions: string[]; lastValidBlockHeight: number }> {
  if (steps.length === 0) throw new Error("Nothing to do.");

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const serialised = steps.map(({ tx, signers }, i) => {
    if (i === steps.length - 1 && feeWallet && feeSol > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: new PublicKey(feeWallet),
          lamports: Math.round(feeSol * 1_000_000_000),
        }),
      );
    }

    tx.feePayer = owner;
    tx.recentBlockhash = blockhash;
    if (signers?.length) tx.partialSign(...signers);

    return tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
  });

  return { transactions: serialised, lastValidBlockHeight };
}

/** Whole-token decimal string → base units. Rejects anything that isn't a plain number. */
export function toBase(amount: string, decimals: number, label = "That token"): BN {
  const t = amount.trim().replace(/[_,\s]/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") throw new Error("Invalid amount.");
  const [whole = "0", frac = ""] = t.split(".");
  if (frac.length > decimals) throw new Error(`${label} has only ${decimals} decimals.`);
  return new BN(BigInt(whole + frac.padEnd(decimals, "0")).toString());
}

/** Base units → a readable whole-token string, trailing zeroes trimmed. */
export function fromBase(raw: BN | bigint | string, decimals: number): string {
  const v = BigInt(raw.toString());
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const d = BigInt(10) ** BigInt(decimals);
  const frac = (abs % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / d}${frac ? `.${frac}` : ""}`;
}

/**
 * Turn an SDK or RPC failure into something a user can act on.
 *
 * Pointing an account decoder at the wrong address throws a raw buffer error
 * ("offset is out of range"), which tells the user nothing. Anything that looks
 * like a failed decode or a missing account means the same thing in practice:
 * the address they pasted is not the kind of account this tool wants.
 */
export function explainVenueError(err: unknown, notFound: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const looksLikeWrongAccount =
    /could not find|not found|does not exist|invalid account|account discriminator|offset|out of range|decode|buffer|length|unable to fetch/i.test(
      message,
    );
  return looksLikeWrongAccount ? notFound : message || "Request failed.";
}
