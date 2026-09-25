use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Trade would move the pool price outside the allowed band")]
    OutsideBand,
    #[msg("Pool is paused: swaps and deposits are blocked, withdrawals still work")]
    PoolPaused,
    #[msg("Oracle price is stale")]
    StaleOracle,
    #[msg("Oracle confidence interval is too wide")]
    OracleConfidenceTooWide,
    #[msg("Oracle account is for a different feed or not owned by the expected program")]
    WrongFeed,
    #[msg("Output is below the minimum requested (slippage)")]
    SlippageExceeded,
    #[msg("Deposit would exceed the pool's TVL cap")]
    TvlCapExceeded,
    #[msg("Not enough liquidity for this trade")]
    InsufficientLiquidity,
    #[msg("Invalid parameters")]
    InvalidParams,
    #[msg("Market calendar has expired")]
    CalendarExpired,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Mint uses a token extension that is not supported")]
    UnsupportedMintExtension,
    #[msg("Signer is not allowed to perform this action")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Oracle price is zero, negative, or out of range")]
    InvalidOraclePrice,
    #[msg("This pool needs its market calendar account")]
    MissingCalendar,
}
