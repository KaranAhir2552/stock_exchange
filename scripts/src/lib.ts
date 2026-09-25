import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AfterbellConfig, CONFIG_DIR, loadConfig, type Network, readRawConfig } from "@afterbell/config";
import { AfterbellClient } from "@afterbell/sdk";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  type Signer,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

export const ROOT = join(CONFIG_DIR, "..");

/** Loads `.env.<network>` if present (secrets only), then the validated config. */
export function setup(network: Network) {
  const envFile = join(ROOT, `.env.${network}`);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return loadConfig(network);
}

export function keypairPath(): string {
  const p = process.env.ADMIN_KEYPAIR_PATH ?? "~/.config/solana/id.json";
  return p.replace(/^~/, homedir());
}

export function loadKeypair(path = keypairPath()): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export interface Ctx {
  cfg: AfterbellConfig;
  connection: Connection;
  admin: Keypair;
  client: AfterbellClient;
}

export function context(network: Network): Ctx {
  const cfg = setup(network);
  const connection = new Connection(cfg.rpcUrls[0], "confirmed");
  const admin = loadKeypair();
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  return { cfg, connection, admin, client: new AfterbellClient(provider, new PublicKey(cfg.programId)) };
}

export async function send(
  ctx: Ctx,
  ixs: (TransactionInstruction | Promise<TransactionInstruction>)[],
  extraSigners: Signer[] = [],
): Promise<string> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...(await Promise.all(ixs)),
  );
  return sendAndConfirmTransaction(ctx.connection, tx, [ctx.admin, ...extraSigners], { commitment: "confirmed" });
}

export const exists = async (ctx: Ctx, address: PublicKey) => (await ctx.connection.getAccountInfo(address)) !== null;

/** Writes a mint address back into config/<network>.json (localnet/devnet test mints only). */
export function saveMintAddress(network: Network, symbol: string, address: string) {
  if (network === "mainnet") throw new Error("refusing to write mint addresses into the mainnet config");
  const raw = readRawConfig(network) as { mints: Record<string, { address: string | null }> };
  raw.mints[symbol].address = address;
  writeFileSync(join(CONFIG_DIR, `${network}.json`), `${JSON.stringify(raw, null, 2)}\n`);
}

export const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ msg, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
