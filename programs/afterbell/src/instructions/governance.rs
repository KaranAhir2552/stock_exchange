//! Admin and guardian controls: calendars, parameters, halts, global pause.
//! The guardian can only make things safer (halt, pause); resuming needs the admin.

use crate::errors::ErrorCode;
use crate::events::{GlobalPauseSet, HaltSet, ModeChanged, ParamsUpdated};
use crate::state::*;
use anchor_lang::prelude::*;

fn authorize(config: &GlobalConfig, signer: Pubkey, making_safer: bool) -> Result<()> {
    require!(
        signer == config.admin || (making_safer && signer == config.guardian),
        ErrorCode::Unauthorized
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(profile_id: u8)]
pub struct CreateCalendar<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init, payer = admin, space = 8 + MarketCalendar::INIT_SPACE,
        seeds = [CALENDAR_SEED, &[profile_id]], bump,
    )]
    pub calendar: Box<Account<'info, MarketCalendar>>,
    pub system_program: Program<'info, System>,
}

/// Starts empty and expired (valid_until = 0), i.e. Closed, until sessions are set.
pub fn handle_create_calendar(ctx: Context<CreateCalendar>, profile_id: u8) -> Result<()> {
    require!(
        MarketProfile::UsEquity.calendar_profile_id() == Some(profile_id),
        ErrorCode::InvalidParams
    );
    let c = &mut ctx.accounts.calendar;
    c.profile_id = profile_id;
    c.bump = ctx.bumps.calendar;
    Ok(())
}

#[derive(Accounts)]
pub struct SetSessions<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [CALENDAR_SEED, &[calendar.profile_id]], bump = calendar.bump)]
    pub calendar: Box<Account<'info, MarketCalendar>>,
}

/// Replaces the whole session list. Sessions must be sorted, non-empty, and non-overlapping.
pub fn handle_set_sessions(
    ctx: Context<SetSessions>,
    sessions: Vec<Session>,
    valid_until: i64,
) -> Result<()> {
    require!(sessions.len() <= MAX_SESSIONS, ErrorCode::InvalidParams);
    require!(
        sessions.iter().all(|s| s.open_ts < s.close_ts)
            && sessions.windows(2).all(|w| w[0].close_ts <= w[1].open_ts),
        ErrorCode::InvalidParams
    );
    require!(
        valid_until > Clock::get()?.unix_timestamp,
        ErrorCode::CalendarExpired
    );
    let c = &mut ctx.accounts.calendar;
    c.sessions = [Session::default(); MAX_SESSIONS];
    c.sessions[..sessions.len()].copy_from_slice(&sessions);
    c.session_count = sessions.len() as u16;
    c.valid_until = valid_until;
    Ok(())
}

#[derive(Accounts)]
pub struct SetParams<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
}

pub fn handle_set_params(ctx: Context<SetParams>, params: PoolParams) -> Result<()> {
    params.validate()?;
    ctx.accounts.pool.params = params;
    emit!(ParamsUpdated {
        pool: ctx.accounts.pool.key(),
        params
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetHalt<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
}

/// Halting takes effect immediately. Lifting a halt leaves the pool Paused until the next refresh
/// confirms a trusted price.
pub fn handle_set_halt(ctx: Context<SetHalt>, halted: bool) -> Result<()> {
    let by = ctx.accounts.authority.key();
    authorize(&ctx.accounts.config, by, halted)?;
    let pool_key = ctx.accounts.pool.key();
    let pool = &mut ctx.accounts.pool;
    pool.halted = halted;
    if halted && pool.mode != Mode::Paused {
        emit!(ModeChanged {
            pool: pool_key,
            from: pool.mode,
            to: Mode::Paused,
            ts: Clock::get()?.unix_timestamp,
        });
        pool.mode = Mode::Paused;
    }
    emit!(HaltSet {
        pool: pool_key,
        halted,
        by
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetGlobalPause<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
}

pub fn handle_set_global_pause(ctx: Context<SetGlobalPause>, paused: bool) -> Result<()> {
    let by = ctx.accounts.authority.key();
    authorize(&ctx.accounts.config, by, paused)?;
    ctx.accounts.config.global_pause = paused;
    emit!(GlobalPauseSet { paused, by });
    Ok(())
}
