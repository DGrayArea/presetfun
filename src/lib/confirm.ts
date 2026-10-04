import type { Connection, SignatureResult } from "@solana/web3.js";

/**
 * Wait for a transaction using HTTP polling instead of a WebSocket.
 *
 * `connection.confirmTransaction` subscribes over WebSocket, and the browser's
 * connection now points at our own `/api/rpc` proxy, which speaks HTTP only —
 * a subscription there would try `wss://oursite/api/rpc` and hang until the
 * blockhash expired. This does the same job over the allowlisted read methods.
 *
 * The logic matches web3.js's blockheight strategy: a transaction is settled
 * once it has a status, and definitively lost once the chain passes the last
 * block its blockhash was valid for. Polling the height is what stops this
 * waiting forever on a transaction that never landed.
 *
 * Losing the WebSocket is not really a loss here. Subscriptions are the
 * flakiest part of web3.js in mobile wallet browsers, where a good share of
 * this app's users are, and a dropped socket looks exactly like a failed
 * transaction to someone watching a spinner.
 */
export async function confirmSignature(
  connection: Connection,
  {
    signature,
    lastValidBlockHeight,
  }: { signature: string; blockhash?: string; lastValidBlockHeight: number },
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
): Promise<{ value: SignatureResult }> {
  const accepted =
    commitment === "finalized"
      ? ["finalized"]
      : commitment === "confirmed"
        ? ["confirmed", "finalized"]
        : ["processed", "confirmed", "finalized"];

  const started = Date.now();
  // A hard ceiling in case the height never advances — a stalled RPC node
  // should surface as an error, not as a spinner nobody ever gets out of.
  const deadline = started + 120_000;

  let heightCheckedAt = 0;

  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature], {
      // The status of a very recent signature is only in the node's cache for a
      // short while; without this a fast confirmation can read as "not found".
      searchTransactionHistory: false,
    });
    const status = value[0];

    if (status) {
      // An on-chain failure is a real answer: return it and let the caller say
      // what was rolled back, exactly as confirmTransaction would.
      if (status.err) return { value: { err: status.err } };
      if (status.confirmationStatus && accepted.includes(status.confirmationStatus)) {
        return { value: { err: null } };
      }
    }

    // Cheaper than the status call and only decisive once a minute or so, so it
    // does not need to run on every pass.
    if (Date.now() - heightCheckedAt > 4_000) {
      heightCheckedAt = Date.now();
      const height = await connection.getBlockHeight(commitment);
      if (height > lastValidBlockHeight) {
        // One last look: the transaction may have landed in the same moment the
        // blockhash expired, and calling that a failure would be wrong.
        const final = (await connection.getSignatureStatuses([signature])).value[0];
        if (final && !final.err) return { value: { err: null } };
        if (final?.err) return { value: { err: final.err } };
        throw new Error(
          "The transaction was not confirmed before its blockhash expired. It did not go through — nothing changed.",
        );
      }
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Gave up waiting for confirmation after two minutes. Check the signature on Solscan before retrying: ${signature}`,
      );
    }

    await new Promise((r) => setTimeout(r, 1_000));
  }
}
