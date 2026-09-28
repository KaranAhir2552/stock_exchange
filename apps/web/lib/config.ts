import type { AfterbellConfig } from "@afterbell/config";
import { poolPda } from "@afterbell/sdk";
import { PublicKey } from "@solana/web3.js";

/** Validated config/<NETWORK>.json, inlined at build time by next.config.ts. */
export const cfg: AfterbellConfig = JSON.parse(process.env.NEXT_PUBLIC_AFTERBELL_CONFIG as string);

/** Demo controls exist only in builds whose config enables them (never mainnet: pnpm check:mainnet). */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "true";

export const programId = new PublicKey(cfg.programId || PublicKey.default);

export type PoolConfig = AfterbellConfig["pools"][number];

export interface PoolMeta {
  cfg: PoolConfig;
  address: PublicKey;
  base: string;
  quote: string;
  /** "Stock" for market-hours pools, "Crypto" for 24/7 ones. */
  kind: "Stock" | "Crypto";
  /** Friendly name of the underlying, e.g. "Tokenized Tesla". */
  label: string;
}

const LABELS: Record<string, string> = { TSLAx: "Tokenized Tesla", SOL: "Solana", USDC: "USD Coin" };

/** Configured pools whose mints exist on this network. */
export const pools: PoolMeta[] = cfg.pools.flatMap((p) => {
  const b = cfg.mints[p.base]?.address;
  const q = cfg.mints[p.quote]?.address;
  if (!b || !q) return [];
  return [
    {
      cfg: p,
      address: poolPda(programId, new PublicKey(b), new PublicKey(q)),
      base: p.base,
      quote: p.quote,
      kind: p.profile === "UsEquity" ? "Stock" : "Crypto",
      label: LABELS[p.base.replace(/-test$/, "")] ?? p.base,
    },
  ];
});

export const networkName = cfg.network[0].toUpperCase() + cfg.network.slice(1);

const clusterQuery = {
  "mainnet-beta": "",
  devnet: "?cluster=devnet",
  custom: `?cluster=custom&customUrl=${encodeURIComponent(cfg.rpcUrls.at(-1) ?? "")}`,
}[cfg.explorerCluster];

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${clusterQuery}`;
