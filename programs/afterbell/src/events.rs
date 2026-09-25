use crate::state::{Direction, MarketProfile, Mode, OracleKind, PoolParams};
use anchor_lang::prelude::*;

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub profile: MarketProfile,
    pub oracle_kind: OracleKind,
    pub feed_id: [u8; 32],
}

#[event]
pub struct Swapped {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub direction: Direction,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
    pub fee_bps: u16,
    pub protocol_fee: u64,
    pub mode: Mode,
    pub price_before: u128,
    pub price_after: u128,
    pub reference_price: u128,
    pub band_bps: u16,
}

#[event]
pub struct LiquidityAdded {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub base_in: u64,
    pub quote_in: u64,
    pub lp_minted: u64,
}

#[event]
pub struct LiquidityRemoved {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub base_out: u64,
    pub quote_out: u64,
    pub lp_burned: u64,
}

#[event]
pub struct ReferenceUpdated {
    pub pool: Pubkey,
    pub reference_price: u128,
    pub pool_price: u128,
    pub oracle_publish_ts: i64,
}

#[event]
pub struct ModeChanged {
    pub pool: Pubkey,
    pub from: Mode,
    pub to: Mode,
    pub ts: i64,
}

#[event]
pub struct ParamsUpdated {
    pub pool: Pubkey,
    pub params: PoolParams,
}

#[event]
pub struct HaltSet {
    pub pool: Pubkey,
    pub halted: bool,
    pub by: Pubkey,
}

#[event]
pub struct GlobalPauseSet {
    pub paused: bool,
    pub by: Pubkey,
}
