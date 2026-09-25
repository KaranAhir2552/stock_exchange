mod common;

use afterbell::{errors::ErrorCode, math, state::*};
use anchor_spl::{token::ID as TOKEN_ID, token_2022::ID as TOKEN_2022_ID};
use common::*;
use solana_signer::Signer;

const B2Q: Direction = Direction::BaseToQuote;
const Q2B: Direction = Direction::QuoteToBase;

// ---------- config & pool creation ----------

#[test]
fn initialize_config_requires_upgrade_authority() {
    let mut h = H::bare();
    let stranger = solana_keypair::Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert_err(h.init_config_as(&stranger, 0), ErrorCode::Unauthorized);
    h.init_config(0).unwrap();
    assert!(
        h.init_config(0).is_err(),
        "config can only be initialized once"
    );
}

#[test]
fn create_pool_opens_at_oracle_price() {
    let h = H::new();
    let p = h.pool_state();
    assert_eq!(p.mode, Mode::Open);
    assert_eq!(p.reference_price, P100);
    assert_eq!(p.pool_price, P100);
    assert_eq!(p.last_oracle_publish_ts, START_TS);
}

#[test]
fn create_pool_validation() {
    let mut h = H::bare();
    h.init_config(0).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);

    let stranger = h.user.insecure_clone();
    let oracle = h.oracle();
    assert_err(
        h.create_pool_as(&stranger, pool_args(default_params()), oracle),
        ErrorCode::Unauthorized,
    );

    let mut bad = default_params();
    bad.open_band_bps = 0;
    assert_err(h.create_pool(pool_args(bad)), ErrorCode::InvalidParams);
    let mut bad = default_params();
    bad.closed_base_band_bps = 2_000; // > closed_max_band_bps
    assert_err(h.create_pool(pool_args(bad)), ErrorCode::InvalidParams);

    // UsEquity without its calendar is refused; a Pyth pool must be given a real Pyth price account.
    let mut a = pool_args(default_params());
    a.profile = MarketProfile::UsEquity;
    assert_err(h.create_pool(a), ErrorCode::MissingCalendar);
    let mut a = pool_args(default_params());
    a.oracle_kind = OracleKind::Pyth;
    assert_err(h.create_pool(a), ErrorCode::WrongFeed); // a mock account is not a Pyth price update

    h.create_pool(pool_args(default_params())).unwrap();
}

#[test]
fn rejects_transfer_fee_mint() {
    let mut h = H::bare();
    h.init_config(0).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.t22_mint(BASE_DECIMALS, None, true);
    h.base_prog = TOKEN_2022_ID;
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    assert_err(
        h.create_pool(pool_args(default_params())),
        ErrorCode::UnsupportedMintExtension,
    );
}

#[test]
fn scaled_ui_amount_multiplier_applies_to_price_and_token2022_trades_work() {
    let mut h = H::bare();
    h.init_config(0).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    // One raw unit = 2 shares (e.g. after a 2-for-1 split), so a base atom is worth twice as much.
    h.base_mint = h.t22_mint(BASE_DECIMALS, Some(2.0), false);
    h.base_prog = TOKEN_2022_ID;
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    h.create_pool(pool_args(default_params())).unwrap();
    assert_eq!(h.pool_state().reference_price, 2 * P100);

    let atas = h.fund_user(10_000_000, 10_000_000);
    h.deposit(atas, 1_000_000, 2_000_000, 0).unwrap();
    h.swap(atas, 1_000, 1, B2Q).unwrap();
    h.swap(atas, 1_000, 1, Q2B).unwrap();
}

// ---------- liquidity ----------

#[test]
fn deposit_and_withdraw_are_proportional() {
    let mut h = H::new();
    let atas = h.fund_user(10_000_000, 10_000_000);
    let (vb, vq) = (h.vault(&h.base_mint), h.vault(&h.quote_mint));

    h.deposit(atas, 1_000_000, 4_000_000, 0).unwrap();
    // sqrt(1e6 * 4e6) = 2e6, minus the permanently locked minimum.
    assert_eq!(h.balance(&atas.2), 2_000_000 - MIN_LIQUIDITY);
    assert_eq!((h.balance(&vb), h.balance(&vq)), (1_000_000, 4_000_000));

    // Second deposit takes the reserve ratio (1:4) and never more than offered.
    h.deposit(atas, 100, 1_000, 0).unwrap();
    assert_eq!(h.balance(&atas.2), 2_000_000 - MIN_LIQUIDITY + 200);
    assert_eq!((h.balance(&vb), h.balance(&vq)), (1_000_100, 4_000_400));

    assert_err(
        h.deposit(atas, 100, 1_000, 201),
        ErrorCode::SlippageExceeded,
    );

    // Withdraw everything: user gets all but the locked share, rounded down.
    let lp = h.balance(&atas.2);
    let (b0, q0) = (h.balance(&atas.0), h.balance(&atas.1));
    assert_err(
        h.withdraw(atas, lp, 1_000_100, 0),
        ErrorCode::SlippageExceeded,
    );
    h.withdraw(atas, lp, 0, 0).unwrap();
    let (got_b, got_q) = (h.balance(&atas.0) - b0, h.balance(&atas.1) - q0);
    assert_eq!(got_b, 1_000_100 * lp / (lp + MIN_LIQUIDITY));
    assert_eq!(got_q, 4_000_400 * lp / (lp + MIN_LIQUIDITY));
    assert_eq!(h.supply(&h.lp_mint()), 0);
    assert!(
        h.balance(&vb) > 0 && h.balance(&vq) > 0,
        "locked share stays in the pool"
    );
}

