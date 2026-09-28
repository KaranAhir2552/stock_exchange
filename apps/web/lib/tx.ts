"use client";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, type PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { useCallback, useState } from "react";
import { useMarkets } from "./market";

/** Creates the owner's token account for `mint` if missing (no-op if it exists). */
export function ensureAta(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  return createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, tokenProgram);
}

export type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; sig: string }
  | { status: "error"; message: string };

/** A plain-language reason for a failed transaction, from the program's error name when there is one. */
export function explainError(e: unknown, idlErrors: { code: number; name: string }[] = []): string {
  const text = e instanceof Error ? `${e.message} ${(e as { logs?: string[] }).logs?.join(" ") ?? ""}` : String(e);
  const custom = Number(text.match(/"Custom":\s*(\d+)/)?.[1]);
  const code =
    text.match(/Error Code: (\w+)/)?.[1] ??
    idlErrors.find((x) => x.code === custom)?.name?.replace(/^./, (c) => c.toUpperCase());
  const friendly: Record<string, string> = {
    OutsideBand: "The price would leave the allowed range. Try a smaller amount.",
    PoolPaused: "Trading is paused for this pool. Withdrawals still work.",
    SlippageExceeded: "The price moved. Try again or raise your slippage tolerance.",
    TvlCapExceeded: "This pool is at its deposit limit.",
    StaleOracle: "The price feed is out of date. Try again in a minute.",
    InsufficientLiquidity: "Not enough liquidity for this trade.",
  };
  if (code) return friendly[code] ?? code;
  if (/User rejected/i.test(text)) return "You rejected the request in your wallet.";
  return text.slice(0, 200);
}

/** Sends instructions signed by the connected wallet (the user signs everything, brief rule 4). */
export function useSendTx(onDone?: () => void) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { client } = useMarkets();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (ixs: TransactionInstruction[]) => {
      if (!publicKey) return;
      setState({ status: "pending" });
      try {
        const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
        const latest = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = latest.blockhash;
        tx.feePayer = publicKey;
        const sig = await sendTransaction(tx, connection);
        const res = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
        if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
        setState({ status: "done", sig });
        onDone?.();
      } catch (e) {
        setState({ status: "error", message: explainError(e, client.program.idl.errors) });
      }
    },
    [connection, publicKey, sendTransaction, onDone, client],
  );
  return { send, state, reset: () => setState({ status: "idle" }) };
}
