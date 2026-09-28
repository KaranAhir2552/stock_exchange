import { BN, Program, type Provider } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  type Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "./idl/afterbell.json" with { type: "json" };
import type { Afterbell } from "./idl/afterbell.ts";
import type { Direction } from "./math.ts";
import type { Calendar, MarketContext, MarketProfile, Mode, OracleStatus, PoolParams, PoolState } from "./mode.ts";
import { mockOraclePrice, refresh } from "./mode.ts";
import { pythFeedAccount, pythOraclePrice } from "./pyth.ts";

export const SEEDS = {
  config: "config",
  pool: "pool",
  vault: "vault",
  lp: "lp",
  calendar: "calendar",
  mockOracle: "mock_oracle",
} as const;

const pda = (programId: PublicKey, ...seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];
const s = (x: string) => Buffer.from(x);

export const configPda = (programId: PublicKey) => pda(programId, s(SEEDS.config));
export const poolPda = (programId: PublicKey, base: PublicKey, quote: PublicKey) =>
  pda(programId, s(SEEDS.pool), base.toBuffer(), quote.toBuffer());
export const vaultPda = (programId: PublicKey, pool: PublicKey, mint: PublicKey) =>
  pda(programId, s(SEEDS.vault), pool.toBuffer(), mint.toBuffer());
export const lpMintPda = (programId: PublicKey, pool: PublicKey) => pda(programId, s(SEEDS.lp), pool.toBuffer());
export const calendarPda = (programId: PublicKey, profileId: number) =>
  pda(programId, s(SEEDS.calendar), Uint8Array.of(profileId));
export const mockOraclePda = (programId: PublicKey, feedId: Uint8Array) => pda(programId, s(SEEDS.mockOracle), feedId);

export const US_EQUITY_PROFILE_ID = 1;

export function feedIdBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`bad feed id ${hex}`);
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

// Anchor enums decode as { open: {} }; the SDK uses "Open".
const variant = <T extends string>(e: object) => {
  const k = Object.keys(e)[0];
  return (k[0].toUpperCase() + k.slice(1)) as T;
};
const enumArg = (v: string) => ({ [v[0].toLowerCase() + v.slice(1)]: {} }) as never;
const big = (x: BN | number) => BigInt(x.toString());
const bn = (x: bigint | number) => new BN(x.toString());

/**
 * SDK PoolParams <-> the IDL's field names. Explicit on purpose: Anchor camel-cases
 * `size_fee_bps_per_1pct_depth` as `sizeFeeBpsPer1pctDepth`, and its encoder silently writes 0
 * for a missing field. Every field is checked, so a mismatch throws instead of zeroing a parameter.
 */
export function toIdlParams(p: PoolParams) {
  const out = {
    openBandBps: p.openBandBps,
    closedBaseBandBps: p.closedBaseBandBps,
    closedBandGrowthBpsPerHour: p.closedBandGrowthBpsPerHour,
    closedMaxBandBps: p.closedMaxBandBps,
    openFeeBps: p.openFeeBps,
    closedBaseFeeBps: p.closedBaseFeeBps,
    closedFeeGrowthBpsPerHour: p.closedFeeGrowthBpsPerHour,
    closedMaxFeeBps: p.closedMaxFeeBps,
    sizeFeeBpsPer1pctDepth: p.sizeFeeBpsPer1PctDepth,
    depthBps: p.depthBps,
  };
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isInteger(v) || v < 0 || v > 65_535) throw new Error(`pool param ${k} must be a u16, got ${v}`);
  }
  if (typeof p.maxTvlQuote !== "bigint" || p.maxTvlQuote < 0n)
    throw new Error("pool param maxTvlQuote must be a u64 bigint");
  return { ...out, maxTvlQuote: bn(p.maxTvlQuote) };
}

export function fromIdlParams(raw: ReturnType<typeof toIdlParams>): PoolParams {
  return {
    openBandBps: raw.openBandBps,
    closedBaseBandBps: raw.closedBaseBandBps,
    closedBandGrowthBpsPerHour: raw.closedBandGrowthBpsPerHour,
    closedMaxBandBps: raw.closedMaxBandBps,
    openFeeBps: raw.openFeeBps,
    closedBaseFeeBps: raw.closedBaseFeeBps,
    closedFeeGrowthBpsPerHour: raw.closedFeeGrowthBpsPerHour,
    closedMaxFeeBps: raw.closedMaxFeeBps,
    sizeFeeBpsPer1PctDepth: raw.sizeFeeBpsPer1pctDepth,
    depthBps: raw.depthBps,
    maxTvlQuote: big(raw.maxTvlQuote),
  };
}

