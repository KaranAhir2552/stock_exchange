//! Phase 2: market modes, calendar, weekend band/fees, halts, pauses (brief 6.4, 6.11).
//! Dates are real 2026 weekdays; UTC session times follow US daylight saving
//! (EDT = UTC-4 until Nov 1, EST = UTC-5 after). Fixtures, not the official calendar.
mod common;

use afterbell::{errors::ErrorCode, math, mode::trading_terms, state::*};
use anchor_spl::token::ID as TOKEN_ID;
use common::*;

const B2Q: Direction = Direction::BaseToQuote;
const PRICE_90: i64 = 9_000_000_000;
const P90: u128 = P100 * 9 / 10;

type Atas = (
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::Pubkey,
);

fn s(open: i64, close: i64) -> Session {
    Session {
        open_ts: open,
        close_ts: close,
    }
}

/// Thu Oct 1, Fri Oct 2, Mon Oct 5, Tue Oct 6 2026, 9:30-16:00 EDT.
fn october() -> Vec<Session> {
    [(10, 1), (10, 2), (10, 5), (10, 6)]
        .iter()
        .map(|&(m, d)| s(utc(2026, m, d, 13, 30), utc(2026, m, d, 20, 0)))
        .collect()
}

/// Thanksgiving week 2026 (EST): Wed normal, Thu closed, Fri early close 13:00 ET, Mon normal.
fn thanksgiving() -> Vec<Session> {
    vec![
        s(utc(2026, 11, 25, 14, 30), utc(2026, 11, 25, 21, 0)),
        s(utc(2026, 11, 27, 14, 30), utc(2026, 11, 27, 18, 0)),
        s(utc(2026, 11, 30, 14, 30), utc(2026, 11, 30, 21, 0)),
    ]
}

/// UsEquity pool created at `now` (price published at `now`), seeded with 1M/1M when it opens.
fn equity(now: i64, sessions: Vec<Session>, valid_until: i64) -> (H, Atas) {
    let mut h = H::bare();
    h.set_time(now);
    h.init_config(0).unwrap();
    h.create_calendar().unwrap();
    h.set_sessions(sessions, valid_until).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    let mut args = pool_args(default_params());
    args.profile = MarketProfile::UsEquity;
    h.create_pool(args).unwrap();
    let atas = h.fund_user(10_000_000, 10_000_000);
    if h.pool_state().mode == Mode::Open {
        h.deposit(atas, 1_000_000, 1_000_000, 0).unwrap();
    }
    (h, atas)
}

fn mode(h: &H) -> Mode {
    h.pool_state().mode
}

/// On-chain swap equals the off-chain quote under the current mode's terms.
fn swap_matches_quote(h: &mut H, atas: Atas, amount_in: u64) -> math::SwapQuote {
    let pool = h.pool_state();
    let (fee, _) = trading_terms(&pool, h.now()).unwrap();
    let (vb, vq) = (h.vault(&h.base_mint), h.vault(&h.quote_mint));
    let q = math::quote_swap(
        h.balance(&vb),
        h.balance(&vq),
        pool.pool_price,
        pool.params.depth_bps,
        fee,
        amount_in,
        B2Q,
    )
    .unwrap();
    let before = h.balance(&atas.1);
    h.swap(atas, amount_in, q.amount_out, B2Q).unwrap();
    assert_eq!(h.balance(&atas.1) - before, q.amount_out);
    assert_eq!(h.pool_state().pool_price, q.new_price);
    q
}

