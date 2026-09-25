"""Line-by-line Python mirror of programs/afterbell/src/math.rs and mode.rs (integer math, same
rounding, same errors). Verified against the program by test_parity.py, which replays the swaps the
real SBPF program executed (packages/sdk/test/vectors.json)."""

from dataclasses import dataclass, replace

PRICE_SCALE = 10**18
MAX_PRICE = 1 << 96
BPS = 10_000
U64_MAX = (1 << 64) - 1
U128_MAX = (1 << 128) - 1


class AfterbellError(Exception):
    """Same names as the program's ErrorCode variants."""


def _u128(x: int) -> int:
    if x > U128_MAX:
        raise AfterbellError("MathOverflow")
    return x


def mul_div(a: int, b: int, d: int, round_up: bool) -> int:
    if d == 0:
        raise AfterbellError("MathOverflow")
    p = _u128(a * b)
    q = p // d
    return q + 1 if round_up and p % d else q


def mul_price(amount: int, price: int, round_up: bool) -> int:
    whole = _u128(amount * (price // PRICE_SCALE))
    return _u128(whole + mul_div(amount, price % PRICE_SCALE, PRICE_SCALE, round_up))


def virtual_reserves(base: int, quote: int, price: int, depth_bps: int, b2q: bool) -> tuple[int, int]:
    if not 0 < price <= MAX_PRICE:
        raise AfterbellError("InvalidOraclePrice")
    depth_base = min(base, mul_div(quote, PRICE_SCALE, price, False))
    vb = max(mul_div(depth_base, depth_bps, BPS, False), 1)
    vq = mul_price(vb, price, not b2q)
    if vq == 0:
        raise AfterbellError("InsufficientLiquidity")
    return vb, vq


@dataclass(frozen=True)
class FeeRule:
    base_bps: int
    size_bps_per_pct: int
    cap_bps: int

    def fee_bps(self, amount_in: int, virtual_in: int) -> int:
        size = mul_div(self.size_bps_per_pct * 100, amount_in, max(virtual_in, 1), True)
        return min(self.base_bps + size, self.cap_bps)


def flat(bps: int) -> FeeRule:
    return FeeRule(bps, 0, bps)


def grow_bps(base: int, per_hour: int, cap: int, elapsed_secs: int, round_up: bool) -> int:
    return min(base + mul_div(per_hour, max(elapsed_secs, 0), 3_600, round_up), cap)


@dataclass(frozen=True)
class Quote:
    amount_out: int
    fee: int
    fee_bps: int
    new_price: int


def quote_swap(base: int, quote: int, price: int, depth_bps: int, rule: FeeRule, amount_in: int, b2q: bool) -> Quote:
    if amount_in <= 0:
        raise AfterbellError("ZeroAmount")
    vb, vq = virtual_reserves(base, quote, price, depth_bps, b2q)
    bps = rule.fee_bps(amount_in, vb if b2q else vq)
    fee = mul_div(amount_in, bps, BPS, True)
    net = amount_in - fee
    if b2q:
        out = mul_div(vq, net, vb + net, False)
        new_vb, new_vq, out_reserve = vb + net, vq - out, quote
    else:
        out = mul_div(vb, net, vq + net, False)
        new_vb, new_vq, out_reserve = vb - out, vq + net, base
    if out == 0:
        raise AfterbellError("ZeroAmount")
    if out >= out_reserve:
        raise AfterbellError("InsufficientLiquidity")
    if out > U64_MAX or fee > U64_MAX:
        raise AfterbellError("MathOverflow")
    return Quote(out, fee, bps, mul_div(new_vq, PRICE_SCALE, new_vb, False))


def within_band(price: int, reference: int, band_bps: int) -> bool:
    return _u128(abs(price - reference) * BPS) <= _u128(reference * band_bps)


def oracle_to_pool_price(price_raw: int, expo: int, base_dec: int, quote_dec: int, multiplier: int = PRICE_SCALE) -> int:
    if price_raw <= 0:
        raise AfterbellError("InvalidOraclePrice")
    v = _u128(price_raw * multiplier)
    exp = expo + quote_dec - base_dec
    v = _u128(v * 10**exp) if exp >= 0 else (0 if -exp > 38 else v // 10 ** (-exp))
    if not 0 < v <= MAX_PRICE // 2:
        raise AfterbellError("InvalidOraclePrice")
    return v


def conf_bps(conf: int, price_raw: int) -> int:
    if price_raw <= 0:
        raise AfterbellError("InvalidOraclePrice")
    return min(mul_div(conf, BPS, price_raw, True), 65_535)


# ---------- mode.rs ----------


@dataclass(frozen=True)
class Params:
    open_band_bps: int
    closed_base_band_bps: int
    closed_band_growth_bps_per_hour: int
    closed_max_band_bps: int
    open_fee_bps: int
    closed_base_fee_bps: int
    closed_fee_growth_bps_per_hour: int
    closed_max_fee_bps: int
    size_fee_bps_per_1pct_depth: int
    depth_bps: int
    max_tvl_quote: int


@dataclass(frozen=True)
class Pool:
    profile: str  # "AlwaysOpen" | "UsEquity"
    mode: str  # "Open" | "Closed" | "Paused"
    halted: bool
    pool_price: int
    reference_price: int
    close_ts: int
    last_oracle_publish_ts: int
    max_staleness_secs: int
    max_conf_bps: int
    base_decimals: int
    quote_decimals: int
    params: Params


@dataclass(frozen=True)
class Oracle:
    price: int  # pool price units
    conf_bps: int
    publish_ts: int
    status: str | None  # "Trading" | "Halted" | "Closed" | None


def target_mode(pool: Pool, global_pause: bool, sessions: list[tuple[int, int]] | None, valid_until: int, oracle: Oracle, now: int) -> str:
    if global_pause or pool.halted or oracle.status == "Halted":
        return "Paused"
    valid = now - oracle.publish_ts <= pool.max_staleness_secs and oracle.conf_bps <= pool.max_conf_bps
    if pool.profile == "AlwaysOpen":
        mode = "Open" if valid else "Paused"
    else:
        if sessions is None:
            raise AfterbellError("MissingCalendar")
        in_session = now < valid_until and any(o <= now < c for o, c in sessions)
        mode = ("Open" if valid else "Paused") if in_session else "Closed"
    return "Paused" if mode == "Closed" and pool.reference_price == 0 else mode


def refresh(pool: Pool, global_pause: bool, sessions, valid_until: int, oracle: Oracle, now: int) -> Pool:
    if oracle.publish_ts < pool.last_oracle_publish_ts:
        raise AfterbellError("StaleOracle")
    target = target_mode(pool, global_pause, sessions, valid_until, oracle, now)
    if target == "Open" and (pool.mode != "Open" or oracle.publish_ts > pool.last_oracle_publish_ts):
        pool = replace(pool, reference_price=oracle.price, pool_price=oracle.price, last_oracle_publish_ts=oracle.publish_ts)
    elif target == "Closed" and pool.mode != "Closed":
        closes = [c for _, c in sessions or [] if c <= now]
        session_close = closes[-1] if closes else 2**63 - 1
        pool = replace(pool, close_ts=min(pool.last_oracle_publish_ts, session_close))
    return replace(pool, mode=target)


def trading_terms(pool: Pool, now: int) -> tuple[FeeRule, int]:
    p = pool.params
    if pool.mode == "Paused":
        raise AfterbellError("PoolPaused")
    if pool.mode == "Open":
        return flat(p.open_fee_bps), p.open_band_bps
    elapsed = now - pool.close_ts
    band = grow_bps(p.closed_base_band_bps, p.closed_band_growth_bps_per_hour, p.closed_max_band_bps, elapsed, False)
    base_fee = grow_bps(p.closed_base_fee_bps, p.closed_fee_growth_bps_per_hour, p.closed_max_fee_bps, elapsed, True)
    return FeeRule(base_fee, p.size_fee_bps_per_1pct_depth, p.closed_max_fee_bps), band


def swap(pool: Pool, base: int, quote: int, amount_in: int, b2q: bool, now: int) -> tuple[Quote, Pool]:
    """Pricing half of the on-chain swap for an already-refreshed pool."""
    rule, band = trading_terms(pool, now)
    q = quote_swap(base, quote, pool.pool_price, pool.params.depth_bps, rule, amount_in, b2q)
    if not within_band(q.new_price, pool.reference_price, band):
        raise AfterbellError("OutsideBand")
    return q, replace(pool, pool_price=q.new_price)
