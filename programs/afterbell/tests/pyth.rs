//! Pyth `PriceUpdateV2` oracle path (brief 6.3). Accounts are built the way the Pyth receiver writes
//! them; feed ids and prices here are test fixtures, not real Pyth feeds.
mod common;

use afterbell::{errors::ErrorCode, state::*};
use anchor_spl::token::ID as TOKEN_ID;
use common::*;

const B2Q: Direction = Direction::BaseToQuote;

/// AlwaysOpen pool on a Pyth oracle, 1M/1M liquidity. Returns the harness and user ATAs.
fn pyth_pool() -> (H, Atas) {
    let mut h = H::bare();
    h.init_config(0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    let now = h.now();
    h.pyth = Some(h.post_pyth(PythUpdate::new(PRICE_100, now)));
    let mut args = pool_args(default_params());
    args.oracle_kind = OracleKind::Pyth;
    h.create_pool(args).unwrap();
    let atas = h.fund_user(10_000_000, 10_000_000);
    h.deposit(atas, 1_000_000, 1_000_000, 0).unwrap();
    (h, atas)
}

#[test]
fn verified_pyth_update_prices_the_pool() {
    let (mut h, atas) = pyth_pool();
    let p = h.pool_state();
    assert_eq!(
        (p.mode, p.reference_price, p.pool_price),
        (Mode::Open, P100, P100)
    );
    h.swap(atas, 1_000, 996, B2Q).unwrap();
}

#[test]
fn newer_update_in_a_new_account_recentres_and_older_is_refused() {
    let (mut h, atas) = pyth_pool();
    let old = h.pyth.unwrap();
    h.warp(10);
    let now = h.now();
    let newer = h.post_pyth(PythUpdate::new(PRICE_100 * 101 / 100, now));
    h.update_reference_with(newer).unwrap();
    assert_eq!(h.pool_state().reference_price, P100 * 101 / 100);
    // Anyone could pass an old (still receiver-owned) update; it must not move the pool.
    assert_err(h.update_reference_with(old), ErrorCode::StaleOracle);
    assert_err(
        h.swap_with(atas, 1_000, 1, B2Q, old, None),
        ErrorCode::StaleOracle,
    );
}

#[test]
fn stale_or_uncertain_pyth_price_pauses() {
    let (mut h, atas) = pyth_pool();
    h.warp(61);
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    let now = h.now();
    let mut wide = PythUpdate::new(PRICE_100, now);
    wide.conf = PRICE_100 as u64 / 50; // 2% > 1% max
    let wide = h.post_pyth(wide);
    h.update_reference_with(wide).unwrap();
    assert_eq!(h.pool_state().mode, Mode::Paused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();
}

#[test]
fn rejects_wrong_feed_wrong_owner_and_partial_verification() {
    let (mut h, _) = pyth_pool();
    let now = h.now();

    let mut other_feed = PythUpdate::new(PRICE_100, now);
    other_feed.feed = [9; 32];
    let other_feed = h.post_pyth(other_feed);
    assert_err(h.update_reference_with(other_feed), ErrorCode::WrongFeed);

    // Byte-identical update, but not owned by the Pyth receiver (anyone can create such an account).
    let mut forged = PythUpdate::new(PRICE_100, now);
    forged.owner = TOKEN_ID;
    let forged = h.post_pyth(forged);
    assert_err(h.update_reference_with(forged), ErrorCode::WrongFeed);

    let mut partial = PythUpdate::new(PRICE_100, now);
    partial.full = false;
    let partial = h.post_pyth(partial);
    assert_err(
        h.update_reference_with(partial),
        ErrorCode::OracleNotVerified,
    );

    // A mock oracle account can't stand in for Pyth either.
    h.set_price(PRICE_100, 0).unwrap();
    let mock = h.oracle_for(FEED);
    assert_err(h.update_reference_with(mock), ErrorCode::WrongFeed);
}

/// Pyth Core's August 2026 upgrade moved Solana price updates to a new receiver program
/// (docs.pyth.network/price-feeds/core/upgrade/contracts). Updates from the old receiver are refused.
#[test]
fn only_the_upgraded_pyth_receiver_is_trusted() {
    assert_eq!(
        pyth_solana_receiver_sdk::ID.to_string(),
        "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"
    );
    let (mut h, _) = pyth_pool();
    let mut old = PythUpdate::new(PRICE_100, h.now());
    old.owner = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
        .parse()
        .unwrap();
    let old = h.post_pyth(old);
    assert_err(h.update_reference_with(old), ErrorCode::WrongFeed);
}
