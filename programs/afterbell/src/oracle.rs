use crate::errors::ErrorCode;
use crate::events::{ModeChanged, ReferenceUpdated};
use crate::math;
use crate::state::{MarketProfile, Mode, OracleKind, Pool, PRICE_SCALE};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, ExtensionType,
        StateWithExtensions,
    },
    state::Mint as SplMint,
};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OracleStatus {
    Trading,
    Halted,
    Closed,
}

#[derive(Clone, Copy, Debug)]
pub struct OraclePrice {
    /// Pool price units: quote atoms per base atom * PRICE_SCALE, UI multiplier applied.
    pub price: u128,
    pub conf_bps: u16,
    pub publish_ts: i64,
    pub status_hint: Option<OracleStatus>,
}

impl OraclePrice {
    pub fn is_valid(&self, pool: &Pool, now: i64) -> bool {
        now.saturating_sub(self.publish_ts) <= pool.max_staleness_secs as i64
            && self.conf_bps <= pool.max_conf_bps
    }
}

/// The single entry point for prices. Errors (never a silent fallback) on a wrong account or feed.
pub fn read_oracle(
    pool: &Pool,
    oracle: &AccountInfo,
    base_mint: &AccountInfo,
    now: i64,
) -> Result<OraclePrice> {
    let multiplier = ui_multiplier(base_mint, now)?;
    match pool.oracle_kind {
        OracleKind::Mock => read_mock(pool, oracle, multiplier),
        // ponytail: Pyth PriceUpdateV2 reader lands with the keeper in Phase 3; create_pool rejects Pyth until then.
        OracleKind::Pyth => err!(ErrorCode::WrongFeed),
    }
}

#[cfg(feature = "devnet-mock")]
fn read_mock(pool: &Pool, oracle: &AccountInfo, multiplier: u128) -> Result<OraclePrice> {
    use crate::state::{MockOracle, MockStatus};
    require_keys_eq!(*oracle.owner, crate::ID, ErrorCode::WrongFeed);
    let m = MockOracle::try_deserialize(&mut &oracle.try_borrow_data()?[..])
        .map_err(|_| error!(ErrorCode::WrongFeed))?;
    require!(m.feed_id == pool.feed_id, ErrorCode::WrongFeed);
    Ok(OraclePrice {
        price: math::oracle_to_pool_price(
            m.price,
            m.expo,
            pool.base_decimals,
            pool.quote_decimals,
            multiplier,
        )?,
        conf_bps: math::conf_bps(m.conf, m.price)?,
        publish_ts: m.publish_ts,
        status_hint: Some(match m.status {
            MockStatus::Trading => OracleStatus::Trading,
            MockStatus::Halted => OracleStatus::Halted,
            MockStatus::Closed => OracleStatus::Closed,
        }),
    })
}

#[cfg(not(feature = "devnet-mock"))]
fn read_mock(_: &Pool, _: &AccountInfo, _: u128) -> Result<OraclePrice> {
    err!(ErrorCode::WrongFeed)
}

/// Token-2022 ScaledUiAmount: one raw unit is worth `multiplier` UI units. 1.0 for everything else.
pub fn ui_multiplier(mint: &AccountInfo, now: i64) -> Result<u128> {
    if *mint.owner != TOKEN_2022_ID {
        return Ok(PRICE_SCALE);
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)?;
    let Ok(cfg) = state.get_extension::<ScaledUiAmountConfig>() else {
        return Ok(PRICE_SCALE);
    };
    // Same rule as spl-token-2022-interface ScaledUiAmountConfig::current_multiplier.
    let bytes = if now >= i64::from(cfg.new_multiplier_effective_timestamp) {
        cfg.new_multiplier.0
    } else {
        cfg.multiplier.0
    };
    math::f64_bytes_to_fixed(bytes)
}

/// Mint extensions a pool may hold. Anything that can move, freeze, tax, or hook vault transfers is out.
const ALLOWED_MINT_EXTENSIONS: &[ExtensionType] = &[
    ExtensionType::MintCloseAuthority,
    ExtensionType::MetadataPointer,
    ExtensionType::TokenMetadata,
    ExtensionType::GroupPointer,
    ExtensionType::TokenGroup,
    ExtensionType::GroupMemberPointer,
    ExtensionType::TokenGroupMember,
    ExtensionType::ScaledUiAmount,
];

pub fn check_mint_extensions(mint: &AccountInfo) -> Result<()> {
    if *mint.owner != TOKEN_2022_ID {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)?;
    for ext in state.get_extension_types()? {
        require!(
            ALLOWED_MINT_EXTENSIONS.contains(&ext),
            ErrorCode::UnsupportedMintExtension
        );
    }
    Ok(())
}

/// Recomputes the pool's mode from the oracle and re-centres on a *newer* oracle price.
/// Re-centring only on a newer publish time is what makes repeated calls harmless: resetting
/// `pool_price` on the same oracle price would let traders skip price impact (DECISIONS.md).
pub fn refresh(
    pool: &mut Pool,
    pool_key: Pubkey,
    global_pause: bool,
    oracle: &OraclePrice,
    now: i64,
) -> Result<()> {
    // Older data than we've already seen can't change anything (stops griefing with stale accounts).
    require!(
        oracle.publish_ts >= pool.last_oracle_publish_ts,
        ErrorCode::StaleOracle
    );
    let new_mode =
        if global_pause || pool.halted || oracle.status_hint == Some(OracleStatus::Halted) {
            Mode::Paused
        } else {
            match pool.profile {
                MarketProfile::AlwaysOpen if oracle.is_valid(pool, now) => Mode::Open,
                MarketProfile::AlwaysOpen => Mode::Paused,
                // ponytail: calendar-driven Open/Closed lands in Phase 2; create_pool rejects UsEquity until then.
                MarketProfile::UsEquity => Mode::Paused,
            }
        };

    if new_mode == Mode::Open
        && (pool.mode != Mode::Open || oracle.publish_ts > pool.last_oracle_publish_ts)
    {
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
    if new_mode != pool.mode {
        emit!(ModeChanged {
            pool: pool_key,
            from: pool.mode,
            to: new_mode,
            ts: now,
        });
        pool.mode = new_mode;
    }
    pool.last_update_ts = now;
    Ok(())
}
