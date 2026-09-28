// Keeper: every interval, for each configured pool, refresh the on-chain mode/reference price.
// update_reference is permissionless and idempotent, so any number of keepers can run at once.

import { type AfterbellConfig, mintAddress, redactUrl } from "@afterbell/config";
import { AfterbellClient, feedIdBytes, type PoolAccounts, poolPda } from "@afterbell/sdk";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  type Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

export interface KeeperOptions {
  intervalMs: number;
  /** Re-post the current mock price each round (localnet/devnet only; needs the admin key). */
  mockHeartbeat: boolean;
  maxPriorityMicroLamports: number;
  alertAfterMs: number;
  webhookUrl?: string;
}

export interface PoolHealth {
  name: string;
  address: string;
  lastSuccessMs: number | null;
  lastError: string | null;
  successes: number;
  failures: number;
  alerting: boolean;
}

const startedAt = Date.now();

export const log = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

export class Keeper {
  readonly health = new Map<string, PoolHealth>();
  private rpcIndex = 0;
  private pools: { name: string; accounts: PoolAccounts; feedId: Uint8Array; mock: boolean }[] = [];

  private readonly cfg: AfterbellConfig;
  private readonly payer: Keypair;
  private readonly opts: KeeperOptions;

  constructor(cfg: AfterbellConfig, payer: Keypair, opts: KeeperOptions) {
    this.cfg = cfg;
    this.payer = payer;
    this.opts = opts;
    if (opts.mockHeartbeat && !cfg.features.mockOracle) {
      throw new Error("mock heartbeat requires features.mockOracle (localnet/devnet only)");
    }
  }

  private client(): AfterbellClient {
    const connection = new Connection(this.cfg.rpcUrls[this.rpcIndex], "confirmed");
    const provider = new AnchorProvider(connection, new Wallet(this.payer), { commitment: "confirmed" });
    return new AfterbellClient(provider, new PublicKey(this.cfg.programId));
  }

  /** Try each RPC endpoint in turn, starting from the last one that worked. */
  private async withFailover<T>(fn: (c: AfterbellClient) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this.cfg.rpcUrls.length; i++) {
      try {
        return await fn(this.client());
      } catch (e) {
        lastErr = e;
        log("warn", "rpc failed, trying next endpoint", {
          rpc: redactUrl(this.cfg.rpcUrls[this.rpcIndex]),
          err: String(e),
        });
        this.rpcIndex = (this.rpcIndex + 1) % this.cfg.rpcUrls.length;
      }
    }
    throw lastErr;
  }

  async init() {
    for (const p of this.cfg.pools) {
      const base = new PublicKey(mintAddress(this.cfg, p.base));
      const quote = new PublicKey(mintAddress(this.cfg, p.quote));
      const address = poolPda(new PublicKey(this.cfg.programId), base, quote);
      const info = await this.withFailover((c) => c.fetchPool(address));
      // ponytail: Pyth pools need the Hermes post + update in one tx (Phase 3 step E); skipped until then.
      if (p.oracleKind !== "Mock") {
        log("warn", "Pyth pools not supported by this keeper yet, skipping", { pool: p.name });
        continue;
      }
      this.pools.push({ name: p.name, accounts: info.accounts, feedId: feedIdBytes(p.feedId), mock: true });
      this.health.set(p.name, {
        name: p.name,
        address: address.toBase58(),
        lastSuccessMs: null,
        lastError: null,
        successes: 0,
        failures: 0,
        alerting: false,
      });
    }
  }

  /** Median recent priority fee for the pool account, capped. */
  private async priorityFee(c: AfterbellClient, pool: PublicKey): Promise<number> {
    const fees = (await c.connection.getRecentPrioritizationFees({ lockedWritableAccounts: [pool] }))
      .map((f) => f.prioritizationFee)
      .sort((a, b) => a - b);
    const median = fees.length ? fees[Math.floor(fees.length / 2)] : 0;
    return Math.min(median, this.opts.maxPriorityMicroLamports);
  }

  private async ixsFor(c: AfterbellClient, pool: (typeof this.pools)[number]): Promise<TransactionInstruction[]> {
    const ixs: TransactionInstruction[] = [];
    if (this.opts.mockHeartbeat) {
      // Same price, fresh timestamp: keeps a demo oracle "live" without changing what it says.
      const m = await c.fetchMockOracle(c.mockOracle(pool.accounts));
      ixs.push(await c.mockSetPrice(this.payer.publicKey, pool.feedId, m.price, m.conf, m.expo));
    }
    ixs.push(await c.updateReference(pool.accounts));
    return ixs;
  }

  private async updateOnce(pool: (typeof this.pools)[number]): Promise<string> {
    return this.withFailover(async (c) => {
      const fee = await this.priorityFee(c, pool.accounts.address);
      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee }),
        ...(await this.ixsFor(c, pool)),
      );
      const { blockhash, lastValidBlockHeight } = await c.connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.payer.publicKey;
      tx.sign(this.payer);
      let sig: string;
      try {
        sig = await c.connection.sendRawTransaction(tx.serialize());
      } catch (e) {
        // Another keeper with the same key sent the identical tx this block: the update happened.
        if (/already been processed/.test(String(e))) return "duplicate (sent by another keeper)";
        throw e;
      }
      const res = await c.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    });
  }

  /** Retries with exponential backoff (0.5s, 1s, 2s). */
  private async update(pool: (typeof this.pools)[number]) {
    const h = this.health.get(pool.name) as PoolHealth;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const sig = await this.updateOnce(pool);
        h.lastSuccessMs = Date.now();
        h.lastError = null;
        h.successes++;
        if (h.alerting) log("info", "pool recovered", { pool: pool.name });
        h.alerting = false;
        log("info", "reference updated", { pool: pool.name, sig });
        return;
      } catch (e) {
        h.lastError = String(e);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    h.failures++;
    log("warn", "update failed after retries", { pool: pool.name, err: h.lastError });
  }

  private async checkAlerts() {
    const now = Date.now();
    for (const h of this.health.values()) {
      const since = h.lastSuccessMs ?? startedAt;
      if (!h.alerting && now - since > this.opts.alertAfterMs) {
        h.alerting = true;
        log("error", "no successful update", { pool: h.name, sinceMs: now - since, lastError: h.lastError });
        if (this.opts.webhookUrl) {
          await fetch(this.opts.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: `afterbell keeper: no update for ${h.name} in ${Math.round((now - since) / 1000)}s`,
            }),
          }).catch((e) => log("warn", "webhook failed", { err: String(e) }));
        }
      }
    }
  }

  async tick() {
    await Promise.all(this.pools.map((p) => this.update(p)));
    await this.checkAlerts();
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      const started = Date.now();
      await this.tick();
      await new Promise((r) => setTimeout(r, Math.max(0, this.opts.intervalMs - (Date.now() - started))));
    }
  }
}

/** Prometheus text format. */
export function metrics(health: Iterable<PoolHealth>): string {
  const lines = [
    "# TYPE afterbell_keeper_updates_total counter",
    "# TYPE afterbell_keeper_failures_total counter",
    "# TYPE afterbell_keeper_last_success_seconds gauge",
  ];
  for (const h of health) {
    const l = `{pool="${h.name}"}`;
    lines.push(`afterbell_keeper_updates_total${l} ${h.successes}`);
    lines.push(`afterbell_keeper_failures_total${l} ${h.failures}`);
    lines.push(`afterbell_keeper_last_success_seconds${l} ${h.lastSuccessMs ? h.lastSuccessMs / 1000 : 0}`);
  }
  return `${lines.join("\n")}\n`;
}
