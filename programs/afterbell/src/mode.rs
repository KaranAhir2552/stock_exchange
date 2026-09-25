//! Market mode (brief 6.4) and the band/fee terms each mode trades under (6.5, 6.6).

use crate::errors::ErrorCode;
use crate::events::{ModeChanged, ReferenceUpdated};
use crate::math::{self, FeeRule};
use crate::oracle::{OraclePrice, OracleStatus};
use crate::state::{MarketCalendar, MarketProfile, Mode, Pool};
use anchor_lang::prelude::*;

/// `Option<Box<Account<MarketCalendar>>>` (as instructions hold it) -> `Option<&MarketCalendar>`.
pub fn cal<'a>(c: &'a Option<Box<Account<'_, MarketCalendar>>>) -> Option<&'a MarketCalendar> {
    c.as_deref().map(|c| &**c)
}

/// The mode the pool should be in right now. Every doubt resolves to the more protective mode.
pub fn target_mode(
    pool: &Pool,
    global_pause: bool,
    calendar: Option<&MarketCalendar>,
    oracle: &OraclePrice,
    now: i64,
) -> Result<Mode> {
    if global_pause || pool.halted || oracle.status_hint == Some(OracleStatus::Halted) {
        return Ok(Mode::Paused);
    }
    let valid = oracle.is_valid(pool, now);
    let mode = match pool.profile {
        MarketProfile::AlwaysOpen if valid => Mode::Open,
        MarketProfile::AlwaysOpen => Mode::Paused,
        MarketProfile::UsEquity => {
            // Expired calendar -> not in session -> Closed. The mock's `Closed` hint is ignored:
            // the calendar is the only authority on market hours.
            let cal = calendar.ok_or(ErrorCode::MissingCalendar)?;
            match (cal.in_session(now), valid) {
                (true, true) => Mode::Open,
                (true, false) => Mode::Paused, // scheduled hours but no trusted price: treat as halt
                (false, _) => Mode::Closed,
            }
        }
    };
    // A pool that has never had a trusted price has nothing to protect a band around.
    Ok(if mode == Mode::Closed && pool.reference_price == 0 {
        Mode::Paused
    } else {
        mode
    })
}

/// Moves the pool to its target mode. Re-centres only on a *newer* oracle price (or when
/// re-opening), which is what makes repeated calls harmless (DECISIONS.md #9).
pub fn refresh(
    pool: &mut Pool,
    pool_key: Pubkey,
    global_pause: bool,
    calendar: Option<&MarketCalendar>,
    oracle: &OraclePrice,
    now: i64,
) -> Result<()> {
    // Older data than we've already seen can't change anything (DECISIONS.md #10).
    require!(
        oracle.publish_ts >= pool.last_oracle_publish_ts,
        ErrorCode::StaleOracle
    );
    let target = target_mode(pool, global_pause, calendar, oracle, now)?;

    match target {
        Mode::Open
            if pool.mode != Mode::Open || oracle.publish_ts > pool.last_oracle_publish_ts =>
        {
            // Open -> Open tracks the oracle; Closed/Paused -> Open jumps straight to it (no trade needed).
            pool.reference_price = oracle.price;
            pool.pool_price = oracle.price;
            pool.last_oracle_publish_ts = oracle.publish_ts;
            emit!(ReferenceUpdated {
                pool: pool_key,
                reference_price: oracle.price,
                pool_price: oracle.price,
                oracle_publish_ts: oracle.publish_ts,
            });
        }
        // Entering Closed: reference and pool price stay frozen. The band and fee clock starts at the
        // last trusted price or the last session close, whichever is earlier.
        Mode::Closed if pool.mode != Mode::Closed => {
            let session_close = calendar.and_then(|c| c.last_close(now)).unwrap_or(i64::MAX);
            pool.close_ts = pool.last_oracle_publish_ts.min(session_close);
        }
        _ => {}
    }

    if target != pool.mode {
        emit!(ModeChanged {
            pool: pool_key,
            from: pool.mode,
            to: target,
            ts: now
        });
        pool.mode = target;
    }
    pool.last_update_ts = now;
    Ok(())
}

/// Fee rule and band (bps) for trading in the pool's current mode.
pub fn trading_terms(pool: &Pool, now: i64) -> Result<(FeeRule, u16)> {
    let p = &pool.params;
    match pool.mode {
        Mode::Paused => err!(ErrorCode::PoolPaused),
        Mode::Open => Ok((FeeRule::flat(p.open_fee_bps), p.open_band_bps)),
        Mode::Closed => {
            let elapsed = now.saturating_sub(pool.close_ts);
            let band = math::grow_bps(
                p.closed_base_band_bps,
                p.closed_band_growth_bps_per_hour,
                p.closed_max_band_bps,
                elapsed,
                false,
            )?;
            let base_fee = math::grow_bps(
                p.closed_base_fee_bps,
                p.closed_fee_growth_bps_per_hour,
                p.closed_max_fee_bps,
                elapsed,
                true,
            )?;
            let fee = FeeRule {
                base_bps: base_fee,
                size_bps_per_pct: p.size_fee_bps_per_1pct_depth,
                cap_bps: p.closed_max_fee_bps,
            };
            Ok((fee, band))
        }
    }
}
