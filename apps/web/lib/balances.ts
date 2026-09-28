"use client";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { useMarkets } from "./market";

/** The connected wallet's balances (atoms) of each pool's base, quote and LP tokens, keyed by mint. */
export function useBalances(): Record<string, bigint> | null {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { markets } = useMarkets();
  const [bal, setBal] = useState<Record<string, bigint> | null>(null);
  const readAt = markets?.[0]?.readAt; // refresh whenever markets refresh

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read on each market poll
  useEffect(() => {
    if (!publicKey || !markets) return setBal(null);
    const mints = new Map<string, { mint: PublicKey; program: PublicKey }>();
    for (const m of markets) {
      const a = m.info.accounts;
      mints.set(a.baseMint.toBase58(), { mint: a.baseMint, program: a.baseTokenProgram });
      mints.set(a.quoteMint.toBase58(), { mint: a.quoteMint, program: a.quoteTokenProgram });
      mints.set(a.lpMint.toBase58(), { mint: a.lpMint, program: TOKEN_PROGRAM_ID }); // LP mints are classic SPL
    }
    const list = [...mints.values()];
    const atas = list.map((x) => getAssociatedTokenAddressSync(x.mint, publicKey, true, x.program));
    let live = true;
    connection.getMultipleAccountsInfo(atas).then((accs) => {
      if (!live) return;
      const out: Record<string, bigint> = {};
      accs.forEach((a, i) => {
        out[list[i].mint.toBase58()] = a ? a.data.readBigUInt64LE(64) : 0n;
      });
      setBal(out);
    });
    return () => {
      live = false;
    };
  }, [connection, publicKey, readAt]);
  return bal;
}
