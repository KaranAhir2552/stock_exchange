use anchor_lang::prelude::*;

declare_id!("AUkfc1YB8AB1BSno52xnsPvKcXYCbnHyySDxhrkmwp9x");

#[program]
pub mod afterbell {
    use super::*;

    // Phase 0 placeholder; replaced by the real instructions in Phase 1.
    pub fn hello(_ctx: Context<Hello>) -> Result<()> {
        msg!("Hello from Afterbell");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Hello {}