#[test]
fn friday_close_weekend_news_and_monday_recenter() {
    let (mut h, atas) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));
    assert_eq!(mode(&h), Mode::Open);

    // Last trusted price of the week.
    h.set_time(utc(2026, 10, 2, 19, 59));
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();

    // Friday 16:00 ET: the session ends (close is exclusive). Prices freeze, band clock starts at the
    // last trusted price because it's earlier than the session close.
    h.set_time(utc(2026, 10, 2, 20, 0));
    h.update_reference().unwrap();
    let p = h.pool_state();
    assert_eq!(p.mode, Mode::Closed);
    assert_eq!((p.reference_price, p.pool_price), (P100, P100));
    assert_eq!(p.close_ts, utc(2026, 10, 2, 19, 59));

    // Saturday: weekend news moves the (mock) oracle -10%. Closed ignores it; repeat calls are harmless.
    h.set_time(utc(2026, 10, 3, 12, 0));
    h.set_price(PRICE_90, 0).unwrap();
    h.update_reference().unwrap();
    h.update_reference().unwrap();
    let p = h.pool_state();
    assert_eq!(
        (p.mode, p.reference_price, p.pool_price),
        (Mode::Closed, P100, P100)
    );

    // 16h01m after the last trusted price: band 200 + 10/h -> 360 bps (floor); fee 60 + 1/h -> 77 bps (ceil).
    let (fee, band) = trading_terms(&p, h.now()).unwrap();
    assert_eq!(band, 360);
    assert_eq!(
        (fee.base_bps, fee.size_bps_per_pct, fee.cap_bps),
        (77, 5, 300)
    );

    // A ~5% move breaks the 3.6% band; a ~3% move fits and pays the size fee on top.
    assert_err(h.swap(atas, 25_000, 1, B2Q), ErrorCode::OutsideBand);
    let q = swap_matches_quote(&mut h, atas, 15_000);
    assert_eq!(q.fee_bps, 85); // 77 + ceil(5 * 1.5% of depth)

    // Deposits are allowed while Closed.
    h.deposit(atas, 1_000, 1_000, 0).unwrap();

    // Monday 9:29 ET: still Closed.
    h.set_time(utc(2026, 10, 5, 13, 29));
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Closed);

    // Monday 9:30 ET: fresh price. The pool jumps straight to it with no trade, so nobody can
    // arbitrage the gap against LPs.
    h.set_time(utc(2026, 10, 5, 13, 30));
    h.set_price(PRICE_90, 0).unwrap();
    h.update_reference().unwrap();
    let p = h.pool_state();
    assert_eq!(
        (p.mode, p.reference_price, p.pool_price),
        (Mode::Open, P90, P90)
    );
    assert_eq!(trading_terms(&p, h.now()).unwrap().1, 100); // back to the Open band
}

#[test]
fn thanksgiving_holiday_and_early_close() {
    let (mut h, _) = equity(
        utc(2026, 11, 25, 20, 0),
        thanksgiving(),
        utc(2026, 12, 5, 0, 0),
    );
    assert_eq!(mode(&h), Mode::Open);

    // Thanksgiving Thursday: normal hours but no session. A fresh price doesn't open the pool.
    h.set_time(utc(2026, 11, 26, 15, 0));
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Closed);
    assert_eq!(h.pool_state().close_ts, utc(2026, 11, 25, 20, 0));

    // Friday opens normally...
    h.set_time(utc(2026, 11, 27, 14, 30));
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Open);

    // ...and closes early at 13:00 ET (18:00 UTC).
    h.set_time(utc(2026, 11, 27, 17, 59));
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    h.set_time(utc(2026, 11, 27, 18, 0));
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Closed);
    assert_eq!(h.pool_state().close_ts, utc(2026, 11, 27, 17, 59));

    h.set_time(utc(2026, 11, 30, 14, 30));
    h.set_price(PRICE_90, 0).unwrap();
    h.update_reference().unwrap();
    assert_eq!((mode(&h), h.pool_state().pool_price), (Mode::Open, P90));
}

#[test]
fn stale_oracle_in_session_pauses_and_expired_calendar_closes() {
    let (mut h, atas) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));

    // In session with no fresh price: unexpected, so Paused (not Closed).
    h.warp(61);
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Paused);
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    assert_err(h.deposit(atas, 1_000, 1_000, 0), ErrorCode::PoolPaused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();

    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Open);

    // Calendar runs out mid-session: treated as Closed even with a fresh price.
    let now = h.now();
    h.set_sessions(october(), now + 10).unwrap();
    h.warp(20);
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Closed);
}

