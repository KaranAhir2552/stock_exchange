"""Weekend simulation: an informed trader who knows Monday's open trades against (a) a plain
constant-product pool and (b) Afterbell (the program's exact math, via afterbell_math)."""

from dataclasses import dataclass

import afterbell_math as m

BASE_DECIMALS, QUOTE_DECIMALS = 8, 6  # xStock-like base; USDC quote
WEEKEND_SECS = int(65.5 * 3600)  # Friday 16:00 ET -> Monday 09:30 ET
STEP_SECS = 15 * 60  # the trader checks every 15 minutes
CHUNK_BPS_OF_DEPTH = 20  # 0.2% of depth per trade: the size fee rounds up to its 1 bps minimum


def to_pool_price(usd: float) -> int:
    return m.oracle_to_pool_price(round(usd * 1e8), -8, BASE_DECIMALS, QUOTE_DECIMALS)


@dataclass
class Outcome:
    lp_usd: float  # LP value at Monday's open price
    hodl_usd: float  # value if the LP had just held the starting tokens
    fees_usd: float  # fees kept by the pool, valued at Monday's open
    trader_profit_usd: float  # informed trader's profit at Monday's open (after fees)
    trades: int
    detail: dict

    @property
    def lp_vs_hodl_usd(self) -> float:
        return self.lp_usd - self.hodl_usd

    @property
    def stale_loss_usd(self) -> float:
        """Value lost to trading at stale prices, before fees (trader profit + fees paid)."""
        return self.trader_profit_usd + self.fees_usd


def start_reserves(p0: float, quote_usd: float) -> tuple[int, int]:
    """Equal value on both sides at Friday's close, in atoms."""
    quote = int(quote_usd * 10**QUOTE_DECIMALS)
    return quote * m.PRICE_SCALE // to_pool_price(p0), quote


def usd(base_atoms: int, quote_atoms: int, p1: int) -> float:
    return (m.mul_price(base_atoms, p1, False) + quote_atoms) / 10**QUOTE_DECIMALS


def plain_cpmm(p0: float, p1: float, fee_bps: int, quote_usd: float) -> Outcome:
    """Uniswap-v2-style x*y=k with the fee kept in reserves. The trader moves the price until the
    next unit costs more than Monday's price: buying stops at P1*(1-f), selling at P1/(1-f)."""
    b0, q0 = start_reserves(p0, quote_usd)
    x, y = b0 / 10**BASE_DECIMALS, q0 / 10**QUOTE_DECIMALS  # shares, dollars
    f, k = fee_bps / 10_000, x * y
    target = p1 * (1 - f) if p1 > p0 else p1 / (1 - f)
    hodl = x * p1 + y
    if (p1 > p0 and target <= p0) or (p1 < p0 and target >= p0):
        return Outcome(hodl, hodl, 0.0, 0.0, 0, {"endPrice": p0})
    x2, y2 = (k / target) ** 0.5, (k * target) ** 0.5
    if p1 > p0:  # trader buys shares with dollars
        gross_in = (y2 - y) / (1 - f)
        fee_usd, got, paid = gross_in - (y2 - y), (x - x2) * p1, gross_in
        x_end, y_end = x2, y + gross_in
    else:  # trader sells shares for dollars
        gross_in = (x2 - x) / (1 - f)
        fee_usd, got, paid = (gross_in - (x2 - x)) * p1, y - y2, gross_in * p1
        x_end, y_end = x + gross_in, y2
    lp = x_end * p1 + y_end
    return Outcome(lp, hodl, fee_usd, got - paid, 1, {"endPrice": target})


def afterbell(p0: float, p1: float, params: m.Params, quote_usd: float) -> Outcome:
    """Afterbell in Closed mode over the weekend, then the Monday re-centre (no trade at the open)."""
    base, quote = start_reserves(p0, quote_usd)
    b0, q0 = base, quote
    ref, target = to_pool_price(p0), to_pool_price(p1)
    pool = m.Pool("UsEquity", "Closed", False, ref, ref, 0, 0, 120, 100, BASE_DECIMALS, QUOTE_DECIMALS, params)
    buy = target > ref  # trader buys base (quote in) when Monday opens higher
    fees_value = trades = 0  # fee atoms valued at P1, in quote atoms
    for now in range(0, WEEKEND_SECS, STEP_SECS):
        vb, vq = m.virtual_reserves(base, quote, pool.pool_price, params.depth_bps, not buy)
        chunk = max((vq if buy else vb) * CHUNK_BPS_OF_DEPTH // 10_000, 1)
        while chunk >= 1:
            try:
                q, nxt = m.swap(pool, base, quote, chunk, not buy, now)
            except m.AfterbellError:  # OutsideBand / too small: try a smaller trade
                chunk //= 2
                continue
            # Profitable at Monday's price? (value received > value paid, both at P1)
            if buy:
                profitable = m.mul_price(q.amount_out, target, False) > chunk
            else:
                profitable = q.amount_out > m.mul_price(chunk, target, True)
            if not profitable:
                chunk //= 2
                continue
            if buy:
                quote, base = quote + chunk, base - q.amount_out
                fees_value += q.fee
            else:
                base, quote = base + chunk, quote - q.amount_out
                fees_value += m.mul_price(q.fee, target, False)
            pool, trades = nxt, trades + 1
    lp = usd(base, quote, target)
    hodl = usd(b0, q0, target)
    fees = fees_value / 10**QUOTE_DECIMALS
    rule, band = m.trading_terms(pool, WEEKEND_SECS)
    ui = lambda x: x / m.PRICE_SCALE * 10 ** (BASE_DECIMALS - QUOTE_DECIMALS)  # noqa: E731
    return Outcome(
        lp,
        hodl,
        fees,
        trader_profit_usd=hodl - lp,  # the LP's shortfall vs holding is exactly the trader's net profit
        trades=trades,
        detail={"endPrice": ui(pool.pool_price), "bandAtOpenBps": band, "baseFeeAtOpenBps": rule.base_bps},
    )