/** Addresses a pool instruction needs, from the decoded Pool account. */
export interface PoolAccounts {
  address: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  lpMint: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  calendar: PublicKey | null;
  oracleKind: "Pyth" | "Mock";
  feedId: Uint8Array;
}

export interface PoolInfo {
  accounts: PoolAccounts;
  state: PoolState;
}

export interface MockOracleState {
  price: bigint;
  conf: bigint;
  expo: number;
  publishTs: bigint;
  status: OracleStatus;
  /** Seconds this feed's pools run ahead of real time (devnet demo week; 0 otherwise). */
  clockOffset: bigint;
}

/** One pool as a UI sees it; see `fetchMarkets`. */
export interface MarketSnapshot {
  info: PoolInfo;
  reserves: { base: bigint; quote: bigint };
  lpSupply: bigint;
  chainNow: bigint;
  mock: MockOracleState | null;
  /** What `refresh` would read now (mock oracle, or the Pyth feed account). `ctx.now` is the pool's clock. */
  ctx: MarketContext | null;
  /** The pool as the program would see it after `refresh` right now (on-chain state if `ctx` is null). */
  live: PoolState;
}

/** Pyth program addresses from config (`pythPushOracleProgramId`, `pythReceiverProgramId`). */
export interface PythPrograms {
  pushOracle: PublicKey;
  receiver: PublicKey;
}

export class AfterbellClient {
  readonly program: Program<Afterbell>;
  readonly pyth: PythPrograms | null;

  /** `provider` only needs a connection for reads; builders never sign. `pyth` is needed for Pyth pools. */
  constructor(provider: Provider, programId: PublicKey, pyth: PythPrograms | null = null) {
    this.program = new Program<Afterbell>({ ...(idlJson as Afterbell), address: programId.toBase58() }, provider);
    this.pyth = pyth;
  }

  get programId(): PublicKey {
    return this.program.programId;
  }
  get connection(): Connection {
    return this.program.provider.connection;
  }
  get config(): PublicKey {
    return configPda(this.programId);
  }

  // ---------- reads ----------

  async fetchPool(address: PublicKey): Promise<PoolInfo> {
    return this.decodePool(address, await this.accountData(address));
  }

  async fetchCalendar(address: PublicKey): Promise<Calendar> {
    return this.decodeCalendar(await this.accountData(address));
  }

  async fetchMockOracle(address: PublicKey): Promise<MockOracleState> {
    return this.decodeMockOracle(await this.accountData(address));
  }

  private async accountData(address: PublicKey): Promise<Buffer> {
    const acc = await this.connection.getAccountInfo(address);
    if (!acc) throw new Error(`account ${address.toBase58()} not found`);
    return acc.data;
  }

  // ---------- decoders (raw account data -> SDK types) ----------

  decodePool(address: PublicKey, data: Buffer): PoolInfo {
    const p = this.program.coder.accounts.decode("pool", data);
    const params = fromIdlParams(p.params);
    return {
      accounts: {
        address,
        baseMint: p.baseMint,
        quoteMint: p.quoteMint,
        baseVault: p.baseVault,
        quoteVault: p.quoteVault,
        lpMint: p.lpMint,
        baseTokenProgram: p.baseTokenProgram,
        quoteTokenProgram: p.quoteTokenProgram,
        calendar: p.calendar.equals(PublicKey.default) ? null : p.calendar,
        oracleKind: variant(p.oracleKind),
        feedId: Uint8Array.from(p.feedId),
      },
      state: {
        profile: variant<MarketProfile>(p.profile),
        mode: variant<Mode>(p.mode),
        halted: p.halted,
        poolPrice: big(p.poolPrice),
        referencePrice: big(p.referencePrice),
        closeTs: big(p.closeTs),
        lastOraclePublishTs: big(p.lastOraclePublishTs),
        maxStalenessSecs: p.maxStalenessSecs,
        maxConfBps: p.maxConfBps,
        baseDecimals: p.baseDecimals,
        quoteDecimals: p.quoteDecimals,
        params,
      },
    };
  }

  decodeCalendar(data: Buffer): Calendar {
    const c = this.program.coder.accounts.decode("marketCalendar", data);
    return {
      sessions: c.sessions
        .slice(0, c.sessionCount)
        .map((x: { openTs: BN; closeTs: BN }) => ({ openTs: big(x.openTs), closeTs: big(x.closeTs) })),
      validUntil: big(c.validUntil),
    };
  }

