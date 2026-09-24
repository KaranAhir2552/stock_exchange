use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

/// Prices are (quote atoms per 1 base atom) * PRICE_SCALE.
pub const PRICE_SCALE: u128 = 1_000_000_000_000_000_000;
/// Upper bound on any price we accept. Keeps every intermediate in u128 (see math.rs).
pub const MAX_PRICE: u128 = 1 << 96;
pub const BPS: u128 = 10_000;
/// LP units permanently locked on the first deposit (never minted to anyone).
pub const MIN_LIQUIDITY: u64 = 1_000;
pub const LP_DECIMALS: u8 = 9;

pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const LP_SEED: &[u8] = b"lp";
pub const MOCK_ORACLE_SEED: &[u8] = b"mock_oracle";

/// Parameter bounds enforced by `PoolParams::validate`.
pub const MAX_BAND_BPS: u16 = 5_000;
pub const MAX_FEE_BPS: u16 = 1_000;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 5_000;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub guardian: Pubkey,
    pub protocol_fee_bps: u16,
    pub treasury: Pubkey,
    pub global_pause: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MarketProfile {
    AlwaysOpen,
    UsEquity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OracleKind {
    Pyth,
    Mock,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Mode {
    Open,
    Closed,
    Paused,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Direction {
    BaseToQuote,
    QuoteToBase,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct PoolParams {
    pub open_band_bps: u16,
    pub closed_base_band_bps: u16,
    pub closed_band_growth_bps_per_hour: u16,
    pub closed_max_band_bps: u16,
    pub open_fee_bps: u16,
    pub closed_base_fee_bps: u16,
    pub closed_fee_growth_bps_per_hour: u16,
    pub closed_max_fee_bps: u16,
    pub size_fee_bps_per_1pct_depth: u16,
    pub depth_bps: u16,
    pub max_tvl_quote: u64,
}

impl PoolParams {
    pub fn validate(&self) -> Result<()> {
        let ok = (1..=MAX_BAND_BPS).contains(&self.open_band_bps)
            && (1..=MAX_BAND_BPS).contains(&self.closed_base_band_bps)
            && self.closed_base_band_bps <= self.closed_max_band_bps
            && self.closed_max_band_bps <= MAX_BAND_BPS
            && self.closed_band_growth_bps_per_hour <= MAX_BAND_BPS
            && self.open_fee_bps <= MAX_FEE_BPS
            && self.closed_base_fee_bps <= self.closed_max_fee_bps
            && self.closed_max_fee_bps <= MAX_FEE_BPS
            && self.closed_fee_growth_bps_per_hour <= MAX_FEE_BPS
            && self.size_fee_bps_per_1pct_depth <= MAX_FEE_BPS
            && (1..=BPS as u16).contains(&self.depth_bps);
        require!(ok, ErrorCode::InvalidParams);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub lp_mint: Pubkey,
    pub base_token_program: Pubkey,
    pub quote_token_program: Pubkey,
    pub base_decimals: u8,
    pub quote_decimals: u8,

    pub profile: MarketProfile,
    pub calendar: Pubkey,

    pub oracle_kind: OracleKind,
    pub feed_id: [u8; 32],
    pub max_staleness_secs: u32,
    pub max_conf_bps: u16,

    pub params: PoolParams,

    pub mode: Mode,
    pub halted: bool,
    pub pool_price: u128,
    pub reference_price: u128,
    pub close_ts: i64,
    pub last_update_ts: i64,
    pub last_oracle_publish_ts: i64,

    pub bump: u8,
    pub base_vault_bump: u8,
    pub quote_vault_bump: u8,
    pub lp_mint_bump: u8,
}

/// Plain data, compiled in every build only because Anchor's IDL generator ignores `#[cfg]` on
/// instruction argument types. The mock oracle account and instructions stay behind `devnet-mock`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MockStatus {
    Trading,
    Halted,
    Closed,
}

/// Admin-controlled price source for localnet/devnet demos. Never compiled into mainnet builds.
#[cfg(feature = "devnet-mock")]
#[account]
#[derive(InitSpace)]
pub struct MockOracle {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_ts: i64,
    pub status: MockStatus,
    pub bump: u8,
}
