//! Pure fixed-point math. No floats, checked everywhere, rounding always in the pool's favour.
//!
//! Size bounds that keep every intermediate inside u128:
//! - amounts and reserves are u64 (< 2^64); prices are <= MAX_PRICE (2^96); PRICE_SCALE < 2^60.
//! - two-sided depth (DECISIONS.md #3) makes both virtual reserves <= the real reserves (u64),
//!   so products of two of them fit in u128.
//! - amount * price is split into whole and fractional parts of PRICE_SCALE (`mul_price`).

use crate::errors::ErrorCode;
use crate::state::{Direction, BPS, MAX_PRICE, MIN_LIQUIDITY, PRICE_SCALE};
use anchor_lang::prelude::*;

/// Oracle-derived prices must stay below this so a max-width band (50%) still fits under MAX_PRICE.
pub const MAX_ORACLE_PRICE: u128 = MAX_PRICE / 2;

fn overflow() -> Error {
    error!(ErrorCode::MathOverflow)
}

/// a * b / d, rounded down or up.
pub fn mul_div(a: u128, b: u128, d: u128, round_up: bool) -> Result<u128> {
    require!(d != 0, ErrorCode::MathOverflow);
    let p = a.checked_mul(b).ok_or_else(overflow)?;
    let q = p / d;
    Ok(if round_up && p % d != 0 { q + 1 } else { q })
}

/// amount * price / PRICE_SCALE (quote atoms for `amount` base atoms).
pub fn mul_price(amount: u128, price: u128, round_up: bool) -> Result<u128> {
    let whole = amount
        .checked_mul(price / PRICE_SCALE)
        .ok_or_else(overflow)?;
    let frac = mul_div(amount, price % PRICE_SCALE, PRICE_SCALE, round_up)?;
    whole.checked_add(frac).ok_or_else(overflow)
}

pub fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| overflow())
}

