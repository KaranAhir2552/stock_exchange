"use client";
// Demo-only transactions, signed by the devnet admin key the presenter loads into the page (kept in memory,
// never stored or sent anywhere). Only reachable from /demo, which exists only when features.demoControls.
import {
  type AfterbellClient,
  AfterbellError,
  type Direction,
  feedIdBytes,
  quoteSwap,
  US_EQUITY_PROFILE_ID,
} from "@afterbell/sdk";
import { EventParser } from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { demoTimeline, demoWeekSessions, largestOk } from "./demo-plan";
import type { Market } from "./market";
import { poolNow } from "./market";
import { explainError } from "./tx";

export interface SentTx {
  sig: string;
  events: { name: string; data: Record<string, unknown> }[];
}

export class DemoAdmin {
  readonly client: AfterbellClient;
  readonly kp: Keypair;
  constructor(client: AfterbellClient, kp: Keypair) {
    this.client = client;
    this.kp = kp;
  }

  private async build(ixs: TransactionInstruction[]) {
    const c = this.client.connection;
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs);
    const latest = await c.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = this.kp.publicKey;
    tx.sign(this.kp);
    return { tx, latest };
  }

  /** Sends, confirms, and returns the program events the transaction emitted. */
  async send(ixs: TransactionInstruction[]): Promise<SentTx> {
    const c = this.client.connection;
    const { tx, latest } = await this.build(ixs);
    const sig = await c.sendRawTransaction(tx.serialize());
    const res = await c.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
    // The confirmed transaction can take a moment to be readable.
    for (let i = 0; i < 6; i++) {
      const t = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (t?.meta?.logMessages) {
        const parser = new EventParser(this.client.programId, this.client.program.coder);
        return { sig, events: [...parser.parseLogs(t.meta.logMessages)].map((e) => ({ name: e.name, data: e.data })) };
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return { sig, events: [] };
  }

  /** Dry-runs instructions on the cluster: the program's error name if it would fail, else null. */
  async wouldFail(ixs: TransactionInstruction[]): Promise<string | null> {
    const { tx } = await this.build(ixs);
    const sim = await this.client.connection.simulateTransaction(tx);
    if (!sim.value.err) return null;
    return explainError(
      new Error(`${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).join(" ")}`),
      this.client.program.idl.errors,
    );
  }

  // ---------- building blocks ----------

  private feed(m: Market) {
    return feedIdBytes(m.meta.cfg.feedId);
  }

  /** Moves this feed's simulated clock so it reads `target` (plus the seconds it takes to land). */
  advanceTo(m: Market, target: bigint) {
    const delta = target - poolNow(m);
    if (delta <= 0n) throw new Error("the simulated clock only moves forward");
    return this.client.mockAdvanceClock(this.kp.publicKey, this.feed(m), delta);
  }

  /** Publishes a mock oracle price (in USD) stamped at the feed's simulated time. */
  setPrice(m: Market, usd: number) {
    const expo = m.mock?.expo ?? -8;
    const raw = BigInt(Math.round(usd * 10 ** -expo));
    return this.client.mockSetPrice(this.kp.publicKey, this.feed(m), raw, 0n, expo);
  }

  update(m: Market) {
    return this.client.updateReference(m.info.accounts);
  }

  /** Test tokens straight from the (admin-owned) test mint. */
  mint(mint: PublicKey, program: PublicKey, to: PublicKey, amount: bigint) {
    const ata = getAssociatedTokenAddressSync(mint, to, true, program);
    return [
      createAssociatedTokenAccountIdempotentInstruction(this.kp.publicKey, ata, to, mint, program),
      createMintToInstruction(mint, ata, this.kp.publicKey, amount, [], program),
    ];
  }

  // ---------- the story ----------

  /** Reset: a fresh holiday-free week, market open Monday 09:30 at `startUsd`, any halt lifted. */
  async startWeek(m: Market, startUsd: number) {
    const { sessions } = demoWeekSessions(poolNow(m));
    const t = demoTimeline(sessions);
    const ixs = [
      ...(m.info.state.halted ? [await this.client.setHalt(this.kp.publicKey, m.meta.address, false)] : []),
      await this.advanceTo(m, t.weekStart + 5n),
      await this.client.setSessions(this.kp.publicKey, sessions, t.weekEnd, US_EQUITY_PROFILE_ID),
      ...(m.mock && m.mock.status !== "Trading"
        ? [await this.client.mockSetStatus(this.kp.publicKey, this.feed(m), "Trading")]
        : []),
      await this.setPrice(m, startUsd),
      await this.update(m),
    ];
    return this.send(ixs);
  }

  /** Friday 15:59 last official price, then 16:00: the pool closes and the band clock starts. */
  async fridayClose(m: Market, t: ReturnType<typeof demoTimeline>, priceUsd: number) {
    return this.send([
      await this.advanceTo(m, t.lastPrice),
      await this.setPrice(m, priceUsd),
      await this.update(m),
      await this.client.mockAdvanceClock(this.kp.publicKey, this.feed(m), 60n),
      await this.update(m),
    ]);
  }

  /** Saturday: the (mock) oracle moves on news. The closed pool ignores it. */
  async news(m: Market, t: ReturnType<typeof demoTimeline>, newsUsd: number) {
    return this.send([await this.advanceTo(m, t.news), await this.setPrice(m, newsUsd), await this.update(m)]);
  }

  /**
   * An informed trader who knows the news trades toward it as far as the band allows (95% of the largest
   * amount the SDK says fits, so a few seconds of clock drift can't push it out). Returns the swap and a
   * dry run of a further trade, which the program rejects.
   */
  async informedTrade(m: Market, direction: Direction) {
    if (!m.ctx) throw new Error("no market context");
    const ctx = { ...m.ctx, now: poolNow(m) };
    const a = m.info.accounts;
    const sell = direction === "BaseToQuote";
    const hi = sell ? m.reserves.base : m.reserves.quote;
    const fits = (x: bigint) => {
      try {
        quoteSwap(m.info.state, m.reserves, x, direction, ctx);
        return true;
      } catch (e) {
        if (e instanceof AfterbellError) return false;
        throw e;
      }
    };
    const edge = largestOk(hi, fits);
    const amount = (edge * 95n) / 100n;
    if (amount === 0n) throw new Error("the band leaves no room to trade");
    const [mint, program] = sell ? [a.baseMint, a.baseTokenProgram] : [a.quoteMint, a.quoteTokenProgram];
    const [outMint, outProgram] = sell ? [a.quoteMint, a.quoteTokenProgram] : [a.baseMint, a.baseTokenProgram];
    const me = this.kp.publicKey;
    const outAta = getAssociatedTokenAddressSync(outMint, me, true, outProgram);
    const swap = await this.send([
      ...this.mint(mint, program, me, amount),
      createAssociatedTokenAccountIdempotentInstruction(me, outAta, me, outMint, outProgram),
      await this.client.swap(a, me, amount, 1n, direction),
    ]);
    // A second, bigger trade in the same direction: the program refuses it (dry run, nothing is sent).
    const more = amount / 2n;
    const rejected = await this.wouldFail([
      ...this.mint(mint, program, me, more),
      await this.client.swap(a, me, more, 1n, direction),
    ]);
    return { swap, amount, rejected };
  }

  /** Sunday: the exchange halts the stock. Proves swaps stop and a withdrawal still works. */
  async halt(m: Market, t: ReturnType<typeof demoTimeline>) {
    const me = this.kp.publicKey;
    const a = m.info.accounts;
    const halted = await this.send([
      await this.advanceTo(m, t.halt),
      await this.client.setHalt(me, m.meta.address, true),
    ]);
    const small = 10n ** BigInt(m.info.state.quoteDecimals); // 1 USDC
    const swapBlocked = await this.wouldFail([
      ...this.mint(a.quoteMint, a.quoteTokenProgram, me, small),
      await this.client.swap(a, me, small, 1n, "QuoteToBase"),
    ]);
    // The admin seeded the pool, so it holds LP tokens: withdraw a sliver of them for real.
    const lpAta = getAssociatedTokenAddressSync(a.lpMint, me, true);
    const lpBal = BigInt((await this.client.connection.getTokenAccountBalance(lpAta)).value.amount);
    const withdrawal =
      lpBal > 0n ? await this.send([await this.client.withdraw(a, me, lpBal / 10_000n || 1n, 0n, 0n)]) : null;
    return { halted, swapBlocked, withdrawal };
  }

  async haltEnds(m: Market, t: ReturnType<typeof demoTimeline>) {
    return this.send([
      await this.advanceTo(m, t.haltEnds),
      await this.client.setHalt(this.kp.publicKey, m.meta.address, false),
      await this.update(m),
    ]);
  }

  /** Monday 09:30: a fresh official price, and the pool jumps straight to it. */
  async mondayOpen(m: Market, t: ReturnType<typeof demoTimeline>, priceUsd: number) {
    return this.send([
      await this.advanceTo(m, t.mondayOpen + 5n),
      await this.setPrice(m, priceUsd),
      await this.update(m),
    ]);
  }

  /** Test tokens for a tester's own wallet, so they can swap and add liquidity themselves. */
  async fundWallet(markets: Market[], to: PublicKey) {
    const seen = new Set<string>();
    const ixs: TransactionInstruction[] = [];
    for (const m of markets) {
      const a = m.info.accounts;
      for (const [mint, program, dec, whole] of [
        [a.quoteMint, a.quoteTokenProgram, m.info.state.quoteDecimals, 1_000n],
        [a.baseMint, a.baseTokenProgram, m.info.state.baseDecimals, 5n],
      ] as const) {
        if (seen.has(mint.toBase58())) continue;
        seen.add(mint.toBase58());
        ixs.push(...this.mint(mint, program, to, whole * 10n ** BigInt(dec)));
      }
    }
    return this.send(ixs);
  }
}
