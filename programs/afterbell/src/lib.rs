use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod state;

pub use instructions::*;
pub use state::*;

declare_id!("AUkfc1YB8AB1BSno52xnsPvKcXYCbnHyySDxhrkmwp9x");

#[program]
pub mod afterbell {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        admin: Pubkey,
        guardian: Pubkey,
        treasury: Pubkey,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        instructions::admin::handle_initialize_config(
            ctx,
            admin,
            guardian,
            treasury,
            protocol_fee_bps,
        )
    }

    pub fn create_pool(ctx: Context<CreatePool>, args: CreatePoolArgs) -> Result<()> {
        instructions::admin::handle_create_pool(ctx, args)
    }

    pub fn update_reference(ctx: Context<UpdateReference>) -> Result<()> {
        instructions::admin::handle_update_reference(ctx)
    }

    pub fn deposit(
        ctx: Context<Deposit>,
        max_base: u64,
        max_quote: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        instructions::liquidity::handle_deposit(ctx, max_base, max_quote, min_lp_out)
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        lp_amount: u64,
        min_base_out: u64,
        min_quote_out: u64,
    ) -> Result<()> {
        instructions::liquidity::handle_withdraw(ctx, lp_amount, min_base_out, min_quote_out)
    }

    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        direction: Direction,
    ) -> Result<()> {
        instructions::swap::handle_swap(ctx, amount_in, min_amount_out, direction)
    }

    #[cfg(feature = "devnet-mock")]
    pub fn mock_set_price(
        ctx: Context<MockSetPrice>,
        feed_id: [u8; 32],
        price: i64,
        conf: u64,
        expo: i32,
    ) -> Result<()> {
        instructions::mock::handle_mock_set_price(ctx, feed_id, price, conf, expo)
    }

    #[cfg(feature = "devnet-mock")]
    pub fn mock_set_status(ctx: Context<MockSetStatus>, status: MockStatus) -> Result<()> {
        instructions::mock::handle_mock_set_status(ctx, status)
    }
}