#[test]
fn tvl_cap_is_enforced() {
    let mut h = H::bare();
    h.init_config(0).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    let mut params = default_params();
    params.max_tvl_quote = 1_500_000;
    h.create_pool(pool_args(params)).unwrap();
    let atas = h.fund_user(10_000_000, 10_000_000);
    // TVL = quote + base * price = 1M + 1M = 2M > 1.5M.
    assert_err(
        h.deposit(atas, 1_000_000, 1_000_000, 0),
        ErrorCode::TvlCapExceeded,
    );
    h.deposit(atas, 500_000, 500_000, 0).unwrap();
}

// ---------- swaps ----------

#[test]
fn swap_matches_math_and_keeps_fees_in_pool() {
    let (mut h, atas) = H::seeded(1_000_000);
    let (vb, vq) = (h.vault(&h.base_mint), h.vault(&h.quote_mint));
    let before = h.pool_state();
    let expected = math::quote_swap(
        h.balance(&vb),
        h.balance(&vq),
        before.pool_price,
        before.params.depth_bps,
        math::FeeRule::flat(before.params.open_fee_bps),
        1_000,
        B2Q,
    )
    .unwrap();

    let q0 = h.balance(&atas.1);
    h.swap(atas, 1_000, expected.amount_out, B2Q).unwrap();
    assert_eq!(h.balance(&atas.1) - q0, expected.amount_out);
    assert_eq!(expected.amount_out, 996);
    assert_eq!(h.pool_state().pool_price, expected.new_price);
    // Whole input (fee included) stays in the vault.
    assert_eq!(
        (h.balance(&vb), h.balance(&vq)),
        (1_001_000, 1_000_000 - 996)
    );

    // Round trip back: LP value at the reference price only goes up.
    h.swap(atas, 996, 1, Q2B).unwrap();
    let value = |h: &H| h.balance(&vb) as u128 + h.balance(&vq) as u128; // price 1 quote atom per base atom
    assert!(value(&h) > 2_000_000);
}

#[test]
fn swap_outside_band_is_rejected() {
    let (mut h, atas) = H::seeded(1_000_000);
    // Selling 2% of depth moves the price ~4%, past the 1% Open band.
    assert_err(h.swap(atas, 20_000, 1, B2Q), ErrorCode::OutsideBand);
    assert_err(h.swap(atas, 20_000, 1, Q2B), ErrorCode::OutsideBand);
    h.swap(atas, 4_000, 1, B2Q).unwrap();
}

#[test]
fn slippage_protection() {
    let (mut h, atas) = H::seeded(1_000_000);
    assert_err(h.swap(atas, 1_000, 997, B2Q), ErrorCode::SlippageExceeded);
    h.swap(atas, 1_000, 996, B2Q).unwrap();
}

#[test]
fn protocol_fee_goes_to_treasury() {
    let mut h = H::bare();
    h.init_config(5_000).unwrap(); // half of every fee
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    h.create_pool(pool_args(default_params())).unwrap();
    let atas = h.fund_user(10_000_000, 10_000_000);
    h.deposit(atas, 1_000_000, 1_000_000, 0).unwrap();
    let (t, bm) = (h.treasury.pubkey(), h.base_mint);
    let treasury_base = h.fund(&t, &bm, &TOKEN_ID, 0);
    let oracle = h.oracle();

    assert_err(
        h.swap_with(atas, 1_000, 1, B2Q, oracle, None),
        ErrorCode::InvalidParams,
    );
    h.swap_with(atas, 1_000, 1, B2Q, oracle, Some(treasury_base))
        .unwrap();
    // fee = ceil(1000 * 0.3%) = 3; protocol share = floor(3 * 50%) = 1.
    assert_eq!(h.balance(&treasury_base), 1);
    assert_eq!(h.balance(&h.vault(&bm)), 1_000_000 + 999);
}

// ---------- oracle & mode ----------