/// Virtual reserves centred on `price`: depth is a fraction of the smaller real side (valued at
/// `price`), at least 1 atom. The derived quote side is rounded so the trader gets less.
pub fn virtual_reserves(
    base_reserve: u64,
    quote_reserve: u64,
    price: u128,
    depth_bps: u16,
    direction: Direction,
) -> Result<(u128, u128)> {
    require!(
        price > 0 && price <= MAX_PRICE,
        ErrorCode::InvalidOraclePrice
    );
    let quote_as_base = mul_div(quote_reserve as u128, PRICE_SCALE, price, false)?;
    let depth_base = (base_reserve as u128).min(quote_as_base);
    let vb = mul_div(depth_base, depth_bps as u128, BPS, false)?.max(1);
    // Quote out (BaseToQuote): fewer virtual quote -> less out. Quote in: more -> less base out.
    let vq = mul_price(vb, price, direction == Direction::QuoteToBase)?;
    require!(vq > 0, ErrorCode::InsufficientLiquidity);
    Ok((vb, vq))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapQuote {
    pub amount_out: u64,
    pub fee: u64,
    pub new_price: u128,
}

/// Constant product on the virtual reserves. The fee is taken from `amount_in` (rounded up).
pub fn quote_swap(
    base_reserve: u64,
    quote_reserve: u64,
    price: u128,
    depth_bps: u16,
    fee_bps: u16,
    amount_in: u64,
    direction: Direction,
) -> Result<SwapQuote> {
    require!(amount_in > 0, ErrorCode::ZeroAmount);
    let fee = mul_div(amount_in as u128, fee_bps as u128, BPS, true)?;
    let net = (amount_in as u128).checked_sub(fee).ok_or_else(overflow)?;
    let (vb, vq) = virtual_reserves(base_reserve, quote_reserve, price, depth_bps, direction)?;

    let (out, new_vb, new_vq, out_reserve) = match direction {
        Direction::BaseToQuote => {
            let out = mul_div(vq, net, vb + net, false)?;
            (out, vb + net, vq - out, quote_reserve)
        }
        Direction::QuoteToBase => {
            let out = mul_div(vb, net, vq + net, false)?;
            (out, vb - out, vq + net, base_reserve)
        }
    };
    require!(out > 0, ErrorCode::ZeroAmount);
    // Strictly less: a real reserve never reaches zero.
    require!(out < out_reserve as u128, ErrorCode::InsufficientLiquidity);
    Ok(SwapQuote {
        amount_out: to_u64(out)?,
        fee: to_u64(fee)?,
        new_price: mul_div(new_vq, PRICE_SCALE, new_vb, false)?,
    })
}

/// |price - reference| / reference <= band_bps.
pub fn within_band(price: u128, reference: u128, band_bps: u16) -> Result<bool> {
    let lhs = price
        .abs_diff(reference)
        .checked_mul(BPS)
        .ok_or_else(overflow)?;
    let rhs = reference
        .checked_mul(band_bps as u128)
        .ok_or_else(overflow)?;
    Ok(lhs <= rhs)
}

/// First deposit: sqrt(base * quote) LP, of which MIN_LIQUIDITY is locked forever.
pub fn initial_lp(base: u64, quote: u64) -> Result<u64> {
    let lp = (base as u128 * quote as u128).isqrt();
    require!(lp > MIN_LIQUIDITY as u128, ErrorCode::InsufficientLiquidity);
    to_u64(lp - MIN_LIQUIDITY as u128)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Deposit {
    pub lp: u64,
    pub base_in: u64,
    pub quote_in: u64,
}

/// Later deposits: LP rounded down, tokens owed rounded up. `lp_supply` includes MIN_LIQUIDITY.
pub fn proportional_deposit(
    max_base: u64,
    max_quote: u64,
    base_reserve: u64,
    quote_reserve: u64,
    lp_supply: u64,
) -> Result<Deposit> {
    require!(
        base_reserve > 0 && quote_reserve > 0,
        ErrorCode::InsufficientLiquidity
    );
    let s = lp_supply as u128;
    let lp = mul_div(max_base as u128, s, base_reserve as u128, false)?.min(mul_div(
        max_quote as u128,
        s,
        quote_reserve as u128,
        false,
    )?);
    require!(lp > 0, ErrorCode::ZeroAmount);
    Ok(Deposit {
        lp: to_u64(lp)?,
        base_in: to_u64(mul_div(lp, base_reserve as u128, s, true)?)?,
        quote_in: to_u64(mul_div(lp, quote_reserve as u128, s, true)?)?,
    })
}

/// Proportional share of both reserves, rounded down. `lp_supply` includes MIN_LIQUIDITY.
pub fn withdraw_amounts(
    lp: u64,
    base_reserve: u64,
    quote_reserve: u64,
    lp_supply: u64,
) -> Result<(u64, u64)> {
    require!(lp > 0, ErrorCode::ZeroAmount);
    require!(lp < lp_supply, ErrorCode::InsufficientLiquidity);
    let (lp, s) = (lp as u128, lp_supply as u128);
    Ok((
        to_u64(mul_div(lp, base_reserve as u128, s, false)?)?,
        to_u64(mul_div(lp, quote_reserve as u128, s, false)?)?,
    ))
}

/// Pool TVL in quote atoms, rounded up (so the cap binds early).
pub fn tvl_quote(base_reserve: u64, quote_reserve: u64, price: u128) -> Result<u128> {
    mul_price(base_reserve as u128, price, true)?
        .checked_add(quote_reserve as u128)
        .ok_or_else(overflow)
}

/// Oracle price (`price_raw * 10^expo` quote per base, in UI units) times the base mint's UI
/// multiplier (PRICE_SCALE fixed point) -> quote atoms per base atom * PRICE_SCALE, rounded down.
pub fn oracle_to_pool_price(
    price_raw: i64,
    expo: i32,
    base_decimals: u8,
    quote_decimals: u8,
    multiplier: u128,
) -> Result<u128> {
    require!(price_raw > 0, ErrorCode::InvalidOraclePrice);
    let v = (price_raw as u128)
        .checked_mul(multiplier)
        .ok_or_else(overflow)?;
    let exp = expo as i64 + quote_decimals as i64 - base_decimals as i64;
    let pow = |e: i64| 10u128.checked_pow(e as u32);
    let v = if exp >= 0 {
        v.checked_mul(pow(exp).ok_or_else(overflow)?)
            .ok_or_else(overflow)?
    } else {
        pow(-exp).map_or(0, |p| v / p)
    };
    require!(
        v > 0 && v <= MAX_ORACLE_PRICE,
        ErrorCode::InvalidOraclePrice
    );
    Ok(v)
}

/// conf / price in bps, rounded up, saturating at u16::MAX.
pub fn conf_bps(conf: u64, price_raw: i64) -> Result<u16> {
    require!(price_raw > 0, ErrorCode::InvalidOraclePrice);
    let bps = mul_div(conf as u128, BPS, price_raw as u128, true)?;
    Ok(bps.min(u16::MAX as u128) as u16)
}

/// Decodes little-endian IEEE-754 f64 bytes (Token-2022 ScaledUiAmount multiplier) into PRICE_SCALE
/// fixed point, rounded down, with integer ops only. Rejects zero, negative, subnormal, NaN, inf.
pub fn f64_bytes_to_fixed(bytes: [u8; 8]) -> Result<u128> {
    let bits = u64::from_le_bytes(bytes);
    let exp = ((bits >> 52) & 0x7ff) as i32;
    require!(
        bits >> 63 == 0 && exp != 0 && exp != 0x7ff,
        ErrorCode::InvalidOraclePrice
    );
    // value = mantissa * 2^(exp - 1075); mantissa < 2^53, so mantissa * PRICE_SCALE < 2^113.
    let scaled = ((bits & ((1 << 52) - 1)) | (1 << 52)) as u128 * PRICE_SCALE;
    let shift = exp - 1075;
    let v = match shift {
        0.. => {
            require!(shift <= 14, ErrorCode::MathOverflow); // 2^113 << 14 < 2^128
            scaled << shift
        }
        -127..0 => scaled >> -shift,
        _ => 0,
    };
    require!(v > 0, ErrorCode::InvalidOraclePrice);
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const P1: u128 = PRICE_SCALE; // 1 quote atom per base atom

    fn b2q(b: u64, q: u64, p: u128, amt: u64) -> Result<SwapQuote> {
        quote_swap(b, q, p, 10_000, 30, amt, Direction::BaseToQuote)
    }

    #[test]
    fn swap_matches_constant_product_and_keeps_fee() {
        // 1M/1M reserves at price 1, full depth, 30 bps fee, sell 1000 base.
        let q = b2q(1_000_000, 1_000_000, P1, 1_000).unwrap();
        assert_eq!(q.fee, 3); // ceil(1000 * 0.003)
                              // net 997: out = 1_000_000 * 997 / 1_000_997 = 996.00...
        assert_eq!(q.amount_out, 996);
        assert!(q.new_price < P1);
    }

    #[test]
    fn fee_rounds_up() {
        let q = b2q(1_000_000, 1_000_000, P1, 1).unwrap_err();
        assert_eq!(q, error!(ErrorCode::ZeroAmount)); // 1 atom in, fee takes it all
        let q = quote_swap(
            1_000_000,
            1_000_000,
            P1,
            10_000,
            30,
            334,
            Direction::BaseToQuote,
        )
        .unwrap();
        assert_eq!(q.fee, 2); // 334 * 30 / 10000 = 1.002 -> 2
    }

    #[test]
    fn depth_uses_smaller_side() {
        // Pool is almost all quote: base side is tiny, so depth follows base.
        let (vb, vq) = virtual_reserves(10, 1_000_000, P1, 10_000, Direction::BaseToQuote).unwrap();
        assert_eq!((vb, vq), (10, 10));
        // Almost all base: depth follows quote valued at price 2.
        let (vb, vq) =
            virtual_reserves(1_000_000, 10, 2 * P1, 10_000, Direction::BaseToQuote).unwrap();
        assert_eq!((vb, vq), (5, 10));
    }

    #[test]
    fn output_never_drains_reserve() {
        // Constant product on virtual reserves (<= real) can't drain; the explicit check is a backstop.
        let q = quote_swap(
            1_000,
            1_000,
            P1,
            10_000,
            0,
            u64::MAX / 2,
            Direction::BaseToQuote,
        )
        .unwrap();
        assert!(q.amount_out < 1_000);
    }

    #[test]
    fn band_check() {
        assert!(within_band(101 * P1 / 100, P1, 100).unwrap());
        assert!(!within_band(101 * P1 / 100 + 1, P1, 100).unwrap());
        assert!(within_band(99 * P1 / 100, P1, 100).unwrap());
        assert!(!within_band(99 * P1 / 100 - 1, P1, 100).unwrap());
    }

    #[test]
    fn lp_math() {
        assert_eq!(
            initial_lp(1_000_000, 4_000_000).unwrap(),
            2_000_000 - MIN_LIQUIDITY
        );
        assert!(initial_lp(10, 10).is_err());
        // supply 2_000_000 (incl. locked) over 1M/4M reserves; offer 100 base / 1000 quote.
        let d = proportional_deposit(100, 1_000, 1_000_000, 4_000_000, 2_000_000).unwrap();
        assert_eq!(
            d,
            Deposit {
                lp: 200,
                base_in: 100,
                quote_in: 400
            }
        );
        // Rounding: tokens owed round up, LP rounds down.
        let d = proportional_deposit(3, 1_000, 1_000_000, 4_000_000, 1_999_999).unwrap();
        assert_eq!(d.lp, 5);
        assert_eq!((d.base_in, d.quote_in), (3, 11)); // 2.5 -> 3, 10.00...5 -> 11
        assert_eq!(
            withdraw_amounts(200, 1_000_000, 4_000_000, 2_000_000).unwrap(),
            (100, 400)
        );
        assert_eq!(
            withdraw_amounts(3, 1_000_000, 4_000_000, 2_000_000).unwrap(),
            (1, 6)
        );
    }

    #[test]
    fn oracle_conversion() {
        // TSLA $250.12345678 (expo -8), base 8 decimals, USDC 6 decimals:
        // quote atoms per base atom = 250.12345678 * 10^6 / 10^8 = 2.5012345678
        let p = oracle_to_pool_price(25_012_345_678, -8, 8, 6, PRICE_SCALE).unwrap();
        assert_eq!(p, 2_501_234_567_800_000_000);
        // Multiplier 1.5 scales the value of a raw base unit.
        let p15 = oracle_to_pool_price(25_012_345_678, -8, 8, 6, 3 * PRICE_SCALE / 2).unwrap();
        assert_eq!(p15, p * 3 / 2);
        // SOL $150 (expo -8), 9 decimals vs USDC 6: 0.15 quote atoms per lamport.
        let p = oracle_to_pool_price(15_000_000_000, -8, 9, 6, PRICE_SCALE).unwrap();
        assert_eq!(p, 150_000_000_000_000_000);
        assert!(oracle_to_pool_price(0, -8, 9, 6, PRICE_SCALE).is_err());
        assert!(oracle_to_pool_price(-5, -8, 9, 6, PRICE_SCALE).is_err());
        assert_eq!(conf_bps(25_012_345, 25_012_345_678).unwrap(), 10); // 0.1% -> 10 bps (ceil)
    }

    #[test]
    fn f64_decode_is_exact_and_floors() {
        let d = |x: f64| f64_bytes_to_fixed(x.to_le_bytes());
        assert_eq!(d(1.0).unwrap(), PRICE_SCALE);
        assert_eq!(d(1.5).unwrap(), 3 * PRICE_SCALE / 2);
        assert_eq!(d(2.0).unwrap(), 2 * PRICE_SCALE);
        // f64 0.1 = 0.1000000000000000055511151231257827...
        assert_eq!(d(0.1).unwrap(), 100_000_000_000_000_005);
        assert_eq!(d(1000.25).unwrap(), 1_000_250_000_000_000_000_000);
        assert_eq!(d(1e10).unwrap(), 10_000_000_000 * PRICE_SCALE);
        for bad in [
            0.0,
            -1.0,
            f64::NAN,
            f64::INFINITY,
            f64::MIN_POSITIVE / 2.0,
            1e30,
        ] {
            assert!(d(bad).is_err(), "{bad} should be rejected");
        }
    }

    proptest! {
        /// Output never exceeds the exact rational constant-product output (pool never loses to rounding).
        #[test]
        fn swap_rounds_in_pool_favour(
            b in 1_000u64..1u64 << 24, q in 1_000u64..1u64 << 24,
            p in PRICE_SCALE / 1_000..PRICE_SCALE * 1_000,
            depth in 1u16..=10_000, fee in 0u16..=1_000, amt in 1u64..1u64 << 24, b2q in any::<bool>(),
        ) {
            let dir = if b2q { Direction::BaseToQuote } else { Direction::QuoteToBase };
            if let Ok(r) = quote_swap(b, q, p, depth, fee, amt, dir) {
                let (vb, _) = virtual_reserves(b, q, p, depth, dir).unwrap();
                let net = amt as u128 - r.fee as u128;
                let out = r.amount_out as u128;
                // exact: vq = vb * p / S. BaseToQuote out <= vq*net/(vb+net); QuoteToBase out <= vb*net/(vq+net).
                // Cross-multiplied with small bounds so everything fits in u128.
                match dir {
                    Direction::BaseToQuote => prop_assert!(out * (vb + net) * PRICE_SCALE <= vb * p * net),
                    Direction::QuoteToBase => prop_assert!(out * (vb * p + net * PRICE_SCALE) <= vb * net * PRICE_SCALE),
                }
                prop_assert!(r.fee as u128 * BPS >= amt as u128 * fee as u128);
                let out_reserve = if b2q { q } else { b };
                prop_assert!(out < out_reserve as u128);
            }
        }

        /// Deposit then withdraw of the same LP never returns more than was put in.
        #[test]
        fn deposit_withdraw_never_profits(
            b in 1u64..1u64 << 40, q in 1u64..1u64 << 40, s in 1_001u64..1u64 << 40,
            mb in 1u64..1u64 << 40, mq in 1u64..1u64 << 40,
        ) {
            if let Ok(d) = proportional_deposit(mb, mq, b, q, s) {
                prop_assert!(d.base_in <= mb && d.quote_in <= mq);
                let (ob, oq) = withdraw_amounts(d.lp, b + d.base_in, q + d.quote_in, s + d.lp).unwrap();
                prop_assert!(ob <= d.base_in && oq <= d.quote_in);
            }
        }

        /// Extreme inputs return errors, never panic.
        #[test]
        fn no_panics_at_extremes(
            b in any::<u64>(), q in any::<u64>(), p in any::<u128>(),
            depth in any::<u16>(), fee in 0u16..=10_000, amt in any::<u64>(), b2q in any::<bool>(),
        ) {
            let dir = if b2q { Direction::BaseToQuote } else { Direction::QuoteToBase };
            let _ = quote_swap(b, q, p, depth, fee, amt, dir);
            let _ = tvl_quote(b, q, p.min(MAX_PRICE));
            let _ = within_band(p, p / 2 + 1, depth);
            let _ = proportional_deposit(b, q, b, q, amt);
            let _ = withdraw_amounts(amt, b, q, amt.saturating_add(1));
            let _ = initial_lp(b, q);
        }
    }
}
