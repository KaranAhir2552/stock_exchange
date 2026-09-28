import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const NETWORKS = ["localnet", "devnet", "mainnet"] as const;
export type Network = (typeof NETWORKS)[number];

const pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "not a base58 pubkey");
const feedId = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "feed id must be 32 bytes hex");
const bps = z.number().int().min(0).max(10_000);

const poolParams = z.object({
  openBandBps: bps,
  closedBaseBandBps: bps,
  closedBandGrowthBpsPerHour: bps,
  closedMaxBandBps: bps,
  openFeeBps: bps,
  closedBaseFeeBps: bps,
  closedFeeGrowthBpsPerHour: bps,
  closedMaxFeeBps: bps,
  sizeFeeBpsPer1PctDepth: bps,
  depthBps: bps.min(1),
  maxTvlQuote: z.string().regex(/^\d+$/, "u64 as decimal string"),
});

const mint = z.object({
  // null = not created yet; scripts/create-test-mints fills it in (never allowed on mainnet).
  address: pubkey.nullable(),
  decimals: z.number().int().min(0).max(18),
});

const pool = z.object({
  name: z.string().min(1),
  /** Keys into `mints`. */
  base: z.string().min(1),
  quote: z.string().min(1),
  profile: z.enum(["AlwaysOpen", "UsEquity"]),
  oracleKind: z.enum(["Pyth", "Mock"]),
  feedId,
  maxStalenessSecs: z.number().int().positive(),
  maxConfBps: bps,
  params: poolParams,
});

export const configSchema = z
  .object({
    network: z.enum(NETWORKS),
    rpcUrls: z.array(z.url()).min(1),
    wsUrls: z.array(z.url()).min(1),
    programId: pubkey,
    /** Symbol -> mint. Must include USDC. */
    mints: z.record(z.string(), mint).refine((m) => "USDC" in m, "mints must include USDC"),
    /** Pyth programs (the upgraded "pro-compatible" deployment: docs.pyth.network/price-feeds/core/upgrade/contracts). */
    pythReceiverProgramId: pubkey,
    pythPushOracleProgramId: pubkey,
    pythWormholeProgramId: pubkey,
    hermesUrl: z.url(),
    calendarProfileIds: z.array(z.number().int().min(0).max(255)),
    explorerCluster: z.enum(["custom", "devnet", "mainnet-beta"]),
    features: z.object({ demoControls: z.boolean(), mockOracle: z.boolean() }),
    pools: z.array(pool),
  })
  .superRefine((cfg, ctx) => {
    for (const p of cfg.pools) {
      for (const sym of [p.base, p.quote]) {
        if (!(sym in cfg.mints)) ctx.addIssue({ code: "custom", message: `pool ${p.name}: unknown mint ${sym}` });
      }
    }
  });

export type AfterbellConfig = z.infer<typeof configSchema>;

type SafetyInput = {
  mints?: Record<string, { address?: unknown }>;
  features?: { demoControls?: unknown; mockOracle?: unknown };
  pools?: { name?: unknown; oracleKind?: unknown }[];
};

/** Mainnet must never enable mock/demo paths. Works on raw JSON so CI can run it on an incomplete config. */
export function mainnetSafetyErrors(cfg: SafetyInput): string[] {
  const errors: string[] = [];
  if (cfg.features?.mockOracle !== false) errors.push("features.mockOracle must be false on mainnet");
  if (cfg.features?.demoControls !== false) errors.push("features.demoControls must be false on mainnet");
  for (const [sym, m] of Object.entries(cfg.mints ?? {})) {
    if (m.address == null) errors.push(`mints.${sym}.address must be set on mainnet`);
  }
  for (const p of cfg.pools ?? []) {
    if (p.oracleKind !== "Pyth") errors.push(`pool ${String(p.name)} must use oracleKind Pyth on mainnet`);
  }
  return errors;
}

export function parseConfig(raw: unknown): AfterbellConfig {
  const cfg = configSchema.parse(raw);
  if (cfg.network === "mainnet") {
    const errors = mainnetSafetyErrors(cfg);
    if (errors.length) throw new Error(`Unsafe mainnet config:\n  ${errors.join("\n  ")}`);
  }
  return cfg;
}

export const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../config");

export function readRawConfig(network: Network, dir = CONFIG_DIR): unknown {
  return JSON.parse(readFileSync(join(dir, `${network}.json`), "utf8"));
}

/** Loads config/<NETWORK>.json and fails fast on anything missing or unsafe. */
export function loadConfig(network = process.env.NETWORK, dir = CONFIG_DIR): AfterbellConfig {
  const net = z.enum(NETWORKS).parse(network);
  const cfg = parseConfig(readRawConfig(net, dir));
  if (cfg.network !== net) throw new Error(`config/${net}.json declares network "${cfg.network}"`);
  // Secrets (e.g. a keyed RPC URL) live in the git-ignored .env.<network>; real env vars win.
  const envFile = join(dir, "..", `.env.${net}`);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return withRpcOverride(cfg, process.env.RPC_URL);
}

/** A private RPC (from RPC_URL) goes first; the configured public ones stay as failover. */
export function withRpcOverride(cfg: AfterbellConfig, rpcUrl: string | undefined): AfterbellConfig {
  if (!rpcUrl) return cfg;
  return {
    ...cfg,
    rpcUrls: [rpcUrl, ...cfg.rpcUrls.filter((u) => u !== rpcUrl)],
    wsUrls: [rpcUrl.replace(/^http/, "ws"), ...cfg.wsUrls],
  };
}

/** Address of a configured mint; throws if it hasn't been created yet. */
export function mintAddress(cfg: AfterbellConfig, symbol: string): string {
  const m = cfg.mints[symbol];
  if (!m) throw new Error(`unknown mint ${symbol}`);
  if (!m.address) throw new Error(`mint ${symbol} has no address yet: run create-test-mints --network ${cfg.network}`);
  return m.address;
}

/** For logs: an RPC URL without its query string (where API keys live). */
export const redactUrl = (url: string) => url.replace(/\?.*$/, "?…");
