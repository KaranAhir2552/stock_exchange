use crate::errors::ErrorCode;
use crate::events::PoolCreated;
use crate::oracle::{check_mint_extensions, read_oracle, refresh};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// Must be the program's upgrade authority, so nobody can front-run the deploy and become admin.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + GlobalConfig::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::Unauthorized)]
    pub program: Program<'info, crate::program::Afterbell>,
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key()) @ ErrorCode::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    admin: Pubkey,
    guardian: Pubkey,
    treasury: Pubkey,
    protocol_fee_bps: u16,
) -> Result<()> {
    require!(
        protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
        ErrorCode::InvalidParams
    );
    ctx.accounts.config.set_inner(GlobalConfig {
        admin,
        guardian,
        protocol_fee_bps,
        treasury,
        global_pause: false,
        bump: ctx.bumps.config,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct CreatePoolArgs {
    pub profile: MarketProfile,
    pub oracle_kind: OracleKind,
    pub feed_id: [u8; 32],
    pub max_staleness_secs: u32,
    pub max_conf_bps: u16,
    pub params: PoolParams,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init, payer = admin, space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, base_mint.key().as_ref(), quote_mint.key().as_ref()], bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mint::token_program = base_token_program)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mint::token_program = quote_token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init, payer = admin,
        seeds = [VAULT_SEED, pool.key().as_ref(), base_mint.key().as_ref()], bump,
        token::mint = base_mint, token::authority = pool, token::token_program = base_token_program,
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = admin,
        seeds = [VAULT_SEED, pool.key().as_ref(), quote_mint.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = pool, token::token_program = quote_token_program,
    )]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = admin, seeds = [LP_SEED, pool.key().as_ref()], bump,
        mint::decimals = LP_DECIMALS, mint::authority = pool, mint::token_program = lp_token_program,
    )]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: validated by `read_oracle` (owner, discriminator, feed id).
    pub oracle: UncheckedAccount<'info>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub lp_token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_pool(ctx: Context<CreatePool>, args: CreatePoolArgs) -> Result<()> {
    let a = ctx.accounts;
    require_keys_neq!(
        a.base_mint.key(),
        a.quote_mint.key(),
        ErrorCode::InvalidParams
    );
    check_mint_extensions(&a.base_mint.to_account_info())?;
    check_mint_extensions(&a.quote_mint.to_account_info())?;
    args.params.validate()?;
    require!(
        args.max_staleness_secs > 0 && args.max_conf_bps as u128 <= BPS,
        ErrorCode::InvalidParams
    );
    // ponytail: Phase 1 scope. UsEquity needs the calendar (Phase 2); Pyth needs the reader (Phase 3).
    require!(
        args.profile == MarketProfile::AlwaysOpen && args.oracle_kind == OracleKind::Mock,
        ErrorCode::InvalidParams
    );

    let pool_key = a.pool.key();
    a.pool.set_inner(Pool {
        base_mint: a.base_mint.key(),
        quote_mint: a.quote_mint.key(),
        base_vault: a.base_vault.key(),
        quote_vault: a.quote_vault.key(),
        lp_mint: a.lp_mint.key(),
        base_token_program: a.base_token_program.key(),
        quote_token_program: a.quote_token_program.key(),
        base_decimals: a.base_mint.decimals,
        quote_decimals: a.quote_mint.decimals,
        profile: args.profile,
        calendar: Pubkey::default(),
        oracle_kind: args.oracle_kind,
        feed_id: args.feed_id,
        max_staleness_secs: args.max_staleness_secs,
        max_conf_bps: args.max_conf_bps,
        params: args.params,
        // Starts Paused (fail safe); `refresh` below opens it if the oracle is valid right now.
        mode: Mode::Paused,
        halted: false,
        pool_price: 0,
        reference_price: 0,
        close_ts: 0,
        last_update_ts: 0,
        last_oracle_publish_ts: 0,
        bump: ctx.bumps.pool,
        base_vault_bump: ctx.bumps.base_vault,
        quote_vault_bump: ctx.bumps.quote_vault,
        lp_mint_bump: ctx.bumps.lp_mint,
    });

    let now = Clock::get()?.unix_timestamp;
    let oracle = read_oracle(&a.pool, &a.oracle, &a.base_mint.to_account_info(), now)?;
    refresh(&mut a.pool, pool_key, a.config.global_pause, &oracle, now)?;

    emit!(PoolCreated {
        pool: pool_key,
        base_mint: a.pool.base_mint,
        quote_mint: a.pool.quote_mint,
        profile: args.profile,
        oracle_kind: args.oracle_kind,
        feed_id: args.feed_id,
    });
    Ok(())
}

/// Permissionless, idempotent: recompute mode and re-centre on a newer oracle price.
#[derive(Accounts)]
pub struct UpdateReference<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, has_one = base_mint)]
    pub pool: Box<Account<'info, Pool>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: validated by `read_oracle`.
    pub oracle: UncheckedAccount<'info>,
}

pub fn handle_update_reference(ctx: Context<UpdateReference>) -> Result<()> {
    let a = ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    let oracle = read_oracle(&a.pool, &a.oracle, &a.base_mint.to_account_info(), now)?;
    let key = a.pool.key();
    refresh(&mut a.pool, key, a.config.global_pause, &oracle, now)
}
