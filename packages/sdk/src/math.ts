// Line-by-line mirror of programs/afterbell/src/math.rs with bigint.
// Same order of checks, same rounding, same errors. Parity is enforced by test/vectors.json,
// which the Rust test suite regenerates from the real program.

export const PRICE_SCALE = 10n ** 18n;
export const MAX_PRICE = 1n << 96n;
export const MAX_ORACLE_PRICE = MAX_PRICE / 2n;
export const BPS = 10_000n;
export const MIN_LIQUIDITY = 1_000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export type Direction = "BaseToQuote" | "QuoteToBase";

export type AfterbellErrorName =
  | "OutsideBand"
  | "PoolPaused"
  | "StaleOracle"
  | "SlippageExceeded"
  | "InsufficientLiquidity"
  | "MathOverflow"
  | "ZeroAmount"
  | "InvalidOraclePrice"
  | "MissingCalendar";

/** A program error the SDK predicts. `name` matches the on-chain ErrorCode variant. */
export class AfterbellError extends Error {
  readonly name: AfterbellErrorName;
  constructor(name: AfterbellErrorName) {
    super(name);
    this.name = name;
  }
}

const fail = (name: AfterbellErrorName): never => {
  throw new AfterbellError(name);
};
const u128 = (x: bigint) => (x > U128_MAX ? fail("MathOverflow") : x);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

export function mulDiv(a: bigint, b: bigint, d: bigint, roundUp: boolean): bigint {
  if (d === 0n) fail("MathOverflow");
  const p = u128(a * b);
  const q = p / d;
  return roundUp && p % d !== 0n ? q + 1n : q;
}

export function mulPrice(amount: bigint, price: bigint, roundUp: boolean): bigint {
  const whole = u128(amount * (price / PRICE_SCALE));
  const frac = mulDiv(amount, price % PRICE_SCALE, PRICE_SCALE, roundUp);
  return u128(whole + frac);
}

export function toU64(v: bigint): bigint {
  return v > U64_MAX ? fail("MathOverflow") : v;
}

export function virtualReserves(
  baseReserve: bigint,
  quoteReserve: bigint,
  price: bigint,
  depthBps: number,
  direction: Direction,
): [bigint, bigint] {
  if (!(price > 0n && price <= MAX_PRICE)) fail("InvalidOraclePrice");
  const quoteAsBase = mulDiv(quoteReserve, PRICE_SCALE, price, false);
  const depthBase = min(baseReserve, quoteAsBase);
  const vb = max(mulDiv(depthBase, BigInt(depthBps), BPS, false), 1n);
  const vq = mulPrice(vb, price, direction === "QuoteToBase");
  if (vq === 0n) fail("InsufficientLiquidity");
  return [vb, vq];
}

export interface FeeRule {
  baseBps: number;
  sizeBpsPerPct: number;
  capBps: number;
}

export const flatFee = (bps: number): FeeRule => ({ baseBps: bps, sizeBpsPerPct: 0, capBps: bps });

export function feeBps(rule: FeeRule, amountIn: bigint, virtualIn: bigint): number {
  const size = mulDiv(BigInt(rule.sizeBpsPerPct) * 100n, amountIn, max(virtualIn, 1n), true);
  return Number(min(BigInt(rule.baseBps) + size, BigInt(rule.capBps)));
}

export function growBps(base: number, perHour: number, cap: number, elapsedSecs: bigint, roundUp: boolean): number {
  const growth = mulDiv(BigInt(perHour), max(elapsedSecs, 0n), 3_600n, roundUp);
  return Number(min(BigInt(base) + growth, BigInt(cap)));
}

export interface SwapQuote {
  amountOut: bigint;
  fee: bigint;
  feeBps: number;
  newPrice: bigint;
}

