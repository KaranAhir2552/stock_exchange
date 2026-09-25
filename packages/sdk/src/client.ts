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
import { mockOraclePrice } from "./mode.ts";

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
}

export class AfterbellClient {
  readonly program: Program<Afterbell>;

  /** `provider` only needs a connection for reads; builders never sign. */
  constructor(provider: Provider, programId: PublicKey) {
    this.program = new Program<Afterbell>({ ...(idlJson as Afterbell), address: programId.toBase58() }, provider);
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
    const p = await this.program.account.pool.fetch(address);
    const params = Object.fromEntries(
      Object.entries(p.params).map(([k, v]) => [k, k === "maxTvlQuote" ? big(v as BN) : Number(v)]),
    ) as unknown as PoolParams;
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

  async fetchCalendar(address: PublicKey): Promise<Calendar> {
    const c = await this.program.account.marketCalendar.fetch(address);
    return {
      sessions: c.sessions.slice(0, c.sessionCount).map((x) => ({ openTs: big(x.openTs), closeTs: big(x.closeTs) })),
      validUntil: big(c.validUntil),
    };
  }

  async fetchMockOracle(address: PublicKey): Promise<MockOracleState> {
    const m = await this.program.account.mockOracle.fetch(address);
    return {
      price: big(m.price),
      conf: big(m.conf),
      expo: m.expo,
      publishTs: big(m.publishTs),
      status: variant<OracleStatus>(m.status),
    };
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

  /** Everything `refresh` reads, for mock-oracle pools. */
  async mockMarketContext(pool: PoolInfo): Promise<MarketContext> {
    const [globalPause, calendar, oracle, now] = await Promise.all([
      this.fetchGlobalPause(),
      pool.accounts.calendar ? this.fetchCalendar(pool.accounts.calendar) : null,
      this.fetchMockOracle(this.mockOracle(pool.accounts)),
      this.chainTime(),
    ]);
    return { globalPause, calendar, oracle: mockOraclePrice(pool.state, oracle), now };
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
    const { maxTvlQuote, ...rest } = a.params;
    return this.m()
      .createPool({
        profile: enumArg(a.profile),
        oracleKind: enumArg(a.oracleKind),
        feedId: Array.from(a.feedId),
        maxStalenessSecs: a.maxStalenessSecs,
        maxConfBps: a.maxConfBps,
        params: { ...rest, maxTvlQuote: bn(maxTvlQuote) },
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

  updateReference(pool: PoolAccounts, oracle: PublicKey = this.mockOracle(pool)) {
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
    oracle = this.mockOracle(pool),
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
        oracle: opts.oracle ?? this.mockOracle(pool),
        calendar: pool.calendar,
        treasuryToken: opts.treasuryToken ?? null,
      })
      .instruction();
  }

  setParams(admin: PublicKey, pool: PublicKey, params: PoolParams) {
    const { maxTvlQuote, ...rest } = params;
    return this.m()
      .setParams({ ...rest, maxTvlQuote: bn(maxTvlQuote) })
      .accountsPartial({ admin, config: this.config, pool })
      .instruction();
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
}

export type { TransactionInstruction };