  decodeMockOracle(data: Buffer): MockOracleState {
    const m = this.program.coder.accounts.decode("mockOracle", data);
    return {
      price: big(m.price),
      conf: big(m.conf),
      expo: m.expo,
      publishTs: big(m.publishTs),
      status: variant<OracleStatus>(m.status),
      clockOffset: big(m.clockOffset),
    };
  }

  /**
   * Everything a UI shows about some pools, in two batched RPC calls: each pool's on-chain state,
   * reserves, and (for mock-oracle pools) the market context and the state `refresh` would produce
   * right now (`live`), so mode/band/fee are current even between keeper updates.
   */
  async fetchMarkets(addresses: PublicKey[]): Promise<MarketSnapshot[]> {
    const first = await this.connection.getMultipleAccountsInfo([this.config, SYSVAR_CLOCK_PUBKEY, ...addresses]);
    const [cfgAcc, clockAcc, ...poolAccs] = first;
    if (!cfgAcc || !clockAcc) throw new Error("config or clock account missing");
    const globalPause = this.program.coder.accounts.decode("globalConfig", cfgAcc.data).globalPause as boolean;
    const chainNow = clockAcc.data.readBigInt64LE(32);
    const pools = poolAccs.map((a, i) => {
      if (!a) throw new Error(`pool ${addresses[i].toBase58()} not found`);
      return this.decodePool(addresses[i], a.data);
    });
    const extra = pools.flatMap((p) => [
      p.accounts.baseVault,
      p.accounts.quoteVault,
      p.accounts.lpMint,
      p.accounts.oracleKind === "Mock" || this.pyth ? this.oracleFor(p.accounts) : p.accounts.baseVault,
      p.accounts.calendar ?? p.accounts.baseVault,
    ]);
    const second = await this.connection.getMultipleAccountsInfo(extra);
    return pools.map((info, i) => {
      const [bv, qv, lp, oracleAcc, calAcc] = second.slice(i * 5, i * 5 + 5);
      const amount = (a: typeof bv) => (a ? a.data.readBigUInt64LE(64) : 0n);
      const reserves = { base: amount(bv), quote: amount(qv) };
      const lpSupply = lp ? lp.data.readBigUInt64LE(36) : 0n;
      const calendar = info.accounts.calendar && calAcc ? this.decodeCalendar(calAcc.data) : null;
      const onChain = { info, reserves, lpSupply, chainNow, mock: null, ctx: null, live: info.state };
      if (!oracleAcc) return onChain;
      if (info.accounts.oracleKind === "Mock") {
        const mock = this.decodeMockOracle(oracleAcc.data);
        const ctx: MarketContext = {
          globalPause,
          calendar,
          oracle: mockOraclePrice(info.state, mock),
          now: chainNow + mock.clockOffset,
        };
        return { ...onChain, mock, ctx, live: refresh(info.state, ctx) };
      }
      if (!this.pyth) return onChain;
      // An account `read_pyth` would reject means the next refresh errors; show the on-chain state then.
      const oracle = pythOraclePrice(info.state, info.accounts.feedId, oracleAcc, this.pyth.receiver);
      if (!oracle || oracle.publishTs < info.state.lastOraclePublishTs) return onChain;
      const ctx: MarketContext = { globalPause, calendar, oracle, now: chainNow };
      return { ...onChain, ctx, live: refresh(info.state, ctx) };
    });
  }

  async fetchGlobalPause(): Promise<boolean> {
    return (await this.program.account.globalConfig.fetch(this.config)).globalPause;
  }