#[test]
fn stale_oracle_pauses_swaps_and_deposits_but_not_withdrawals() {
    let (mut h, atas) = H::seeded(1_000_000);
    h.warp(61); // max_staleness_secs = 60
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    assert_err(h.deposit(atas, 1_000, 1_000, 0), ErrorCode::PoolPaused);
    h.update_reference().unwrap();
    assert_eq!(h.pool_state().mode, Mode::Paused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();

    // A fresh price reopens the pool.
    h.set_price(PRICE_100, 0).unwrap();
    h.swap(atas, 1_000, 1, B2Q).unwrap();
    assert_eq!(h.pool_state().mode, Mode::Open);
}

#[test]
fn wide_confidence_pauses() {
    let (mut h, atas) = H::seeded(1_000_000);
    h.warp(1);
    h.set_price(PRICE_100, PRICE_100 as u64 / 50).unwrap(); // 2% conf > 1% max
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    h.update_reference().unwrap();
    assert_eq!(h.pool_state().mode, Mode::Paused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();
}

#[test]
fn oracle_halt_status_pauses_until_trading_resumes() {
    let (mut h, atas) = H::seeded(1_000_000);
    h.set_status(MockStatus::Halted).unwrap();
    assert_err(h.swap(atas, 1_000, 1, B2Q), ErrorCode::PoolPaused);
    assert_err(h.deposit(atas, 1_000, 1_000, 0), ErrorCode::PoolPaused);
    h.withdraw(atas, 1_000, 0, 0).unwrap();
    h.set_status(MockStatus::Trading).unwrap();
    h.swap(atas, 1_000, 1, B2Q).unwrap();
}

#[test]
fn wrong_feed_and_wrong_owner_are_rejected() {
    let (mut h, atas) = H::seeded(1_000_000);
    let other_feed = [9u8; 32];
    h.set_price_for(other_feed, PRICE_100, 0).unwrap();
    let other = h.oracle_for(other_feed);
    assert_err(
        h.swap_with(atas, 1_000, 1, B2Q, other, None),
        ErrorCode::WrongFeed,
    );
    assert_err(h.update_reference_with(other), ErrorCode::WrongFeed);

    // Byte-identical copy of the real oracle, but owned by another program.
    let mut fake = h.svm.get_account(&h.oracle()).unwrap();
    fake.owner = TOKEN_ID;
    let fake_key = solana_keypair::Keypair::new().pubkey();
    h.svm.set_account(fake_key, fake).unwrap();
    assert_err(
        h.swap_with(atas, 1_000, 1, B2Q, fake_key, None),
        ErrorCode::WrongFeed,
    );
}

#[test]
fn older_oracle_data_cannot_change_the_pool() {
    let (mut h, _) = H::seeded(1_000_000);
    let old = h.svm.get_account(&h.oracle()).unwrap();
    h.warp(10);
    h.set_price(PRICE_100 + 1_000_000, 0).unwrap();
    h.update_reference().unwrap();
    // Replay the older snapshot from an account our program owns.
    let replay = solana_keypair::Keypair::new().pubkey();
    h.svm.set_account(replay, old).unwrap();
    assert_err(h.update_reference_with(replay), ErrorCode::StaleOracle);
}

#[test]
fn recentre_only_on_newer_oracle_price_so_repeat_calls_are_harmless() {
    let (mut h, atas) = H::seeded(1_000_000);
    h.swap(atas, 4_000, 1, B2Q).unwrap();
    let moved = h.pool_state().pool_price;
    assert!(moved < P100);

    // Same oracle price: repeated update_reference must not undo the trade's price impact.
    h.update_reference().unwrap();
    h.update_reference().unwrap();
    assert_eq!(h.pool_state().pool_price, moved);
    // Splitting a trade doesn't help: the second leg continues from the moved price and the band is
    // measured from the reference, so another 4k now breaks the 1% band while a small trade still fits.
    assert_err(h.swap(atas, 4_000, 1, B2Q), ErrorCode::OutsideBand);
    h.swap(atas, 500, 1, B2Q).unwrap();
    assert!(h.pool_state().pool_price < moved);

    // A newer oracle price re-centres both prices.
    h.warp(1);
    h.set_price(PRICE_100, 0).unwrap();
    h.update_reference().unwrap();
    let p = h.pool_state();
    assert_eq!(
        (p.pool_price, p.reference_price, p.last_oracle_publish_ts),
        (P100, P100, START_TS + 1)
    );
}

#[test]
fn stale_at_creation_starts_paused_then_opens() {
    let mut h = H::bare();
    h.init_config(0).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    h.warp(120);
    h.create_pool(pool_args(default_params())).unwrap();
    assert_eq!(h.pool_state().mode, Mode::Paused);
    assert_eq!(h.pool_state().pool_price, 0);
    let atas = h.fund_user(10_000_000, 10_000_000);
    assert_err(
        h.deposit(atas, 1_000_000, 1_000_000, 0),
        ErrorCode::PoolPaused,
    );
    h.set_price(PRICE_100, 0).unwrap();
    h.deposit(atas, 1_000_000, 1_000_000, 0).unwrap();
    assert_eq!(h.pool_state().mode, Mode::Open);
}
