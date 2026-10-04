"use client";

import { useCallback, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { confirmSignature } from "@/lib/confirm";

type Result = Record<string, unknown> & {
  transactions?: string[];
  lastValidBlockHeight?: number;
};

/**
 * Post to a venue route, then sign and land whatever it hands back.
 *
 * Concentrated liquidity does not always fit in one transaction — a Meteora
 * withdrawal claims, removes and closes; an Orca close can split the same way —
 * so every route returns an array and this sends them **in order**, waiting for
 * each to confirm before the next. They are dependent: sending them in parallel
 * would have the second fail against state the first has not written yet.
 *
 * `signAllTransactions` is used when the wallet has it, so the user approves
 * once rather than three times. Not every wallet implements it (mobile adapters
 * in particular), hence the per-transaction fallback.
 */
export function useVenueAction() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signAllTransactions } = useWallet();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<string[]>([]);

  const call = useCallback(
    async (endpoint: string, body: Record<string, unknown>): Promise<Result> => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, owner: publicKey?.toBase58() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed.");
      return json as Result;
    },
    [publicKey],
  );

  const run = useCallback(
    async (endpoint: string, body: Record<string, unknown>): Promise<Result | null> => {
      if (!publicKey) return null;
      setBusy(true);
      setError(null);
      setSignatures([]);

      try {
        const json = await call(endpoint, body);
        const raw = json.transactions ?? [];
        if (raw.length === 0) throw new Error("The server returned nothing to sign.");

        const txs = raw.map((t) => Transaction.from(Buffer.from(t, "base64")));
        const sent: string[] = [];

        if (txs.length > 1 && signAllTransactions) {
          const signed = await signAllTransactions(txs);
          for (const tx of signed) {
            const sig = await connection.sendRawTransaction(tx.serialize());
            await confirm(sig, tx.recentBlockhash!, json.lastValidBlockHeight!);
            sent.push(sig);
          }
        } else {
          for (const tx of txs) {
            const sig = await sendTransaction(tx, connection);
            await confirm(sig, tx.recentBlockhash!, json.lastValidBlockHeight!);
            sent.push(sig);
          }
        }

        setSignatures(sent);
        return json;
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).trim();
        setError(
          /user rejected|user declined/i.test(message)
            ? "You rejected the transaction. Nothing changed."
            : message || "The wallet closed without returning a result.",
        );
        return null;
      } finally {
        setBusy(false);
      }

      async function confirm(signature: string, blockhash: string, lastValidBlockHeight: number) {
        const conf = await confirmSignature(
          connection,
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (conf.value.err) {
          throw new Error(
            `The transaction was rolled back: ${JSON.stringify(conf.value.err)}. Nothing changed.`,
          );
        }
      }
    },
    [call, connection, publicKey, sendTransaction, signAllTransactions],
  );

  return { run, call, busy, error, setError, signatures, setSignatures };
}