#[test]
fn halt_blocks_trading_but_not_withdrawals_and_only_admin_resumes() {
    let (mut h, atas) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));
    let (guardian, admin, user) = (
        h.guardian.insecure_clone(),
        h.admin.insecure_clone(),
        h.user.insecure_clone(),
    );

    assert_err(h.set_halt_as(&user, true), ErrorCode::Unauthorized);
    h.set_halt_as(&guardian, true).unwrap();
    assert_eq!(mode(&h), Mode::Paused); // immediately, no refresh needed
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    assert_err(h.deposit(atas, 1_000, 1_000, 0), ErrorCode::PoolPaused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();

    // The guardian can only make things safer.
    assert_err(h.set_halt_as(&guardian, false), ErrorCode::Unauthorized);
    h.set_halt_as(&admin, false).unwrap();
    assert_eq!(mode(&h), Mode::Paused); // stays Paused until a refresh confirms a trusted price
    h.swap(atas, 1_000, 1, B2Q).unwrap();
    assert_eq!(mode(&h), Mode::Open);

    // Oracle-reported halt (mock status) works the same way.
    h.set_status(MockStatus::Halted).unwrap();
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    h.set_status(MockStatus::Trading).unwrap();
    h.swap(atas, 1_000, 1, B2Q).unwrap();
}

#[test]
fn halt_over_the_close_keeps_the_weekend_clock() {
    let (mut h, _) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));
    h.set_time(utc(2026, 10, 2, 20, 0));
    h.update_reference().unwrap();
    let close_ts = h.pool_state().close_ts;
    assert_eq!(close_ts, utc(2026, 10, 2, 15, 0));

    let (guardian, admin) = (h.guardian.insecure_clone(), h.admin.insecure_clone());
    h.set_time(utc(2026, 10, 3, 10, 0));
    h.set_halt_as(&guardian, true).unwrap();
    assert_eq!(mode(&h), Mode::Paused);
    h.set_halt_as(&admin, false).unwrap();
    h.update_reference().unwrap();
    assert_eq!(
        (mode(&h), h.pool_state().close_ts),
        (Mode::Closed, close_ts)
    );
}

#[test]
fn global_pause_blocks_every_pool_until_admin_resumes() {
    let (mut h, atas) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));
    let (guardian, admin, user) = (
        h.guardian.insecure_clone(),
        h.admin.insecure_clone(),
        h.user.insecure_clone(),
    );

    assert_err(h.set_global_pause_as(&user, true), ErrorCode::Unauthorized);
    h.set_global_pause_as(&guardian, true).unwrap();
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    assert_err(h.deposit(atas, 1_000, 1_000, 0), ErrorCode::PoolPaused);
    h.update_reference().unwrap();
    assert_eq!(mode(&h), Mode::Paused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();

    assert_err(
        h.set_global_pause_as(&guardian, false),
        ErrorCode::Unauthorized,
    );
    h.set_global_pause_as(&admin, false).unwrap();
    h.swap(atas, 1_000, 1, B2Q).unwrap();
    assert_eq!(mode(&h), Mode::Open);
}

