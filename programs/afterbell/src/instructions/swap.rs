use super::transfer;
use crate::errors::ErrorCode;
use crate::events::Swapped;
use crate::math;
use crate::mode::{cal, refresh, trading_terms};
use crate::oracle::read_oracle;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut, seeds = [POOL_SEED, base_mint.key().as_ref(), quote_mint.key().as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault,
        has_one = base_token_program, has_one = quote_token_program,
    )]
    pub pool: Box<Account<'info, Pool>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint)]
    pub user_base: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint)]
    pub user_quote: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: validated by `read_oracle`.
    pub oracle: UncheckedAccount<'info>,
    #[account(address = pool.calendar @ ErrorCode::MissingCalendar)]
    pub calendar: Option<Box<Account<'info, MarketCalendar>>>,
    /// Treasury's token account for the input mint. Required only when protocol_fee_bps > 0.
    #[account(mut, token::authority = config.treasury)]
    pub treasury_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_swap(
    ctx: Context<Swap>,
    amount_in: u64,
    min_amount_out: u64,
    direction: Direction,
) -> Result<()> {
    let a = ctx.accounts;
    let real_now = Clock::get()?.unix_timestamp;
    let oracle = read_oracle(&a.pool, &a.oracle, &a.base_mint.to_account_info(), real_now)?;
    let now = oracle.pool_now(real_now)?;
    let pool_key = a.pool.key();
    refresh(
        &mut a.pool,
        pool_key,
        a.config.global_pause,
        cal(&a.calendar),
        &oracle,
        now,
    )?;
    let (fee_rule, band_bps) = trading_terms(&a.pool, now)?;
    let p = &a.pool.params;
    let price_before = a.pool.pool_price;
    let q = math::quote_swap(
        a.base_vault.amount,
        a.quote_vault.amount,
        price_before,
        p.depth_bps,
        fee_rule,
        amount_in,
        direction,
    )?;
    require!(
        math::within_band(q.new_price, a.pool.reference_price, band_bps)?,
        ErrorCode::OutsideBand
    );
    require!(q.amount_out >= min_amount_out, ErrorCode::SlippageExceeded);

    let protocol_fee = math::to_u64(math::mul_div(
        q.fee as u128,
        a.config.protocol_fee_bps as u128,
        BPS,
        false,
    )?)?;

    let (in_prog, in_mint, user_in, vault_in, out_prog, out_mint, vault_out, user_out) =
        match direction {
            Direction::BaseToQuote => (
                &a.base_token_program,
                &a.base_mint,
                &a.user_base,
                &a.base_vault,
                &a.quote_token_program,
                &a.quote_mint,
                &a.quote_vault,
                &a.user_quote,
            ),
            Direction::QuoteToBase => (
                &a.quote_token_program,
                &a.quote_mint,
                &a.user_quote,
                &a.quote_vault,
                &a.base_token_program,
                &a.base_mint,
                &a.base_vault,
                &a.user_base,
            ),
        };

    let user = a.user.to_account_info();
    if protocol_fee > 0 {
        let treasury = a.treasury_token.as_ref().ok_or(ErrorCode::InvalidParams)?;
        require_keys_eq!(treasury.mint, in_mint.key(), ErrorCode::InvalidParams);
        transfer(
            in_prog,
            user_in,
            treasury,
            user.clone(),
            in_mint,
            protocol_fee,
            &[],
        )?;
    }
    transfer(
        in_prog,
        user_in,
        vault_in,
        user,
        in_mint,
        amount_in - protocol_fee,
        &[],
    )?;

    let bump = [a.pool.bump];
    let seeds: &[&[u8]] = &[
        POOL_SEED,
        a.pool.base_mint.as_ref(),
        a.pool.quote_mint.as_ref(),
        &bump,
    ];
    transfer(
        out_prog,
        vault_out,
        user_out,
        a.pool.to_account_info(),
        out_mint,
        q.amount_out,
        &[seeds],
    )?;

    a.pool.pool_price = q.new_price;
    emit!(Swapped {
        pool: pool_key,
        user: a.user.key(),
        direction,
        amount_in,
        amount_out: q.amount_out,
        fee: q.fee,
        fee_bps: q.fee_bps,
        protocol_fee,
        mode: a.pool.mode,
        price_before,
        price_after: q.new_price,
        reference_price: a.pool.reference_price,
        band_bps,
    });
    Ok(())
}