  /** Cluster time from the Clock sysvar (unix_timestamp at offset 32). */
  async chainTime(): Promise<bigint> {
    const acc = await this.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!acc) throw new Error("clock sysvar unavailable");
    return acc.data.readBigInt64LE(32);
  }

  async reserves(pool: PoolAccounts): Promise<{ base: bigint; quote: bigint }> {
    const [b, q] = await Promise.all([
      this.connection.getTokenAccountBalance(pool.baseVault),
      this.connection.getTokenAccountBalance(pool.quoteVault),
    ]);
    return { base: BigInt(b.value.amount), quote: BigInt(q.value.amount) };
  }

  mockOracle(pool: PoolAccounts): PublicKey {
    return mockOraclePda(this.programId, pool.feedId);
  }

  /** The oracle account a pool instruction reads: the mock oracle, or the Pyth push-oracle feed account. */
  oracleFor(pool: PoolAccounts): PublicKey {
    if (pool.oracleKind === "Mock") return this.mockOracle(pool);
    if (!this.pyth) throw new Error("Pyth pool: construct AfterbellClient with the Pyth program addresses");
    return pythFeedAccount(this.pyth.pushOracle, pool.feedId);
  }

  /** Everything `refresh` reads, for mock-oracle pools. `now` is the pool's clock (chain time + offset). */
  async mockMarketContext(pool: PoolInfo): Promise<MarketContext> {
    const [globalPause, calendar, oracle, now] = await Promise.all([
      this.fetchGlobalPause(),
      pool.accounts.calendar ? this.fetchCalendar(pool.accounts.calendar) : null,
      this.fetchMockOracle(this.mockOracle(pool.accounts)),
      this.chainTime(),
    ]);
    return { globalPause, calendar, oracle: mockOraclePrice(pool.state, oracle), now: now + oracle.clockOffset };
  }

  // ---------- instruction builders (unsigned) ----------

  private m() {
    return this.program.methods;
  }

  initializeConfig(
    payer: PublicKey,
    admin: PublicKey,
    guardian: PublicKey,
    treasury: PublicKey,
    protocolFeeBps: number,
  ) {
    const programData = PublicKey.findProgramAddressSync(
      [this.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
    return this.m()
      .initializeConfig(admin, guardian, treasury, protocolFeeBps)
      .accountsPartial({ payer, config: this.config, program: this.programId, programData })
      .instruction();
  }

  createCalendar(admin: PublicKey, profileId = US_EQUITY_PROFILE_ID) {
    return this.m()
      .createCalendar(profileId)
      .accountsPartial({ admin, config: this.config, calendar: calendarPda(this.programId, profileId) })
      .instruction();
  }

  setSessions(admin: PublicKey, sessions: { openTs: bigint; closeTs: bigint }[], validUntil: bigint, profileId = 1) {
    return this.m()
      .setSessions(
        sessions.map((x) => ({ openTs: bn(x.openTs), closeTs: bn(x.closeTs) })),
        bn(validUntil),
      )
      .accountsPartial({ admin, config: this.config, calendar: calendarPda(this.programId, profileId) })
      .instruction();
  }

  createPool(
    admin: PublicKey,
    a: {
      baseMint: PublicKey;
      quoteMint: PublicKey;
      baseTokenProgram?: PublicKey;
      quoteTokenProgram?: PublicKey;
      profile: MarketProfile;
      oracleKind: "Pyth" | "Mock";
      feedId: Uint8Array;
      oracle: PublicKey;
      maxStalenessSecs: number;
      maxConfBps: number;
      params: PoolParams;
    },
  ) {
    const pool = poolPda(this.programId, a.baseMint, a.quoteMint);
    return this.m()
      .createPool({
        profile: enumArg(a.profile),
        oracleKind: enumArg(a.oracleKind),
        feedId: Array.from(a.feedId),
        maxStalenessSecs: a.maxStalenessSecs,
        maxConfBps: a.maxConfBps,
        params: toIdlParams(a.params),
      })
      .accountsPartial({
        admin,
        config: this.config,
        pool,
        baseMint: a.baseMint,
        quoteMint: a.quoteMint,
        baseVault: vaultPda(this.programId, pool, a.baseMint),
        quoteVault: vaultPda(this.programId, pool, a.quoteMint),
        lpMint: lpMintPda(this.programId, pool),
        oracle: a.oracle,
        calendar: a.profile === "UsEquity" ? calendarPda(this.programId, US_EQUITY_PROFILE_ID) : null,
        baseTokenProgram: a.baseTokenProgram ?? TOKEN_PROGRAM_ID,
        quoteTokenProgram: a.quoteTokenProgram ?? TOKEN_PROGRAM_ID,
        lpTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  updateReference(pool: PoolAccounts, oracle: PublicKey = this.oracleFor(pool)) {
    return this.m()
      .updateReference()
      .accountsPartial({
        config: this.config,
        pool: pool.address,
        baseMint: pool.baseMint,
        oracle,
        calendar: pool.calendar,
      })
      .instruction();
  }

  /** User's ATAs for base, quote, LP. */
  userAccounts(pool: PoolAccounts, user: PublicKey) {
    return {
      userBase: getAssociatedTokenAddressSync(pool.baseMint, user, true, pool.baseTokenProgram),
      userQuote: getAssociatedTokenAddressSync(pool.quoteMint, user, true, pool.quoteTokenProgram),
      userLp: getAssociatedTokenAddressSync(pool.lpMint, user, true, TOKEN_PROGRAM_ID),
    };
  }

  private poolCommon(pool: PoolAccounts) {
    return {
      pool: pool.address,
      baseMint: pool.baseMint,
      quoteMint: pool.quoteMint,
      baseVault: pool.baseVault,
      quoteVault: pool.quoteVault,
      baseTokenProgram: pool.baseTokenProgram,
      quoteTokenProgram: pool.quoteTokenProgram,
    };
  }

  deposit(
    pool: PoolAccounts,
    user: PublicKey,
    maxBase: bigint,
    maxQuote: bigint,
    minLp: bigint,
    oracle = this.oracleFor(pool),
  ) {
    return this.m()
      .deposit(bn(maxBase), bn(maxQuote), bn(minLp))
      .accountsPartial({
        user,
        config: this.config,
        ...this.poolCommon(pool),
        lpMint: pool.lpMint,
        ...this.userAccounts(pool, user),
        oracle,
        calendar: pool.calendar,
        lpTokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  withdraw(pool: PoolAccounts, user: PublicKey, lp: bigint, minBase: bigint, minQuote: bigint) {
    return this.m()
      .withdraw(bn(lp), bn(minBase), bn(minQuote))
      .accountsPartial({
        user,
        ...this.poolCommon(pool),
        lpMint: pool.lpMint,
        ...this.userAccounts(pool, user),
        lpTokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  swap(
    pool: PoolAccounts,
    user: PublicKey,
    amountIn: bigint,
    minOut: bigint,
    direction: Direction,
    opts: { oracle?: PublicKey; treasuryToken?: PublicKey } = {},
  ) {
    const { userBase, userQuote } = this.userAccounts(pool, user);
    return this.m()
      .swap(bn(amountIn), bn(minOut), enumArg(direction))
      .accountsPartial({
        user,
        config: this.config,
        ...this.poolCommon(pool),
        userBase,
        userQuote,
        oracle: opts.oracle ?? this.oracleFor(pool),
        calendar: pool.calendar,
        treasuryToken: opts.treasuryToken ?? null,
      })
      .instruction();
  }

  setParams(admin: PublicKey, pool: PublicKey, params: PoolParams) {
    return this.m().setParams(toIdlParams(params)).accountsPartial({ admin, config: this.config, pool }).instruction();
  }

  setHalt(authority: PublicKey, pool: PublicKey, halted: boolean) {
    return this.m().setHalt(halted).accountsPartial({ authority, config: this.config, pool }).instruction();
  }

  setGlobalPause(authority: PublicKey, paused: boolean) {
    return this.m().setGlobalPause(paused).accountsPartial({ authority, config: this.config }).instruction();
  }

  /** devnet-mock builds only. */
  mockSetPrice(admin: PublicKey, feedId: Uint8Array, price: bigint, conf: bigint, expo: number) {
    return this.m()
      .mockSetPrice(Array.from(feedId), bn(price), bn(conf), expo)
      .accountsPartial({ admin, config: this.config, mockOracle: mockOraclePda(this.programId, feedId) })
      .instruction();
  }

  /** devnet-mock builds only. */
  mockSetStatus(admin: PublicKey, feedId: Uint8Array, status: OracleStatus) {
    return this.m()
      .mockSetStatus(enumArg(status))
      .accountsPartial({ admin, config: this.config, mockOracle: mockOraclePda(this.programId, feedId) })
      .instruction();
  }

  /** Devnet keeper heartbeat: marks the current mock price fresh without rewriting it (admin, devnet-mock only). */
  mockHeartbeat(admin: PublicKey, feedId: Uint8Array) {
    return this.m()
      .mockHeartbeat()
      .accountsPartial({ admin, config: this.config, mockOracle: mockOraclePda(this.programId, feedId) })
      .instruction();
  }

  /** Demo week: moves this feed's simulated clock forward (admin, devnet-mock builds only). */
  mockAdvanceClock(admin: PublicKey, feedId: Uint8Array, seconds: bigint) {
    return this.m()
      .mockAdvanceClock(bn(seconds))
      .accountsPartial({ admin, config: this.config, mockOracle: mockOraclePda(this.programId, feedId) })
      .instruction();
  }
}

export type { TransactionInstruction };
