//! Demo-only oracle controls. This whole module only exists with `--features devnet-mock`.
use crate::errors::ErrorCode;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32])]
pub struct MockSetPrice<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init_if_needed, payer = admin, space = 8 + MockOracle::INIT_SPACE,
        seeds = [MOCK_ORACLE_SEED, feed_id.as_ref()], bump,
    )]
    pub mock_oracle: Account<'info, MockOracle>,
    pub system_program: Program<'info, System>,
}

/// Publishes a price stamped with the feed's clock time (real time plus its simulated offset).
pub fn handle_mock_set_price(
    ctx: Context<MockSetPrice>,
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    expo: i32,
) -> Result<()> {
    let m = &mut ctx.accounts.mock_oracle;
    if m.feed_id == [0; 32] {
        m.feed_id = feed_id;
        m.status = MockStatus::Trading;
        m.bump = ctx.bumps.mock_oracle;
    }
    m.price = price;
    m.conf = conf;
    m.expo = expo;
    m.publish_ts = Clock::get()?
        .unix_timestamp
        .checked_add(m.clock_offset)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct MockSetStatus<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [MOCK_ORACLE_SEED, mock_oracle.feed_id.as_ref()], bump = mock_oracle.bump)]
    pub mock_oracle: Account<'info, MockOracle>,
}

pub fn handle_mock_set_status(ctx: Context<MockSetStatus>, status: MockStatus) -> Result<()> {
    ctx.accounts.mock_oracle.status = status;
    Ok(())
}

/// Moves the simulated clock of every pool on this feed forward (the demo's compressed week).
/// Forward-only, so oracle publish times and pool timestamps never go backwards.
pub fn handle_mock_advance_clock(ctx: Context<MockSetStatus>, seconds: i64) -> Result<()> {
    require!(seconds > 0, ErrorCode::InvalidParams);
    let m = &mut ctx.accounts.mock_oracle;
    m.clock_offset = m
        .clock_offset
        .checked_add(seconds)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(())
}

/// Keeper heartbeat on devnet: re-stamps the current price as fresh. Price, status and clock are untouched,
/// so it can't undo a concurrent `mock_set_price` the way re-posting a price read a moment earlier can.
pub fn handle_mock_heartbeat(ctx: Context<MockSetStatus>) -> Result<()> {
    let m = &mut ctx.accounts.mock_oracle;
    m.publish_ts = Clock::get()?
        .unix_timestamp
        .checked_add(m.clock_offset)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(())
}
