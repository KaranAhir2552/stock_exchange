pub mod admin;
pub mod governance;
pub mod liquidity;
#[cfg(feature = "devnet-mock")]
pub mod mock;
pub mod swap;

pub use admin::*;
pub use governance::*;
pub use liquidity::*;
#[cfg(feature = "devnet-mock")]
pub use mock::*;
pub use swap::*;

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

/// `transfer_checked` via the token interface; `signer` is the pool PDA seeds for vault outflows.
pub fn transfer<'info>(
    program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    amount: u64,
    signer: &[&[&[u8]]],
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority,
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(program.key(), accounts, signer),
        amount,
        mint.decimals,
    )
}
