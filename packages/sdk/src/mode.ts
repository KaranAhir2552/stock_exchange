// Mirror of programs/afterbell/src/mode.rs plus the read helpers the UI needs.
import {
  AfterbellError,
  type Direction,
  type FeeRule,
  flatFee,
  growBps,
  oracleToPoolPrice,
  quoteSwapRaw,
  type SwapQuote,
  confBps as toConfBps,
  withinBand,
} from "./math.ts";

export type Mode = "Open" | "Closed" | "Paused";
export type MarketProfile = "AlwaysOpen" | "UsEquity";
export type OracleStatus = "Trading" | "Halted" | "Closed";

export interface PoolParams {
  openBandBps: number;
  closedBaseBandBps: number;
  closedBandGrowthBpsPerHour: number;
  closedMaxBandBps: number;
  openFeeBps: number;
  closedBaseFeeBps: number;
  closedFeeGrowthBpsPerHour: number;
  closedMaxFeeBps: number;
  sizeFeeBpsPer1PctDepth: number;
  depthBps: number;
  maxTvlQuote: bigint;
}

/** The pool fields the math needs (a decoded `Pool` account has more). */
export interface PoolState {
  profile: MarketProfile;
  mode: Mode;
  halted: boolean;
  poolPrice: bigint;
  referencePrice: bigint;
  closeTs: bigint;
  lastOraclePublishTs: bigint;
  maxStalenessSecs: number;
  maxConfBps: number;
  baseDecimals: number;
  quoteDecimals: number;
  params: PoolParams;
}

export interface OraclePrice {
  price: bigint;
  confBps: number;
  publishTs: bigint;
  statusHint: OracleStatus | null;
}

export interface Calendar {
  sessions: { openTs: bigint; closeTs: bigint }[];
  validUntil: bigint;
}

/** Everything `refresh` reads besides the pool. */
export interface MarketContext {
  globalPause: boolean;
  calendar: Calendar | null;
  oracle: OraclePrice;
  now: bigint;
}

/** Mock oracle account fields -> OraclePrice (multiplier 1; SPL mints have no UI scaling). */
export function mockOraclePrice(
  pool: Pick<PoolState, "baseDecimals" | "quoteDecimals">,
  m: { price: bigint; conf: bigint; expo: number; publishTs: bigint; status: OracleStatus },
): OraclePrice {
  return {
    price: oracleToPoolPrice(m.price, m.expo, pool.baseDecimals, pool.quoteDecimals),
    confBps: toConfBps(m.conf, m.price),
    publishTs: m.publishTs,
    statusHint: m.status,
  };
}

export const isOracleValid = (pool: PoolState, o: OraclePrice, now: bigint) =>
  now - o.publishTs <= BigInt(pool.maxStalenessSecs) && o.confBps <= pool.maxConfBps;

export const inSession = (c: Calendar, now: bigint) =>
  now < c.validUntil && c.sessions.some((s) => s.openTs <= now && now < s.closeTs);

const lastClose = (c: Calendar, now: bigint) =>
  [...c.sessions].reverse().find((s) => s.closeTs <= now)?.closeTs ?? null;

/** Mode the pool will be in after the next refresh (what a swap would see). */
export function targetMode(pool: PoolState, ctx: MarketContext): Mode {
  const { oracle, now } = ctx;
  if (ctx.globalPause || pool.halted || oracle.statusHint === "Halted") return "Paused";
  const valid = isOracleValid(pool, oracle, now);
  let mode: Mode;
  if (pool.profile === "AlwaysOpen") mode = valid ? "Open" : "Paused";
  else {
    if (!ctx.calendar) throw new AfterbellError("MissingCalendar");
    mode = inSession(ctx.calendar, now) ? (valid ? "Open" : "Paused") : "Closed";
  }
  return mode === "Closed" && pool.referencePrice === 0n ? "Paused" : mode;
}

/** The pool state after `refresh` (mirrors mode.rs::refresh). */
export function refresh(pool: PoolState, ctx: MarketContext): PoolState {
  const { oracle, now } = ctx;
  if (oracle.publishTs < pool.lastOraclePublishTs) throw new AfterbellError("StaleOracle");
  const target = targetMode(pool, ctx);
  const next = { ...pool };
  if (target === "Open" && (pool.mode !== "Open" || oracle.publishTs > pool.lastOraclePublishTs)) {
    next.referencePrice = oracle.price;
    next.poolPrice = oracle.price;
    next.lastOraclePublishTs = oracle.publishTs;
  } else if (target === "Closed" && pool.mode !== "Closed") {
    const close = ctx.calendar ? lastClose(ctx.calendar, now) : null;
    next.closeTs = close !== null && close < pool.lastOraclePublishTs ? close : pool.lastOraclePublishTs;
  }
  next.mode = target;
  return next;
}

/** Fee rule and band (bps) in the pool's current mode (mirrors mode.rs::trading_terms). */
export function tradingTerms(pool: PoolState, now: bigint): { fee: FeeRule; bandBps: number } {
  const p = pool.params;
  if (pool.mode === "Paused") throw new AfterbellError("PoolPaused");
  if (pool.mode === "Open") return { fee: flatFee(p.openFeeBps), bandBps: p.openBandBps };
  const elapsed = now - pool.closeTs;
  return {
    bandBps: growBps(p.closedBaseBandBps, p.closedBandGrowthBpsPerHour, p.closedMaxBandBps, elapsed, false),
    fee: {
      baseBps: growBps(p.closedBaseFeeBps, p.closedFeeGrowthBpsPerHour, p.closedMaxFeeBps, elapsed, true),
      sizeBpsPerPct: p.sizeFeeBpsPer1PctDepth,
      capBps: p.closedMaxFeeBps,
    },
  };
}

export interface Reserves {
  base: bigint;
  quote: bigint;
}

/**
 * Exactly what `swap` does on-chain: refresh, then price under the mode's band and fee.
 * Throws AfterbellError with the same name the program would fail with.
 */
export function quoteSwap(
  pool: PoolState,
  reserves: Reserves,
  amountIn: bigint,
  direction: Direction,
  ctx: MarketContext,
): SwapQuote & { mode: Mode; bandBps: number; pool: PoolState } {
  const p = refresh(pool, ctx);
  const { fee, bandBps } = tradingTerms(p, ctx.now);
  const q = quoteSwapRaw(reserves.base, reserves.quote, p.poolPrice, p.params.depthBps, fee, amountIn, direction);
  if (!withinBand(q.newPrice, p.referencePrice, bandBps)) throw new AfterbellError("OutsideBand");
  return { ...q, mode: p.mode, bandBps, pool: { ...p, poolPrice: q.newPrice } };
}

// ---------- read helpers for UIs (brief 8.1) ----------

export const getPoolMode = targetMode;

export function hoursSinceClose(pool: PoolState, now: bigint): number {
  return pool.mode === "Closed" ? Math.max(0, Number(now - pool.closeTs)) / 3_600 : 0;
}

/** Allowed pool-price range right now, in pool price units. Null while Paused. */
export function getBand(pool: PoolState, now: bigint): { bandBps: number; low: bigint; high: bigint } | null {
  if (pool.mode === "Paused") return null;
  const { bandBps } = tradingTerms(pool, now);
  const width = (pool.referencePrice * BigInt(bandBps)) / 10_000n;
  return { bandBps, low: pool.referencePrice - width, high: pool.referencePrice + width };
}

/** Base fee (bps) right now, before any size fee. Null while Paused. */
export function getCurrentFee(pool: PoolState, now: bigint): number | null {
  return pool.mode === "Paused" ? null : tradingTerms(pool, now).fee.baseBps;
}