#[test]
fn band_and_fee_grow_then_cap() {
    let (mut h, atas) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));
    let mut params = default_params();
    params.closed_band_growth_bps_per_hour = 100;
    params.closed_fee_growth_bps_per_hour = 50;
    let user = h.user.insecure_clone();
    assert_err(h.set_params_as(&user, params), ErrorCode::Unauthorized);
    let mut bad = params;
    bad.closed_max_fee_bps = 5_000; // over the 10% fee ceiling
    assert_err(h.set_params(bad), ErrorCode::InvalidParams);
    h.set_params(params).unwrap();

    h.set_time(utc(2026, 10, 2, 20, 0));
    h.update_reference().unwrap(); // close_ts = 15:00 (creation price)

    // 1 hour after the last trusted price: band 200 + 100 = 300, fee 60 + 50 = 110.
    let (fee, band) = trading_terms(&h.pool_state(), utc(2026, 10, 2, 16, 0)).unwrap();
    assert_eq!((band, fee.base_bps), (300, 110));

    // Saturday: both capped (band 1000, fee 300), and a big trade's size fee can't exceed the cap.
    h.set_time(utc(2026, 10, 3, 12, 0));
    let (fee, band) = trading_terms(&h.pool_state(), h.now()).unwrap();
    assert_eq!((band, fee.base_bps), (1_000, 300));
    let q = swap_matches_quote(&mut h, atas, 40_000);
    assert_eq!(q.fee_bps, 300);
}

#[test]
fn always_open_pool_trades_through_the_weekend() {
    let (mut h, atas) = H::seeded(1_000_000);
    h.set_time(utc(2026, 10, 3, 12, 0)); // Saturday
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    let p = h.pool_state();
    assert_eq!(p.mode, Mode::Open);
    assert_eq!(trading_terms(&p, h.now()).unwrap().1, 100);
    let q = swap_matches_quote(&mut h, atas, 1_000);
    assert_eq!(q.fee_bps, 30);
}

#[test]
fn pool_created_while_closed_waits_for_first_price() {
    // Created on a Saturday: no trusted price yet, so nothing to anchor a band to -> Paused.
    let (mut h, atas) = equity(utc(2026, 10, 3, 12, 0), october(), utc(2026, 10, 10, 0, 0));
    let p = h.pool_state();
    assert_eq!((p.mode, p.reference_price), (Mode::Paused, 0));
    assert_err(
        h.deposit(atas, 1_000_000, 1_000_000, 0),
        ErrorCode::PoolPaused,
    );

    h.set_time(utc(2026, 10, 5, 13, 30));
    h.set_price(PRICE_100, 0).unwrap();
    h.deposit(atas, 1_000_000, 1_000_000, 0).unwrap();
    assert_eq!(mode(&h), Mode::Open);
}

#[test]
fn equity_pool_requires_its_calendar() {
    let (mut h, atas) = equity(utc(2026, 10, 2, 15, 0), october(), utc(2026, 10, 10, 0, 0));
    h.calendar = None;
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::MissingCalendar);
    assert_err(h.update_reference(), ErrorCode::MissingCalendar);
}

#[test]
fn calendar_validation() {
    let mut h = H::bare();
    h.set_time(utc(2026, 10, 2, 15, 0));
    h.init_config(0).unwrap();
    h.create_calendar().unwrap();
    let later = utc(2026, 10, 10, 0, 0);

    let mut unsorted = october();
    unsorted.swap(0, 1);
    assert_err(h.set_sessions(unsorted, later), ErrorCode::InvalidParams);
    let overlapping = vec![s(100, 200), s(150, 300)];
    assert_err(h.set_sessions(overlapping, later), ErrorCode::InvalidParams);
    assert_err(
        h.set_sessions(vec![s(200, 100)], later),
        ErrorCode::InvalidParams,
    );
    let too_many = (0..MAX_SESSIONS as i64 + 1)
        .map(|i| s(i * 10, i * 10 + 5))
        .collect();
    assert_err(h.set_sessions(too_many, later), ErrorCode::InvalidParams);
    assert_err(
        h.set_sessions(october(), h.now()),
        ErrorCode::CalendarExpired,
    );

    let full = (0..MAX_SESSIONS as i64)
        .map(|i| s(i * 10, i * 10 + 5))
        .collect();
    h.set_sessions(full, later).unwrap(); // a full calendar fits in one transaction
    h.set_sessions(october(), later).unwrap();
}