export function quoteSwapRaw(
  baseReserve: bigint,
  quoteReserve: bigint,
  price: bigint,
  depthBps: number,
  rule: FeeRule,
  amountIn: bigint,
  direction: Direction,
): SwapQuote {
  if (!(amountIn > 0n)) fail("ZeroAmount");
  const [vb, vq] = virtualReserves(baseReserve, quoteReserve, price, depthBps, direction);
  const bps = feeBps(rule, amountIn, direction === "BaseToQuote" ? vb : vq);
  const fee = mulDiv(amountIn, BigInt(bps), BPS, true);
  const net = amountIn - fee;
  if (net < 0n) fail("MathOverflow");

  let out: bigint;
  let newVb: bigint;
  let newVq: bigint;
  let outReserve: bigint;
  if (direction === "BaseToQuote") {
    out = mulDiv(vq, net, vb + net, false);
    [newVb, newVq, outReserve] = [vb + net, vq - out, quoteReserve];
  } else {
    out = mulDiv(vb, net, vq + net, false);
    [newVb, newVq, outReserve] = [vb - out, vq + net, baseReserve];
  }
  if (out === 0n) fail("ZeroAmount");
  if (!(out < outReserve)) fail("InsufficientLiquidity");
  return { amountOut: toU64(out), fee: toU64(fee), feeBps: bps, newPrice: mulDiv(newVq, PRICE_SCALE, newVb, false) };
}

export function withinBand(price: bigint, reference: bigint, bandBps: number): boolean {
  const diff = price > reference ? price - reference : reference - price;
  return u128(diff * BPS) <= u128(reference * BigInt(bandBps));
}

export function initialLp(base: bigint, quote: bigint): bigint {
  const lp = sqrt(base * quote);
  if (!(lp > MIN_LIQUIDITY)) fail("InsufficientLiquidity");
  return toU64(lp - MIN_LIQUIDITY);
}

export function proportionalDeposit(
  maxBase: bigint,
  maxQuote: bigint,
  baseReserve: bigint,
  quoteReserve: bigint,
  lpSupply: bigint,
): { lp: bigint; baseIn: bigint; quoteIn: bigint } {
  if (!(baseReserve > 0n && quoteReserve > 0n)) fail("InsufficientLiquidity");
  const lp = min(mulDiv(maxBase, lpSupply, baseReserve, false), mulDiv(maxQuote, lpSupply, quoteReserve, false));
  if (lp === 0n) fail("ZeroAmount");
  return {
    lp: toU64(lp),
    baseIn: toU64(mulDiv(lp, baseReserve, lpSupply, true)),
    quoteIn: toU64(mulDiv(lp, quoteReserve, lpSupply, true)),
  };
}

export function withdrawAmounts(
  lp: bigint,
  baseReserve: bigint,
  quoteReserve: bigint,
  lpSupply: bigint,
): [bigint, bigint] {
  if (lp === 0n) fail("ZeroAmount");
  if (!(lp < lpSupply)) fail("InsufficientLiquidity");
  return [toU64(mulDiv(lp, baseReserve, lpSupply, false)), toU64(mulDiv(lp, quoteReserve, lpSupply, false))];
}

export function tvlQuote(baseReserve: bigint, quoteReserve: bigint, price: bigint): bigint {
  return u128(mulPrice(baseReserve, price, true) + quoteReserve);
}

export function oracleToPoolPrice(
  priceRaw: bigint,
  expo: number,
  baseDecimals: number,
  quoteDecimals: number,
  multiplier: bigint = PRICE_SCALE,
): bigint {
  if (!(priceRaw > 0n)) fail("InvalidOraclePrice");
  let v = u128(priceRaw * multiplier);
  const exp = expo + quoteDecimals - baseDecimals;
  if (exp >= 0) v = u128(v * 10n ** BigInt(exp));
  else v = -exp > 38 ? 0n : v / 10n ** BigInt(-exp); // 10^39 overflows u128 -> Rust yields 0
  if (!(v > 0n && v <= MAX_ORACLE_PRICE)) fail("InvalidOraclePrice");
  return v;
}

export function confBps(conf: bigint, priceRaw: bigint): number {
  if (!(priceRaw > 0n)) fail("InvalidOraclePrice");
  return Number(min(mulDiv(conf, BPS, priceRaw, true), 65_535n));
}

/** floor(sqrt(n)), Newton's method (same result as Rust's u128::isqrt). */
function sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Human price (quote per base, UI units) from pool price units. Display only. */
export function toUiPrice(price: bigint, baseDecimals: number, quoteDecimals: number): number {
  return (Number(price) / Number(PRICE_SCALE)) * 10 ** (baseDecimals - quoteDecimals);
}
