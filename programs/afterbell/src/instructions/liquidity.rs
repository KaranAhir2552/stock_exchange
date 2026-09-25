use super::transfer;
use crate::errors::ErrorCode;
use crate::events::{LiquidityAdded, LiquidityRemoved};
use crate::math;
use crate::mode::{cal, refresh};
use crate::oracle::read_oracle;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut, seeds = [POOL_SEED, base_mint.key().as_ref(), quote_mint.key().as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault, has_one = lp_mint,
        has_one = base_token_program, has_one = quote_token_program,
    )]
    pub pool: Box<Account<'info, Pool>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user)]
    pub user_base: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = user)]
    pub user_quote: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = lp_mint)]
    pub user_lp: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: validated by `read_oracle`.
    pub oracle: UncheckedAccount<'info>,
    #[account(address = pool.calendar @ ErrorCode::MissingCalendar)]
    pub calendar: Option<Box<Account<'info, MarketCalendar>>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub lp_token_program: Program<'info, Token>,
}

pub fn handle_deposit(
    ctx: Context<Deposit>,
    max_base: u64,
    max_quote: u64,
    min_lp_out: u64,
) -> Result<()> {
    let a = ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    let oracle = read_oracle(&a.pool, &a.oracle, &a.base_mint.to_account_info(), now)?;
    let pool_key = a.pool.key();
    refresh(
        &mut a.pool,
        pool_key,
        a.config.global_pause,
        cal(&a.calendar),
        &oracle,
        now,
    )?;
    require!(a.pool.mode != Mode::Paused, ErrorCode::PoolPaused);

    let (b, q) = (a.base_vault.amount, a.quote_vault.amount);
    let d = if a.lp_mint.supply == 0 {
        math::Deposit {
            lp: math::initial_lp(max_base, max_quote)?,
            base_in: max_base,
            quote_in: max_quote,
        }
    } else {
        let supply = a
            .lp_mint
            .supply
            .checked_add(MIN_LIQUIDITY)
            .ok_or(ErrorCode::MathOverflow)?;
        math::proportional_deposit(max_base, max_quote, b, q, supply)?
    };
    require!(d.lp >= min_lp_out, ErrorCode::SlippageExceeded);

    let cap = a.pool.params.max_tvl_quote;
    if cap > 0 {
        let new_b = b.checked_add(d.base_in).ok_or(ErrorCode::MathOverflow)?;
        let new_q = q.checked_add(d.quote_in).ok_or(ErrorCode::MathOverflow)?;
        let tvl = math::tvl_quote(new_b, new_q, a.pool.pool_price)?;
        require!(tvl <= cap as u128, ErrorCode::TvlCapExceeded);
    }

    let user = a.user.to_account_info();
    transfer(
        &a.base_token_program,
        &a.user_base,
        &a.base_vault,
        user.clone(),
        &a.base_mint,
        d.base_in,
        &[],
    )?;
    transfer(
        &a.quote_token_program,
        &a.user_quote,
        &a.quote_vault,
        user,
        &a.quote_mint,
        d.quote_in,
        &[],
    )?;

    let bump = [a.pool.bump];
    let seeds: &[&[u8]] = &[
        POOL_SEED,
        a.pool.base_mint.as_ref(),
        a.pool.quote_mint.as_ref(),
        &bump,
    ];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            a.lp_token_program.key(),
            MintTo {
                mint: a.lp_mint.to_account_info(),
                to: a.user_lp.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            &[seeds],
        ),
        d.lp,
    )?;

    emit!(LiquidityAdded {
        pool: pool_key,
        user: a.user.key(),
        base_in: d.base_in,
        quote_in: d.quote_in,
        lp_minted: d.lp,
    });
    Ok(())
}

/// Allowed in every mode. Deliberately reads no config and no oracle, so nothing can block it.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    #[account(
        seeds = [POOL_SEED, base_mint.key().as_ref(), quote_mint.key().as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault, has_one = lp_mint,
        has_one = base_token_program, has_one = quote_token_program,
    )]
    pub pool: Box<Account<'info, Pool>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint)]
    pub user_base: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint)]
    pub user_quote: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = lp_mint, token::authority = user)]
    pub user_lp: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub lp_token_program: Program<'info, Token>,
}

pub fn handle_withdraw(
    ctx: Context<Withdraw>,
    lp_amount: u64,
    min_base_out: u64,
    min_quote_out: u64,
) -> Result<()> {
    let a = ctx.accounts;
    let supply = a
        .lp_mint
        .supply
        .checked_add(MIN_LIQUIDITY)
        .ok_or(ErrorCode::MathOverflow)?;
    let (base_out, quote_out) =
        math::withdraw_amounts(lp_amount, a.base_vault.amount, a.quote_vault.amount, supply)?;
    require!(
        base_out >= min_base_out && quote_out >= min_quote_out,
        ErrorCode::SlippageExceeded
    );

    token_interface::burn(
        CpiContext::new(
            a.lp_token_program.key(),
            Burn {
                mint: a.lp_mint.to_account_info(),
                from: a.user_lp.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        lp_amount,
    )?;

    let bump = [a.pool.bump];
    let seeds: &[&[u8]] = &[
        POOL_SEED,
        a.pool.base_mint.as_ref(),
        a.pool.quote_mint.as_ref(),
        &bump,
    ];
    let pool_ai = a.pool.to_account_info();
    transfer(
        &a.base_token_program,
        &a.base_vault,
        &a.user_base,
        pool_ai.clone(),
        &a.base_mint,
        base_out,
        &[seeds],
    )?;
    transfer(
        &a.quote_token_program,
        &a.quote_vault,
        &a.user_quote,
        pool_ai,
        &a.quote_mint,
        quote_out,
        &[seeds],
    )?;

    emit!(LiquidityRemoved {
        pool: a.pool.key(),
        user: a.user.key(),
        base_out,
        quote_out,
        lp_burned: lp_amount,
    });
    Ok(())
}
