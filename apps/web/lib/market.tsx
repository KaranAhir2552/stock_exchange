"use client";
import { AfterbellClient, type Calendar, getBand, getCurrentFee, type MarketSnapshot, tvlQuote } from "@afterbell/sdk";
import { AnchorProvider } from "@anchor-lang/core";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type PoolMeta, pools, programId, pythPrograms } from "./config";
import { uiPrice } from "./format";

const POLL_MS = 5_000;

/** Reads never sign; Anchor still wants a wallet object. */
const readOnlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(t: T) => t,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(t: T[]) => t,
};

export interface Market extends MarketSnapshot {
  meta: PoolMeta;
  /** Local time (ms) this snapshot was read, so the pool clock can keep ticking between polls. */
  readAt: number;
}

interface MarketsValue {
  client: AfterbellClient;
  markets: Market[] | null;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<MarketsValue | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const client = useMemo(
    () =>
      new AfterbellClient(
        new AnchorProvider(connection, readOnlyWallet, { commitment: "confirmed" }),
        programId,
        pythPrograms,
      ),
    [connection],
  );
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!pools.length) return setError("No pools are configured for this network yet.");
    try {
      const snaps = await client.fetchMarkets(pools.map((p) => p.address));
      const readAt = Date.now();
      setMarkets(snaps.map((s, i) => ({ ...s, meta: pools[i], readAt })));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  const value = useMemo(() => ({ client, markets, error, reload }), [client, markets, error, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarkets(): MarketsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMarkets outside MarketProvider");
  return v;
}

export function useMarket(address: string | null | undefined): Market | null {
  const { markets } = useMarkets();
  return markets?.find((m) => m.meta.address.toBase58() === address) ?? null;
}

/** Re-renders every second, for countdowns and the live pool clock. */
export function useTick(ms = 1_000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

/** Is this pool running on the devnet demo's simulated clock (DECISIONS.md #59)? */
export const simulated = (m: Market) => (m.mock?.clockOffset ?? 0n) > 0n;

/** The pool's clock (chain time + demo offset), advanced by local time since the snapshot. */
export function poolNow(m: Market, localNow = Date.now()): bigint {
  const base = m.ctx?.now ?? m.chainNow;
  return base + BigInt(Math.max(0, Math.floor((localNow - m.readAt) / 1000)));
}

/** Everything the UI shows about a pool right now, in display units. */
export function view(m: Market, localNow = Date.now()) {
  const s = m.live;
  const { baseDecimals: bd, quoteDecimals: qd } = s;
  const now = poolNow(m, localNow);
  const band = getBand(s, now);
  const oracle = m.ctx?.oracle ?? null;
  return {
    now,
    mode: s.mode,
    halted: s.halted,
    price: uiPrice(s.poolPrice, bd, qd),
    reference: uiPrice(s.referencePrice, bd, qd),
    oraclePrice: oracle ? uiPrice(oracle.price, bd, qd) : null,
    oracleAgeSecs: oracle ? Number(now - oracle.publishTs) : null,
    band: band && { bps: band.bandBps, low: uiPrice(band.low, bd, qd), high: uiPrice(band.high, bd, qd) },
    feeBps: getCurrentFee(s, now),
    closeTs: s.closeTs,
    tvl: Number(tvlQuote(m.reserves.base, m.reserves.quote, s.poolPrice)) / 10 ** qd,
    calendar: m.ctx?.calendar ?? null,
    params: s.params,
  };
}
export type PoolView = ReturnType<typeof view>;

/** Next market open/close for a stock pool: which it is and when (pool clock). */
export function nextSessionChange(cal: Calendar | null, now: bigint): { kind: "open" | "close"; at: bigint } | null {
  if (!cal || now >= cal.validUntil) return null;
  for (const s of cal.sessions) {
    if (now < s.openTs) return { kind: "open", at: s.openTs };
    if (now < s.closeTs) return { kind: "close", at: s.closeTs };
  }
  return null;
}
